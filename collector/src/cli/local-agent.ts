/**
 * **Local Agent startup CLI** — the device-local production entrypoint that boots the configured
 * connections through the multi-channel **Connector Orchestrator**.
 *
 *   tsx src/cli/local-agent.ts --connections <path.json> [--i-understand-this-launches-local-agent-chrome]
 *
 * This is the thin LIVE wrapper around the pure {@link LocalAgentConnectorStartup} composition root: it
 * loads the sanitized MIXED device connection config (browser channels NAVER/ESM, API Cafe24, and the
 * discovery-required channels), resolves the live-service config from the environment, boots each
 * connection through ONE {@link createLocalAgentConnectorStartup} — every connection settled by the single
 * `ChannelConnector.ensureReady()` operation, with Progressive Reconnect as the browser-auth subcomponent
 * — prints the sanitized per-connection outcome + any generated (never executed) sync intent, and shuts
 * everything down cleanly on SIGINT/SIGTERM.
 *
 * **Live-launch gate.** Booting launches a local Chrome per browser connection (a live action). Without the
 * explicit approval flag — or without the required live config — the CLI performs a DRY RUN: it validates
 * + counts the configured connections and prints the plan, launching nothing and creating no profile.
 * The launch decision is the pure {@link decideRun}; only a `LIVE_BOOT` decision ever constructs the
 * startup root. Import is side-effect-free (`main()` runs only when invoked directly), so tests never
 * launch a browser.
 *
 * Local-device only: no tray UI, no installer, no OS auto-start, no Device Vault, no catch-up execution,
 * no backend write, no migration. Cafe24 (API) is NOT implemented — it settles `SKIPPED`. Every printed
 * value is a sanitized enum / boolean / count.
 */

import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "../config";
import {
  createLocalAgentConnectorStartup,
  parseConnectorConnections,
  isRunnableBrowserConnection,
  type LocalAgentConnectorStartup,
  type ParsedConnectorConnections,
  type LocalAgentConnectorStartupConfig,
  type LocalAgentBrowserRuntimeConfig,
} from "../agent/local-agent-connector-startup";
import { humanSignalPathFor } from "../agent/local-agent-human-signal";
import type { UserActionCategory } from "../agent/progressive-reconnect";
import type { ConnectorOrchestratorObserver, ConnectorStartupResult } from "../connector/connector-orchestrator";

/** The four browser user-action categories a human can complete (subset of ConnectorUserAction). */
const BROWSER_USER_ACTIONS: ReadonlySet<string> = new Set<UserActionCategory>([
  "SELECT_SAVED_CREDENTIAL",
  "ENTER_MISSING_USERNAME",
  "COMPLETE_MANUAL_LOGIN",
  "COMPLETE_ADDITIONAL_AUTHENTICATION",
]);
/** Bounded operator-wait for the human-completed signal (consistent with the supervised classify CLIs). */
const HUMAN_WAIT_MS = 15 * 60_000;
const HUMAN_POLL_MS = 750;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function removeIfPresent(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    /* best-effort */
  }
}

/** The only capability the human-completed loop needs from the startup — keeps the loop unit-testable. */
export interface HumanCompletable {
  humanCompleted(connectionId: string, action: UserActionCategory): Promise<{ localAgentState: string } | null>;
}

/**
 * ONE scan of the pending connections. For each, if its per-connection sentinel exists: CONSUME+DELETE it
 * first (so one file occurrence yields at most one transition), then run ONE fresh in-session re-inspection
 * via the retained service. A connection that reaches READY (verified LOGGED_IN) drops out of `pending`;
 * otherwise it stays pending for a later signal. A connection's sentinel never triggers another connection
 * (paths are per-connection). Pure of timing — the bounded wait is the caller's concern.
 */
export async function pollHumanCompletionsOnce(
  startup: HumanCompletable,
  statusFile: string,
  pending: Map<string, UserActionCategory>,
): Promise<void> {
  for (const [connectionId, action] of [...pending]) {
    const sig = humanSignalPathFor(statusFile, connectionId);
    if (!existsSync(sig)) continue;
    removeIfPresent(sig); // consume + delete BEFORE handling
    const snap = await startup.humanCompleted(connectionId, action);
    console.log(
      JSON.stringify({
        event: "HUMAN_COMPLETED_REVERIFY",
        connectionId,
        localAgentState: snap?.localAgentState ?? null,
      }),
    );
    if (snap && snap.localAgentState === "READY") pending.delete(connectionId); // verified LOGGED_IN
  }
}

/** Bounded (no busy-loop) operator wait: re-scan every `HUMAN_POLL_MS` until every connection settles or the timeout. */
async function waitForHumanCompletions(
  startup: HumanCompletable,
  statusFile: string,
  pending: Map<string, UserActionCategory>,
): Promise<void> {
  const maxChecks = Math.max(1, Math.ceil(HUMAN_WAIT_MS / HUMAN_POLL_MS));
  for (let i = 0; i < maxChecks && pending.size > 0; i += 1) {
    await pollHumanCompletionsOnce(startup, statusFile, pending);
    if (pending.size === 0) break;
    await sleep(HUMAN_POLL_MS);
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const collectorRoot = resolve(here, "..", "..");

/** Explicit per-run approval: booting a runnable browser connection launches a local Chrome. */
export const LOCAL_AGENT_APPROVAL_FLAG = "--i-understand-this-launches-local-agent-chrome";

function flagValue(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  return v !== undefined && !v.startsWith("--") ? v : undefined;
}

/**
 * Resolve the BROWSER runtime config from the environment, reporting any missing required categories. Only
 * relevant when the boot contains a runnable browser connection — an API-only / discovery-only config never
 * calls this, so its browser environment values are never required.
 */
export function resolveBrowserRuntimeConfig(
  env: NodeJS.ProcessEnv,
): { ok: true; config: LocalAgentBrowserRuntimeConfig } | { ok: false; missing: string[] } {
  const authSurfaceUrl = env.ESM_AUTH_SURFACE_URL;
  // The session-probe URL is a SEPARATE required setting (the only surface allowed to yield LOGGED_IN).
  // It must never silently fall back to the auth/login URL, and is not derived from loginMode/marketplace/
  // hostname/channel. A missing value fails closed here → decideRun degrades to DRY_RUN (no browser).
  const sessionProbeUrl = env.ESM_SESSION_PROBE_URL;
  const salt = env.STORAGE_PROBE_SALT;
  const missing: string[] = [];
  if (!authSurfaceUrl) missing.push("ESM_AUTH_SURFACE_URL");
  if (!sessionProbeUrl) missing.push("ESM_SESSION_PROBE_URL");
  if (!salt) missing.push("STORAGE_PROBE_SALT");
  if (missing.length > 0) return { ok: false, missing };

  const base = loadConfig(env);
  return {
    ok: true,
    config: {
      profileBaseDir: resolve(collectorRoot, ".profile"),
      authSurfaceUrl: authSurfaceUrl!,
      sessionProbeUrl: sessionProbeUrl!,
      allowlist: base.esmFrameOriginAllowlist,
      salt: salt!,
      chromePath: env.COLLECTOR_CHROME_PATH,
    },
  };
}

/**
 * PURE launch decision — no filesystem, no browser, no exit. Parses the connections config and decides
 * between a `DRY_RUN` (launch nothing, create no profile) and a `LIVE_BOOT`.
 *
 * **Strategy-aware gating.** The Chrome approval flag and the browser environment values are required ONLY
 * when the parsed set contains a runnable browser connection (`BROWSER` + `AVAILABLE`). A config with no
 * runnable browser connection (API-only or discovery-only) boots directly with an EMPTY browser config —
 * every such connection settles `SKIPPED`, no browser service is constructed, and no approval is needed.
 */
export type LocalAgentRunDecision =
  | { mode: "PARSE_ERROR"; errorCategory: "invalid-json" | "not-an-array" | "empty" }
  | {
      mode: "DRY_RUN";
      parsed: ParsedConnectorConnections;
      approved: boolean;
      missingConfig: string[];
    }
  | {
      mode: "LIVE_BOOT";
      parsed: ParsedConnectorConnections;
      config: LocalAgentConnectorStartupConfig;
      /** True when at least one runnable browser connection will launch Chrome; false for an all-SKIPPED boot. */
      requiresBrowser: boolean;
    };

export function decideRun(args: readonly string[], connectionsRaw: string, env: NodeJS.ProcessEnv): LocalAgentRunDecision {
  const parseResult = parseConnectorConnections(connectionsRaw);
  if (!parseResult.ok) return { mode: "PARSE_ERROR", errorCategory: parseResult.errorCategory };
  const parsed = parseResult.value;

  // No runnable browser connection → API-only / discovery-only: boot directly, no browser env, no approval.
  if (!parsed.connections.some(isRunnableBrowserConnection)) {
    return { mode: "LIVE_BOOT", parsed, config: {}, requiresBrowser: false };
  }

  // A runnable browser connection exists → require the approval flag AND the browser environment values.
  const approved = args.includes(LOCAL_AGENT_APPROVAL_FLAG);
  const configResolution = resolveBrowserRuntimeConfig(env);
  if (!approved || !configResolution.ok) {
    return {
      mode: "DRY_RUN",
      parsed,
      approved,
      missingConfig: configResolution.ok ? [] : configResolution.missing,
    };
  }
  return { mode: "LIVE_BOOT", parsed, config: { browser: configResolution.config }, requiresBrowser: true };
}

/**
 * Wrap a shutdown into an idempotent trigger: the first call runs the shutdown; any concurrent or later
 * call (e.g. a SIGTERM after a SIGINT) is a no-op. So a double signal never double-tears-down.
 */
export function createSignalShutdown(shutdown: () => Promise<unknown>): () => Promise<void> {
  let started = false;
  return async () => {
    if (started) return;
    started = true;
    await shutdown();
  };
}

/** A sanitized printer for each settled connection — enums / booleans / counts only. */
const printingObserver: ConnectorOrchestratorObserver = {
  onConnectionSettled(result: ConnectorStartupResult): void {
    console.log(
      JSON.stringify({
        connectionId: result.connectionId,
        channel: result.channel,
        strategy: result.strategy,
        implementationStatus: result.implementationStatus,
        outcome: result.outcome,
        authStatus: result.authStatus,
        capabilityStatus: result.capabilityStatus,
        reconnectPath: result.reconnectPath,
        pendingUserAction: result.pendingUserAction,
        // Surface that a sync intent exists WITHOUT executing it — mechanism enum only, never a run.
        syncIntentMechanism: result.syncIntent?.mechanism ?? null,
      }),
    );
  },
};

function usage(): string {
  return [
    "usage:",
    `  tsx src/cli/local-agent.ts --connections <path.json> [${LOCAL_AGENT_APPROVAL_FLAG}]`,
    "",
    "Without the approval flag (or with missing live config) this is a DRY RUN — it validates and",
    "counts the configured connections and launches nothing.",
  ].join("\n");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const connectionsPath = flagValue(args, "--connections");
  if (!connectionsPath) {
    console.error(`missing-connections-path\n${usage()}`);
    process.exit(2);
    return;
  }

  let raw: string;
  try {
    raw = readFileSync(resolve(process.cwd(), connectionsPath), "utf8");
  } catch {
    console.error("connections-file-unreadable");
    process.exit(3);
    return;
  }

  const decision = decideRun(args, raw, process.env);

  if (decision.mode === "PARSE_ERROR") {
    console.error(JSON.stringify({ errorCategory: decision.errorCategory }));
    process.exit(4);
    return;
  }

  if (decision.mode === "DRY_RUN") {
    // Launch nothing and create no profile — just validate + count + surface what was skipped.
    console.log(
      JSON.stringify({
        mode: "DRY_RUN",
        connectionCount: decision.parsed.connections.length,
        channels: decision.parsed.connections.map((c) => c.channel),
        strategies: decision.parsed.connections.map((c) => c.strategy),
        rejectedEntryIndexes: decision.parsed.rejectedEntryIndexes,
        duplicateConnectionIds: decision.parsed.duplicateConnectionIds,
        approved: decision.approved,
        missingConfig: decision.missingConfig,
      }),
    );
    if (decision.approved && decision.missingConfig.length > 0) {
      // The operator asked to boot but the live config is incomplete — refuse (non-zero) rather than
      // silently degrading to a preview.
      process.exit(5);
    }
    return;
  }

  // LIVE BOOT — one local Chrome per runnable browser connection (API/discovery channels settle SKIPPED,
  // constructing no browser service).
  const startup = createLocalAgentConnectorStartup(decision.config, printingObserver);
  const statusFile = loadConfig(process.env).statusFile;
  const signalPaths = new Map<string, string>(); // connectionId → its per-connection sentinel path
  const clearSignals = (): void => {
    for (const p of signalPaths.values()) removeIfPresent(p);
  };

  const guardedShutdown = createSignalShutdown(async () => {
    clearSignals(); // never leave a stale human-completed signal behind
    const report = await startup.shutdown();
    console.log(JSON.stringify({ event: "SHUTDOWN", ...report }));
  });
  const onSignal = (): void => void guardedShutdown().then(() => process.exit(0));
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  const results = await startup.boot(decision.parsed.connections);

  if (startup.managedConnectionIds().length === 0) {
    // Nothing runnable is held (an all-SKIPPED / API-only / discovery-only boot) — there is no browser to
    // keep resident for a WAITING/HUMAN handoff, so shut down cleanly and exit instead of hanging.
    await guardedShutdown();
    process.exit(0);
    return;
  }

  // Same-process human-completed re-verification: for every browser connection that settled
  // NEEDS_USER_ACTION, keep the SAME process/browser/profile alive and wait (bounded) for an explicit
  // per-connection operator signal, then run ONE fresh in-session re-inspection — no cold restart.
  const pending = new Map<string, UserActionCategory>();
  for (const r of results) {
    if (r.outcome === "NEEDS_USER_ACTION" && r.pendingUserAction && BROWSER_USER_ACTIONS.has(r.pendingUserAction)) {
      const p = humanSignalPathFor(statusFile, r.connectionId);
      signalPaths.set(r.connectionId, p);
      removeIfPresent(p); // clear any stale sentinel at startup
      pending.set(r.connectionId, r.pendingUserAction as UserActionCategory);
    }
  }
  if (pending.size > 0) {
    let n = 0;
    for (const p of signalPaths.values()) {
      console.error(`human-completed signal #${n++}: create this file when the operator has completed login → ${p}`);
    }
    await waitForHumanCompletions(startup, statusFile, pending);
  }
  clearSignals();
  // The browser connections stay resident (held for the WAITING/HUMAN handoff) until a signal triggers a
  // clean shutdown; the process stays alive on the registered signal handlers.
}

// Run only when executed directly (e.g. `tsx src/cli/local-agent.ts`), NEVER on import — importing
// must have no side effects (no argv parse, no file read, no browser launch).
const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  void main();
}
