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

import { randomBytes } from "node:crypto";
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
import { createAgentBridge, type AgentActionWindowConfig, type AgentImportConfig, type AgentReplySubmissionConfig } from "../agent/agent-bridge";
import { NaverLiveProbeDriver } from "../action-window/naver-live-driver";
import { NaverLiveImportDriver } from "../action-window/initial-import/naver-live-import-driver";
import { defaultImportRunDirFor } from "../action-window/initial-import/import-dispatch";
import type { ResolvedLaunchScope } from "../action-window/initial-import/import-host";
import { buildSegmentIngestUpload } from "../action-window/ingest-handoff";
import { fetchLaunchScope, login } from "../upload";
import { launchNaverContext } from "../profile";
import { log } from "../log";
import {
  ACTION_WINDOW_IMPORT_FLAG,
  importModeRefusalMessage,
  resolveImportMode,
} from "./import-mode-gate";
import { SyntheticProbeDriver } from "../action-window/session";
import { SyntheticReplySubmitDriver } from "../action-window/reply-submission/reply-driver";
import { defaultReplyRunDirFor, mintReplyRunId } from "../action-window/reply-submission/reply-dispatch";
import { NaverFixtureProbeDriver, NAVER_CHANNEL_CODE, NAVER_RUN_COPY_KEY, type NaverRealDownstreamOptions } from "../action-window/naver-driver";
import { buildBackendIngestUpload } from "../action-window/ingest-handoff";
import { defaultOperationRunDirFor } from "../action-window/run-store";
import { defaultQuarantineDirFor } from "../action-window/quarantine";
import { parseAllowedOrigins } from "../bridge/origin-policy";
import { nullApprovalPresenter, type ApprovalPresenter } from "../bridge/approval-presenter";
import { createStderrApprovalPresenter } from "../bridge/stderr-approval-presenter";
import { createMacOsApprovalPresenter } from "../bridge/macos-approval-presenter";

/**
 * Collector package root — derived ONLY for the local Bridge pairing-file path (`.bridge/pairings.json`).
 * ESM connection profiles do NOT use this: they resolve through the shared `base.profileBaseDir`
 * (`resolveBrowserRuntimeConfig` + the connection profile resolver), preserved from origin-main. Pure
 * (no I/O) — an `import.meta.url` derivation only, reintroduced solely for the Bridge after the merge.
 */
const collectorRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

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

/** Explicit per-run approval: booting a runnable browser connection launches a local Chrome. */
export const LOCAL_AGENT_APPROVAL_FLAG = "--i-understand-this-launches-local-agent-chrome";

/** DEV/TEST ONLY: auto-approve bridge pairing (never honored under NODE_ENV=production). */
const BRIDGE_DEV_AUTO_APPROVE_FLAG = "--dev-insecure-auto-approve";
/**
 * DEV/TEST ONLY: host a SYNTHETIC Action Window run on the Bridge (R2B). Never honored under
 * NODE_ENV=production — no live channel exists yet, so production hosts no Action Window session.
 * The synthetic driver opens no browser and the Runtime never clicks anything.
 */
export const ACTION_WINDOW_SYNTHETIC_FLAG = "--dev-action-window-synthetic";

/**
 * DEV/TEST ONLY: host the NAVER *fixture* Action Window channel on the Bridge (R4, D-023). Never
 * honored under NODE_ENV=production. The `NaverFixtureProbeDriver` composes the read-only NAVER seams
 * over a synthetic NAVER-shaped fixture (no browser, no network, no live NAVER); it runs the real
 * detect + quarantine-validate chain offline over the fixture's byte-carrying artifact, and its ingest
 * stays SYNTHETIC unless {@link ACTION_WINDOW_INGEST_LOCAL_FLAG} opts into a LOCAL dev backend. The
 * Runtime never clicks the target.
 */
export const ACTION_WINDOW_NAVER_FIXTURE_FLAG = "--dev-action-window-naver-fixture";

/**
 * DEV/TEST ONLY: route the NAVER-fixture ingest handoff to a LOCAL dev backend (`/api/uploads`) using
 * the SellerOps dev credentials from the environment — NEVER a live marketplace. Only meaningful with
 * {@link ACTION_WINDOW_NAVER_FIXTURE_FLAG}; absent it, ingest stays synthetic (no network).
 */
export const ACTION_WINDOW_INGEST_LOCAL_FLAG = "--dev-action-window-ingest-local";

/** Which Action Window channel (if any) the dev flags select. */
export type ActionWindowChannel = "synthetic" | "naver-fixture";

/**
 * Pure gate for the dev-only Action Window hosting: which channel to host, or `null` for none. Never
 * honored under NODE_ENV=production (mirrors the auto-approve gating). The NAVER-fixture flag wins over
 * the synthetic flag if both are present.
 */
export function resolveActionWindowChannel(args: readonly string[], env: NodeJS.ProcessEnv): ActionWindowChannel | null {
  if (env.NODE_ENV === "production") return null;
  if (args.includes(ACTION_WINDOW_NAVER_FIXTURE_FLAG)) return "naver-fixture";
  if (args.includes(ACTION_WINDOW_SYNTHETIC_FLAG)) return "synthetic";
  return null;
}

/** Back-compat predicate for the synthetic-only hosting flag (delegates to the channel resolver). */
export function resolveActionWindowSynthetic(args: readonly string[], env: NodeJS.ProcessEnv): boolean {
  return resolveActionWindowChannel(args, env) === "synthetic";
}

/**
 * DEV/TEST ONLY: host the ISOLATED reply-submission channel (v2) on the Bridge, so the FE dev-bridge
 * (`VITE_AW_BRIDGE=1`) can dispatch a real `REPLY_SUBMISSION` run and receive a real `run_<hex>` runId —
 * OFFLINE, over a synthetic driver (no browser, no live NAVER). Never honored under NODE_ENV=production.
 * Mutually exclusive with the export Action Window channel (an agent hosts one carrier).
 */
export const ACTION_WINDOW_REPLY_FLAG = "--dev-action-window-reply";

/** Pure gate: should the agent host the reply-submission channel? Never under production. */
export function resolveReplySubmissionChannel(args: readonly string[], env: NodeJS.ProcessEnv): boolean {
  if (env.NODE_ENV === "production") return false;
  return args.includes(ACTION_WINDOW_REPLY_FLAG);
}

/**
 * Build the {@link AgentReplySubmissionConfig} for the dev reply channel — a synthetic driver (no
 * browser) and the gitignored `.reply-runs/` persistence dir (restart recovery → PARKED). Run identity
 * is Runtime-assigned (opaque random suffix). No submissionRef here: the FE supplies it in START_RUN.
 */
export function buildReplySubmissionConfig(): AgentReplySubmissionConfig {
  return {
    runId: mintReplyRunId(),
    channelCode: "naver",
    createDriver: () => new SyntheticReplySubmitDriver(),
    persistDir: defaultReplyRunDirFor(collectorRoot),
  };
}

/**
 * Build the {@link AgentImportConfig} for the approval-only import mode.
 *
 * **This is the one Local Agent path that launches a browser at startup** (product-owner decision,
 * 2026-07-25). It is deliberate rather than convenient: a seated operator has to log into NAVER in that
 * browser before any run can happen, so deferring the launch would only move the wait. The gate in
 * `import-mode-gate.ts` is what keeps it off every other path — normal agent, production, scheduled and
 * non-interactive hosts all refuse, and no other carrier flag may be combined with it.
 *
 * **A browser is NOT a run.** Launching Chrome starts nothing: `ImportSegmentHost` waits for a valid
 * `START_RUN` carrying a launch ref, resolves that ref against the SERVER, and only then assembles a
 * session. Until then the agent is a logged-in browser and an announced carrier, nothing more.
 *
 * **Nothing is resumed and no ref is stored.** The launch ref lives only in memory for the life of one
 * run; `.import-runs/` markers carry no ref, and restart recovery ABANDONS rather than resuming (see
 * `import-run-store`). The server holds the plan, so the next run picks the same segment up with a fresh
 * ticket.
 */
export async function buildInitialImportConfig(
  env: NodeJS.ProcessEnv,
): Promise<{ config: AgentImportConfig; close: () => Promise<void> }> {
  const cfg = loadConfig(env);
  // Same requirement every other live NAVER CLI in this package has. Fail closed BEFORE launching a
  // browser: an agent that opens a blank window and then announces itself ready looks like it is working
  // and is not — the first version of this boot did exactly that.
  if (!cfg.naverReviewUrl) {
    throw new Error(
      "NAVER_REVIEW_URL is not set. The import mode needs the review-management page URL; set it in the environment before starting the agent.",
    );
  }
  // Headed, dedicated profile, inside the collector tree (the profile path guard enforces that). The
  // operator logs in here themselves — the collector never types NAVER credentials.
  const context = await launchNaverContext(cfg.profileDir);
  const page = context.pages()[0] ?? (await context.newPage());
  // Open the review surface at BOOT, which is what the other live CLIs do. This is not the same thing as
  // the rule against navigating for the seller MID-RUN: no run exists yet, and landing them on the page
  // they are about to work on is the whole point of a guided mode. Once a run starts, the runtime only
  // ever confirms the surface — it never navigates again.
  //
  // The URL is never logged: raw URLs are prohibited output (roadmap §9), so only the fact of navigation is.
  await page.goto(cfg.naverReviewUrl, { waitUntil: "domcontentloaded" });
  log("aw_import_surface_opened", {});

  // The launch ref and the scope evidence are BOTH only known per run, long after this capability is
  // built — the ref arrives in START_RUN and the evidence depends on what the seller did with the dates.
  // `buildSegmentIngestUpload` reads both inside the returned upload function rather than at build time,
  // so a getter and a thunk are read at ingest time, which is when the answers exist.
  let boundRef = "";
  // Forward declaration: the evidence comes from the import driver's own scope read, because it is the
  // only component that actually performed one.
  let importDriver: NaverLiveImportDriver | null = null;
  const proven = new NaverLiveProbeDriver(page, {
    quarantineDir: defaultQuarantineDirFor(collectorRoot),
    ingest: buildSegmentIngestUpload({
      baseUrl: cfg.baseUrl,
      email: cfg.email,
      password: cfg.password,
      get launchRef() {
        return boundRef;
      },
      scopeEvidence: () => importDriver?.scopeEvidence() ?? "OPERATOR_CONFIRMED",
    }),
    guidanceEnabled: true,
    // A seated seller working through six barriers is slower than the export CLI's own coordination, and a
    // short window reported "they did not act" about someone mid-interaction.
    observeTimeoutMs: 120_000,
    // Enabled on this seated path so a fail-closed CONSENT outcome immediately overlays sanitized candidate
    // labels (A1/B1…) for the operator to name, instead of costing another export window to learn that it
    // failed. It never changes what is clicked — the driver still never clicks — and never relaxes
    // fail-closed by itself. The seller's consent control is likely to need it: NAVER's button reads 확인,
    // which is not export wording, and the continuation matcher looks for export wording.
    liveDebug: true,
  });
  const driver = new NaverLiveImportDriver(proven, {
    guidanceEnabled: true,
    observeTimeoutMs: 120_000,
  });
  importDriver = driver;

  const config: AgentImportConfig = {
    announceRunId: `run_${randomBytes(6).toString("hex")}`,
    channelCode: NAVER_CHANNEL_CODE,
    driver,
    persistDir: defaultImportRunDirFor(collectorRoot),
    async resolveScope(launchRef: string): Promise<ResolvedLaunchScope | null> {
      try {
        const token = await login(cfg.baseUrl, cfg.email, cfg.password);
        const scope = await fetchLaunchScope(cfg.baseUrl, token, launchRef);
        // Both kinds are hostable. A SEGMENT needs its window; a DISCOVERY has none yet — it is the run that
        // finds one out — so requiring dates for both would have made the product's first step unreachable.
        if (scope.kind !== "SEGMENT" && scope.kind !== "DISCOVERY") return null;
        if (scope.kind === "SEGMENT" && (!scope.requiredStart || !scope.requiredEnd)) return null;
        // Bind the ref for the ingest / range-report capability only after the SERVER has accepted it.
        boundRef = launchRef;
        return {
          kind: scope.kind,
          channelCode: scope.channelCode,
          requiredStart: scope.requiredStart ?? "",
          requiredEnd: scope.requiredEnd ?? "",
        };
      } catch {
        // One answer for every refusal — spent, expired, wrong org, never existed, backend down. A client
        // that could tell them apart could probe the ref space.
        return null;
      }
    },
  };
  return { config, close: () => context.close() };
}

/**
 * The import mode's OWN boot path.
 *
 * It runs before the connections gate on purpose. Hosting a NAVER import has nothing to do with the ESM
 * connector lineage the normal boot manages, so requiring a connections file would mean fabricating an
 * unrelated ESM connection — and the live boot launches one Chrome per runnable connection, so that
 * fabrication would open a browser nobody asked for. The first attempt at this wiring had exactly that
 * coupling; this is the fix.
 *
 * What it deliberately does NOT do: no connector startup, no per-connection Chrome, no status sentinels.
 * One browser for the seller to log into, one bridge for the frontend to attach to, nothing else.
 */
async function runImportOnlyBoot(args: readonly string[], env: NodeJS.ProcessEnv): Promise<void> {
  let built: { config: AgentImportConfig; close: () => Promise<void> };
  try {
    built = await buildInitialImportConfig(env);
  } catch (err) {
    // A missing precondition is an operator message, not a stack trace — and nothing has been launched.
    console.error(`[local-agent] ${(err as Error).message}`);
    process.exit(6);
    return;
  }
  const { config, close } = built;
  const approvalKind = decideApprovalPresenter(env, process.platform);
  const bridge = createAgentBridge({
    ...resolveAgentBridgeConfig(args, env),
    approvalPresenter: createApprovalPresenterFor(approvalKind),
    initialImport: config,
  });
  const listen = await bridge.listen();
  console.log(
    JSON.stringify({
      mode: "IMPORT_ONLY",
      ...listen,
      initialImport: true,
      approvalPresenter: approvalKind,
      // Sanitized: no launch ref (none exists yet — it arrives in START_RUN), no dates, no account.
      browserLaunched: true,
    }),
  );
  bridge.markAgentStarted();

  // Stay alive until the seated operator stops it. Idempotent shutdown closes the bridge and the browser
  // exactly once, on every path.
  let stopped = false;
  const shutdown = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    bridge.markAgentStopping();
    await bridge.close().catch(() => {});
    await close().catch(() => {});
    console.log(JSON.stringify({ mode: "IMPORT_ONLY", stopped: true }));
  };
  process.on("SIGINT", () => void shutdown().then(() => process.exit(0)));
  process.on("SIGTERM", () => void shutdown().then(() => process.exit(0)));
  await new Promise<void>(() => {
    /* run until signalled */
  });
}

/**
 * Build the {@link AgentActionWindowConfig} for the resolved channel — pure aside from reading the
 * SellerOps dev config only when the local-ingest opt-in is present. The run identity is Runtime-assigned
 * (opaque random suffix, never derived from any account). R3 persistence is always on (`.operation-runs/`).
 * NAVER-fixture: real detect + quarantine-validate (gitignored `.aw-quarantine/`), synthetic ingest by
 * default; the local-ingest opt-in injects the real `/api/uploads` upload against the LOCAL dev backend.
 */
export function buildActionWindowConfig(
  channel: ActionWindowChannel,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): AgentActionWindowConfig {
  const runId = `run_${randomBytes(6).toString("hex")}`;
  const persistDir = defaultOperationRunDirFor(collectorRoot);
  if (channel === "naver-fixture") {
    const ingestLocal = args.includes(ACTION_WINDOW_INGEST_LOCAL_FLAG) && env.NODE_ENV !== "production";
    const real: NaverRealDownstreamOptions = {
      quarantineDir: defaultQuarantineDirFor(collectorRoot),
      ...(ingestLocal
        ? (() => {
            const cfg = loadConfig(env);
            return { ingest: { upload: buildBackendIngestUpload({ baseUrl: cfg.baseUrl, email: cfg.email, password: cfg.password, channelCode: "NAVER" }) } };
          })()
        : {}),
    };
    return {
      runId,
      channelCode: NAVER_CHANNEL_CODE,
      runCopyKey: NAVER_RUN_COPY_KEY,
      createDriver: () => new NaverFixtureProbeDriver("normal", { downstream: { real } }),
      persistDir,
    };
  }
  return {
    runId,
    channelCode: "synthetic",
    runCopyKey: "actionWindow.run.synthetic",
    createDriver: () => new SyntheticProbeDriver(),
    persistDir,
  };
}
const DEFAULT_BRIDGE_PORT = 47615;
/** Dev-convenience default allow-list (Vite dev server); production MUST set BRIDGE_ALLOWED_ORIGINS. */
const DEV_DEFAULT_BRIDGE_ORIGINS = "http://localhost:5173 http://127.0.0.1:5173";

/** Resolve the bridge config for the agent-owned bridge (pure; no I/O). */
export function resolveAgentBridgeConfig(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): { port: number; allowedOrigins: string[]; pairingFile: string; agentVersion: string; refSalt: string; autoApprovePairing: boolean } {
  const port = env.BRIDGE_PORT ? Number(env.BRIDGE_PORT) : DEFAULT_BRIDGE_PORT;
  return {
    port: Number.isInteger(port) && port > 0 && port <= 65535 ? port : DEFAULT_BRIDGE_PORT,
    allowedOrigins: parseAllowedOrigins(env.BRIDGE_ALLOWED_ORIGINS ?? DEV_DEFAULT_BRIDGE_ORIGINS),
    pairingFile: resolve(collectorRoot, ".bridge", "pairings.json"),
    agentVersion: "0.0.1-poc",
    refSalt: env.BRIDGE_REF_SALT ?? env.STORAGE_PROBE_SALT ?? "sellerops-bridge",
    autoApprovePairing: args.includes(BRIDGE_DEV_AUTO_APPROVE_FLAG) && env.NODE_ENV !== "production",
  };
}

/**
 * Which human channel this boot uses to show the out-of-band pairing approval code.
 * - `macos_native` — production on macOS: a native `osascript` dialog (no terminal needed).
 * - `dev_tty_stderr` — DEV: the agent's own terminal. Itself unavailable when stderr is redirected.
 * - `none` — no human channel exists → the bridge fails closed (`503 approval_unavailable`).
 */
export type ApprovalPresenterKind = "macos_native" | "dev_tty_stderr" | "none";

/**
 * **PURE decision: which approval presenter should this boot wire?** (no I/O, no adapter construction).
 *
 * Selection lives HERE — in the real boot path — and deliberately NOT as a `createAgentBridge` default:
 * a default would silently hand a real native presenter to every embedder, so any test that paired through
 * the composition root on a macOS machine would pop a real dialog mid-suite. Wiring is opt-in per boot.
 *
 * DEV never selects the native dialog for the same reason — a dev/test boot must not be able to put a
 * dialog on screen. Production off macOS has no adapter yet (Runtime ADR §3.3), so it fails closed rather
 * than degrading to a confirm any local process could forge.
 */
export function decideApprovalPresenter(env: NodeJS.ProcessEnv, platform: string): ApprovalPresenterKind {
  if (env.NODE_ENV === "production") return platform === "darwin" ? "macos_native" : "none";
  return "dev_tty_stderr";
}

/** Build the presenter for a decided kind. `none` yields the always-unavailable fail-closed default. */
export function createApprovalPresenterFor(kind: ApprovalPresenterKind): ApprovalPresenter {
  switch (kind) {
    case "macos_native":
      return createMacOsApprovalPresenter();
    case "dev_tty_stderr":
      return createStderrApprovalPresenter();
    case "none":
      return nullApprovalPresenter;
  }
}

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
      profileBaseDir: base.profileBaseDir,
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

  // The import mode is its own boot and is decided BEFORE anything else, including the connections gate —
  // see runImportOnlyBoot for why coupling it to the connector lineage was wrong.
  const importGate = resolveImportMode(args, process.env);
  if (importGate.host) {
    await runImportOnlyBoot(args, process.env);
    return;
  }
  const importRefusal = importModeRefusalMessage(importGate.reason);
  if (importRefusal) console.error(`[local-agent] ${importRefusal}`);

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

  // Start the agent-owned Bridge exactly once (pairing + observability; slice §B). Best-effort: if a bridge
  // is already bound (single-instance), the agent keeps running without a competing one. It stays alive with
  // the agent, independent of any SellerOps browser tab, and is closed idempotently on shutdown.
  // DEV/TEST ONLY: host one Action Window run over the Bridge opaque passthrough — the SYNTHETIC channel
  // (R2B) or the NAVER *fixture* channel (R4, D-023); production hosts none. The run identity is
  // Runtime-assigned (opaque random suffix — never derived from any account/connection). R3: runs persist
  // under the agent-owned `.operation-runs/` dot-dir (gitignored), so an interrupted run is resumed —
  // parked at the PAUSED barrier — instead of silently replaced on restart. The NAVER-fixture channel is
  // still fixture-only (no browser, no live NAVER); its ingest reaches a LOCAL dev backend only under the
  // explicit ingest opt-in.
  // Reply-submission hosting (v2, ISOLATED) is mutually exclusive with the export channel and WINS when
  // requested — an agent hosts one carrier. The reply driver is synthetic (no browser, no live NAVER).
  // ONE carrier per agent, decided here and nowhere else. Import is checked FIRST because it is the only
  // mode that launches a browser, so its gate must run before anything else can claim the slot — and the
  // gate REFUSES a command line that also names another carrier rather than quietly winning.
  // The import carrier never reaches here: it has its own boot at the top of main(), so this path hosts
  // only the export or reply carrier. Keeping the mutual exclusion visible anyway would be dead code that
  // implies a case that cannot occur.
  const hostReply = resolveReplySubmissionChannel(args, process.env);
  const awChannel = hostReply ? null : resolveActionWindowChannel(args, process.env);
  const actionWindow: AgentActionWindowConfig | undefined = awChannel
    ? buildActionWindowConfig(awChannel, args, process.env)
    : undefined;
  const replySubmission: AgentReplySubmissionConfig | undefined = hostReply ? buildReplySubmissionConfig() : undefined;
  // Approval-presenter wiring lives HERE and only here — never as a `createAgentBridge` default (see
  // `decideApprovalPresenter`). `none` means no human channel exists on this host, so pairing fails closed.
  const approvalKind = decideApprovalPresenter(process.env, process.platform);
  const bridge = createAgentBridge({
    ...resolveAgentBridgeConfig(args, process.env),
    approvalPresenter: createApprovalPresenterFor(approvalKind),
    ...(actionWindow ? { actionWindow } : {}),
    ...(replySubmission ? { replySubmission } : {}),
  });
  const bridgeListen = await bridge.listen();
  // Sanitized: the presenter KIND only (an enum) — never a code, origin, or pairing detail. Makes it visible
  // that this host can (or cannot) show an approval code, which decides whether pairing can succeed at all.
  console.log(JSON.stringify({ event: "BRIDGE", ...bridgeListen, actionWindow: actionWindow !== undefined, replySubmission: replySubmission !== undefined, approvalPresenter: approvalKind, ...(awChannel ? { actionWindowChannel: awChannel } : {}) }));
  bridge.seed(decision.parsed.connections.map((c) => c.connectionId));

  // ONE observer into the startup: keep the sanitized stdout printer AND feed the bridge snapshot/events.
  const observer: ConnectorOrchestratorObserver = {
    onConnectionSettled(result: ConnectorStartupResult): void {
      printingObserver.onConnectionSettled(result);
      bridge.observer.onConnectionSettled(result);
    },
  };
  const startup = createLocalAgentConnectorStartup(decision.config, observer);
  const statusFile = loadConfig(process.env).statusFile;
  const signalPaths = new Map<string, string>(); // connectionId → its per-connection sentinel path
  const clearSignals = (): void => {
    for (const p of signalPaths.values()) removeIfPresent(p);
  };

  // ONE idempotent shutdown owns BOTH lineages: clear stale human-completed signals, tell the bridge the
  // agent is stopping, shut the connector runtime down, then close the bridge — on every normal and
  // signal-driven path (createSignalShutdown makes a double signal a no-op).
  const guardedShutdown = createSignalShutdown(async () => {
    clearSignals(); // never leave a stale human-completed signal behind
    bridge.markAgentStopping();
    const report = await startup.shutdown();
    console.log(JSON.stringify({ event: "SHUTDOWN", ...report }));
    await bridge.close();
  });
  const onSignal = (): void => void guardedShutdown().then(() => process.exit(0));
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  const results = await startup.boot(decision.parsed.connections);
  bridge.markAgentStarted();

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
  // clean shutdown; the process stays alive on the registered signal handlers. The Bridge stays alive with
  // them — independent of SellerOps browser tabs (closing a tab never stops the agent/bridge).
}

// Run only when executed directly (e.g. `tsx src/cli/local-agent.ts`), NEVER on import — importing
// must have no side effects (no argv parse, no file read, no browser launch).
const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  void main();
}
