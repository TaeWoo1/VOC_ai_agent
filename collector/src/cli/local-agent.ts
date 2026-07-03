/**
 * **Local Agent startup CLI** — the device-local production entrypoint that boots the progressive
 * reconnect ladder for the configured connections.
 *
 *   tsx src/cli/local-agent.ts --connections <path.json> [--i-understand-this-launches-local-agent-chrome]
 *
 * This is the thin LIVE wrapper around the pure {@link LocalAgentStartup} composition root: it loads the
 * sanitized device connection config, resolves the live-service config from the environment, boots each
 * connection through ONE {@link createLocalAgentStartup} (never the legacy reconnect runtime), prints the
 * sanitized per-connection outcome, and shuts everything down cleanly on SIGINT/SIGTERM.
 *
 * **Live-launch gate.** Booting launches a local Chrome per connection (a live action). Without the
 * explicit approval flag — or without the required live config — the CLI performs a DRY RUN: it validates
 * + counts the configured connections and prints the plan, launching nothing and creating no profile.
 * The launch decision is the pure {@link decideRun}; only a `LIVE_BOOT` decision ever constructs the
 * startup root. Import is side-effect-free (`main()` runs only when invoked directly), so tests never
 * launch a browser.
 *
 * Local-device only: no tray UI, no installer, no OS auto-start, no Device Vault, no catch-up execution,
 * no backend write, no migration. Every printed value is a sanitized enum / boolean / count.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "../config";
import {
  createLocalAgentStartup,
  parseProgressiveConnections,
  type ParsedProgressiveConnections,
  type LocalAgentStartupConfig,
  type LocalAgentStartupObserver,
  type LocalAgentStartupResult,
} from "../agent/local-agent-startup";

const here = dirname(fileURLToPath(import.meta.url));
const collectorRoot = resolve(here, "..", "..");

/** Explicit per-run approval: booting launches a local Chrome per connection. */
export const LOCAL_AGENT_APPROVAL_FLAG = "--i-understand-this-launches-local-agent-chrome";

function flagValue(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  return v !== undefined && !v.startsWith("--") ? v : undefined;
}

/** Resolve the live startup config from the environment, reporting any missing required categories. */
export function resolveStartupConfig(
  env: NodeJS.ProcessEnv,
): { ok: true; config: LocalAgentStartupConfig } | { ok: false; missing: string[] } {
  const authSurfaceUrl = env.ESM_AUTH_SURFACE_URL;
  const salt = env.STORAGE_PROBE_SALT;
  const missing: string[] = [];
  if (!authSurfaceUrl) missing.push("ESM_AUTH_SURFACE_URL");
  if (!salt) missing.push("STORAGE_PROBE_SALT");
  if (missing.length > 0) return { ok: false, missing };

  const base = loadConfig(env);
  return {
    ok: true,
    config: {
      profileBaseDir: resolve(collectorRoot, ".profile"),
      authSurfaceUrl: authSurfaceUrl!,
      allowlist: base.esmFrameOriginAllowlist,
      salt: salt!,
      chromePath: env.COLLECTOR_CHROME_PATH,
    },
  };
}

/**
 * PURE launch decision — no filesystem, no browser, no exit. Parses the connections config and decides
 * between a `DRY_RUN` (launch nothing, create no profile) and a `LIVE_BOOT`. A `LIVE_BOOT` is returned
 * ONLY when the operator approved AND the live config is complete; anything short of that is a `DRY_RUN`.
 */
export type LocalAgentRunDecision =
  | { mode: "PARSE_ERROR"; errorCategory: "invalid-json" | "not-an-array" | "empty" }
  | {
      mode: "DRY_RUN";
      parsed: ParsedProgressiveConnections;
      approved: boolean;
      missingConfig: string[];
    }
  | {
      mode: "LIVE_BOOT";
      parsed: ParsedProgressiveConnections;
      config: LocalAgentStartupConfig;
    };

export function decideRun(args: readonly string[], connectionsRaw: string, env: NodeJS.ProcessEnv): LocalAgentRunDecision {
  const parseResult = parseProgressiveConnections(connectionsRaw);
  if (!parseResult.ok) return { mode: "PARSE_ERROR", errorCategory: parseResult.errorCategory };

  const approved = args.includes(LOCAL_AGENT_APPROVAL_FLAG);
  const configResolution = resolveStartupConfig(env);
  if (!approved || !configResolution.ok) {
    return {
      mode: "DRY_RUN",
      parsed: parseResult.value,
      approved,
      missingConfig: configResolution.ok ? [] : configResolution.missing,
    };
  }
  return { mode: "LIVE_BOOT", parsed: parseResult.value, config: configResolution.config };
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
const printingObserver: LocalAgentStartupObserver = {
  onConnectionSettled(result: LocalAgentStartupResult): void {
    console.log(
      JSON.stringify({
        connectionId: result.connectionId,
        started: result.started,
        localAgentState: result.localAgentState,
        reconnectPath: result.reconnectPath,
        pendingUserAction: result.pendingUserAction,
        userActions: result.userActions,
        pendingCatchUp: result.pendingCatchUp,
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
        loginModes: decision.parsed.connections.map((c) => c.loginMode),
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

  // LIVE BOOT — one local Chrome per connection.
  const startup = createLocalAgentStartup(decision.config, printingObserver);

  const guardedShutdown = createSignalShutdown(async () => {
    const report = await startup.shutdown();
    console.log(JSON.stringify({ event: "SHUTDOWN", ...report }));
  });
  const onSignal = (): void => void guardedShutdown().then(() => process.exit(0));
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  await startup.boot(decision.parsed.connections);
  // The connections stay resident (browsers held for the WAITING/HUMAN handoff) until a signal
  // triggers a clean shutdown; the process stays alive on the registered signal handlers.
}

// Run only when executed directly (e.g. `tsx src/cli/local-agent.ts`), NEVER on import — importing
// must have no side effects (no argv parse, no file read, no browser launch).
const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  void main();
}
