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
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
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
import { createAgentBridge, type AgentActionWindowConfig, type AgentApiIssuanceConfig, type AgentCoupangIssuanceConfig, type AgentImportConfig, type AgentReplySubmissionConfig } from "../agent/agent-bridge";
import { IssuanceFixtureDriver } from "../action-window/api-issuance/issuance-fixture-driver";
import { CoupangIssuanceFixtureDriver } from "../action-window/coupang-issuance/coupang-issuance-fixture-driver";
import { LazyCoupangIssuanceDriver } from "../action-window/coupang-issuance/lazy-coupang-issuance-driver";
import { verifyRepoIdentity } from "./repo-identity";
import { NaverLiveProbeDriver } from "../action-window/naver-live-driver";
import { createNaverActionWindowImportDriver } from "../action-window/naver-acquisition-adapter";
import { defaultImportRunDirFor } from "../action-window/initial-import/import-dispatch";
import { LazyImportDriver } from "../action-window/initial-import/lazy-import-driver";
import { ReadinessObservingImportDriver } from "../action-window/initial-import/readiness-observing-driver";
import { ImportAcquisitionCoordinator } from "../action-window/initial-import/import-acquisition-coordinator";
import { checkGuidedPreflight, PREFLIGHT_RECOVERY } from "../action-window/initial-import/guided-preflight";
import type { ImportProbeDriver } from "../action-window/initial-import/import-driver";
import type { ResolvedLaunchScope } from "../action-window/initial-import/import-host";
import { buildSegmentIngestUpload } from "../action-window/ingest-handoff";
import { fetchLaunchScope, login, reportSessionReadiness } from "../upload";
import { accountScopedProfileDirFor, launchNaverContext } from "../profile";
import type { BrowserContext, Page } from "playwright";
import { decideSurfacePresentation } from "../naver/surface-presentation";
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
 * DEV/TEST ONLY: host the ISOLATED API-issuance guidance channel (v2) on the Bridge, so the FE dev-bridge
 * can dispatch a real `API_ISSUANCE_GUIDANCE` run and receive a real `run_<hex>` runId — OFFLINE, over a
 * synthetic fixture driver (no browser, no live NAVER, never reads a credential). Never honored under
 * NODE_ENV=production. Mutually exclusive with the other carriers (an agent hosts one). The LIVE driver is
 * NOT wired here — it is supplied only by the gated live entrypoint (`run-api-issuance-live-naver.ts`).
 */
export const ACTION_WINDOW_ISSUANCE_FLAG = "--dev-action-window-issuance";

/** Pure gate: should the agent host the API-issuance guidance channel? Never under production. */
export function resolveApiIssuanceChannel(args: readonly string[], env: NodeJS.ProcessEnv): boolean {
  if (env.NODE_ENV === "production") return false;
  return args.includes(ACTION_WINDOW_ISSUANCE_FLAG);
}

/**
 * Build the {@link AgentApiIssuanceConfig} for the dev issuance channel — a SYNTHETIC fixture driver (no
 * browser, no live NAVER, no credential read). Run identity is Runtime-assigned (opaque random suffix). No
 * persistence: an issuance walk is read-only guidance with nothing to recover.
 */
export function buildApiIssuanceConfig(): AgentApiIssuanceConfig {
  return {
    runId: `run_${randomBytes(6).toString("hex")}`,
    channelCode: "naver",
    createDriver: () => new IssuanceFixtureDriver(),
  };
}

/**
 * DEV/TEST ONLY: host the ISOLATED Coupang WING issuance guidance channel (v2) on the Bridge, so the FE
 * dev-bridge can dispatch a real `API_ISSUANCE_GUIDANCE` run on `channelCode: "coupang"` and receive a real
 * `run_<hex>` runId — OFFLINE, over the SYNTHETIC {@link CoupangIssuanceFixtureDriver} (no browser, no live
 * WING, never reads a credential). This is the exact mirror of {@link ACTION_WINDOW_ISSUANCE_FLAG} for the
 * Coupang carrier: it lets the browser product path (SellerOps `/connect/coupang` guided walkthrough →
 * pairing → START_RUN → REQUEST_STEP_RECHECK) be driven end-to-end without opening real WING or a CLI client.
 * Never honored under `NODE_ENV=production`. Mutually exclusive with the other carriers (an agent hosts one).
 * The LIVE WING driver is wired by {@link ACTION_WINDOW_COUPANG_ISSUANCE_LIVE_FLAG}, and only under the
 * approval binding that flag's gate demands. This dev flag stays the FIXTURE path.
 */
export const ACTION_WINDOW_COUPANG_ISSUANCE_FLAG = "--dev-action-window-coupang-issuance";

/**
 * **The PRODUCT path: host the guided WING walk with the REAL driver.**
 *
 * Separate from the dev flag because the difference is not a detail — one drives a fixture, the other opens the
 * seller's marketplace window. It is gated on the same binding the standalone entrypoint requires, checked
 * before the agent hosts anything:
 *
 *   - BOTH phase variables naming {@link COUPANG_WING_GUIDED_ISSUANCE_WALK_PHASE};
 *   - a bootstrapped approval id and git SHA in the environment;
 *   - repo identity against that SHA.
 *
 * Missing any of them, the agent boots WITHOUT the carrier rather than falling back to the fixture. A silent
 * downgrade would be worse than a refusal: the operator granted a live walk and would get a simulation that
 * looks like one.
 */
export const ACTION_WINDOW_COUPANG_ISSUANCE_LIVE_FLAG = "--action-window-coupang-issuance-live";

/** Why the live guided-walk carrier was refused. Closed, and every value means "not hosted". */
export const COUPANG_LIVE_WALK_REFUSALS = [
  "PHASE_NOT_BOUND",
  "APPROVAL_NOT_BOUND",
  "REPO_IDENTITY_FAILED",
] as const;
export type CoupangLiveWalkRefusal = (typeof COUPANG_LIVE_WALK_REFUSALS)[number];

/**
 * Pure gate for the live carrier. Returns the refusal, or `null` when every binding is present.
 *
 * Pure and exported so the refusal can be tested without booting an agent or opening a window — the same
 * reason every other WING gate in this repo is a function over inputs rather than a branch inside a boot.
 */
export function coupangLiveWalkRefusal(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  verify: (input: { expectedSha: string; repoRoot: string }) => { ok: boolean },
  repoRoot: string,
): CoupangLiveWalkRefusal | null {
  if (!args.includes(ACTION_WINDOW_COUPANG_ISSUANCE_LIVE_FLAG)) return "PHASE_NOT_BOUND";
  const phase = "COUPANG_WING_GUIDED_ISSUANCE_WALK";
  if (env.SELLEROPS_APPROVAL_PHASE !== phase || env.SELLEROPS_WING_APPROVED_PHASE !== phase) return "PHASE_NOT_BOUND";
  const approvalId = env.WALKTHROUGH_APPROVAL_ID ?? "";
  const sha = env.WALKTHROUGH_GIT_COMMIT ?? "";
  if (!/^apr-[0-9a-f]{6,}$/.test(approvalId) || !/^[0-9a-f]{7,40}$/.test(sha)) return "APPROVAL_NOT_BOUND";
  return verify({ expectedSha: sha, repoRoot }).ok ? null : "REPO_IDENTITY_FAILED";
}

/** Pure gate: should the agent host the Coupang issuance guidance channel? Never under production. */
export function resolveCoupangIssuanceChannel(args: readonly string[], env: NodeJS.ProcessEnv): boolean {
  if (env.NODE_ENV === "production") return false;
  return args.includes(ACTION_WINDOW_COUPANG_ISSUANCE_FLAG);
}

/**
 * Build the {@link AgentCoupangIssuanceConfig} for the dev Coupang issuance channel — a SYNTHETIC fixture
 * driver (no browser, no live WING, no credential read). Run identity is Runtime-assigned (opaque random
 * suffix). No persistence: an issuance walk is read-only guidance with nothing to recover.
 */
/**
 * The PRODUCT-path carrier: the real WING driver, its window opened lazily by the session's first call.
 *
 * `open()` launches the dedicated persistent-profile window and takes the newest tab. It does NOT navigate —
 * on the product path the seller reaches WING themselves, and an agent that drives the page there has taken a
 * marketplace action nobody granted.
 */
export function buildCoupangIssuanceLiveConfig(): AgentCoupangIssuanceConfig {
  const cfg = loadConfig();
  const driver = new LazyCoupangIssuanceDriver({
    open: async () => {
      const context = await launchNaverContext(cfg.profileDir, cfg.browserChannel);
      const page = (context.pages()[0] ?? (await context.newPage())) as Page;
      return { context, page };
    },
  });
  return {
    runId: `run_${randomBytes(6).toString("hex")}`,
    channelCode: "coupang",
    // ONE driver for the carrier's lifetime, so a re-attach reuses the window the seller is already in rather
    // than opening a second one beside it.
    createDriver: () => driver,
  };
}

export function buildCoupangIssuanceConfig(): AgentCoupangIssuanceConfig {
  return {
    runId: `run_${randomBytes(6).toString("hex")}`,
    channelCode: "coupang",
    createDriver: () => new CoupangIssuanceFixtureDriver(),
  };
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
 * Raise the OS window a page lives in — best effort, never fatal.
 *
 * `page.bringToFront()` activates a TAB inside its window; it does not raise the window itself. When SellerOps and
 * the seller center are in the same window that is enough, and when they are not it is invisible: on 2026-07-26 the
 * operator pressed 계속 가져오기 from a SellerOps tab in a different browser window and nothing appeared to happen,
 * because the tab we activated was in a window behind it.
 *
 * There is no Playwright API for "raise this window", so this goes through CDP's `Browser` domain — the same
 * browser we launched, asking about its own window. It restores a minimized window and re-asserts its bounds,
 * which is as far as a browser can push without the OS-level focus stealing that no page should be able to do.
 *
 * Returns whether it worked, because the caller LOGS it: a claim that a window was raised has to be a measurement,
 * not an intention.
 */
async function raiseWindowOf(page: Page): Promise<boolean> {
  try {
    const cdp = await page.context().newCDPSession(page);
    try {
      const { windowId } = (await cdp.send("Browser.getWindowForTarget")) as { windowId: number };
      await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
      return true;
    } finally {
      await cdp.detach().catch(() => {});
    }
  } catch {
    // A browser that would not answer, or a build without the Browser domain. The run continues: the seller can
    // still switch to the tab, and the panel in it says what to do.
    return false;
  }
}

/**
 * Build the {@link AgentImportConfig} for the approval-only import mode.
 *
 * **The browser opens on SELLEROPS, and the marketplace tab comes later** (product-owner decision, 2026-07-26,
 * reversing 2026-07-25). It used to launch straight into the NAVER review surface while starting up, on the
 * reasoning that the operator has to log in there anyway. Watching it in use answered that twice over: a
 * marketplace window that appears before the seller has asked for anything arrives while they are still in
 * SellerOps deciding how far back to import — and splitting the two across separate browser profiles gives them
 * two sessions and an account picker to get right twice.
 *
 * So the journey is one profile, in the order the seller experiences it:
 *
 *  1. **boot** — launch the profile and open SellerOps. Nothing marketplace-facing exists yet.
 *  2. **the seller asks to be connected** (a pairing approved, or their tab attaching) — the bridge's
 *     `onSellerOpsConnected` hook warms the surface up, and the seller center opens as a second tab.
 *  3. **a run** — `START_RUN` with a server-resolved ticket. If step 2 never happened, the first call that needs
 *     the page opens it; `LazyImportDriver` also spells out the four calls that must never cause one.
 *
 * The gate in `import-mode-gate.ts` still keeps this mode off every other path — normal agent, production,
 * scheduled and non-interactive hosts all refuse, and no other carrier flag may be combined with it.
 *
 * **A browser is NOT a run.** `ImportSegmentHost` waits for a valid `START_RUN` carrying a launch ref and
 * resolves that ref against the SERVER before assembling anything. An open seller center is a window the seller
 * asked for, not work in progress.
 *
 * **Nothing is resumed and no ref is stored.** The launch ref lives only in memory for the life of one
 * run; `.import-runs/` markers carry no ref, and restart recovery ABANDONS rather than resuming (see
 * `import-run-store`). The server holds the plan, so the next run picks the same segment up with a fresh
 * ticket.
 */
export async function buildInitialImportConfig(
  env: NodeJS.ProcessEnv,
): Promise<{
  config: AgentImportConfig;
  close: () => Promise<void>;
  warmUpSurface: () => Promise<void>;
  /** AGENT_START readiness probe — the boot fires it once the agent is up (no marketplace tab exists yet). */
  onAgentStart: () => void;
}> {
  const cfg = loadConfig(env);
  // Same requirement every other live NAVER CLI in this package has, and it is checked HERE — at boot, before
  // the seller has pressed anything — precisely because the browser no longer opens at boot. A misconfigured
  // agent must fail while an operator is still looking at its output, not halfway through a guided run.
  if (!cfg.naverReviewUrl) {
    throw new Error(
      "NAVER_REVIEW_URL is not set. The import mode needs the review-management page URL; set it in the environment before starting the agent.",
    );
  }
  const reviewUrl = cfg.naverReviewUrl;

  // **Guided Acquisition Reliability — agent-side pre-flight self-check.** Catches, at boot, the exact wiring
  // faults the first live runs hit: a backend that is down, an empty bridge allow-list, or a SellerOps origin
  // the bridge will reject (the `:5174` vs `:5173` gotcha that shows the seller "로컬 도우미가 실행되지 않았어요"
  // with no cause). Sanitized: only the issue enum and its one recovery-action key are logged — never a URL,
  // host, or port. It WARNS rather than refuses: the operator is still at the terminal and can fix env before
  // seating, and a false alarm must not block a correctly-tunnelled setup.
  const backendReachable = await probeBackendReachable(cfg.baseUrl);
  const preflight = checkGuidedPreflight({
    appUrl: cfg.appUrl,
    allowedOrigins: parseAllowedOrigins(env.BRIDGE_ALLOWED_ORIGINS ?? DEV_DEFAULT_BRIDGE_ORIGINS),
    backendReachable,
  });
  for (const issue of preflight.issues) {
    log("aw_guided_preflight", { issue, recovery: PREFLIGHT_RECOVERY[issue] }, "warn");
  }
  log("aw_guided_preflight_summary", { ok: preflight.ok, issues: preflight.issues.length });

  /**
   * ONE browser profile for the whole journey, opened on SellerOps.
   *
   * The seller works in a single window: SellerOps first, and the seller center appears next to it when they ask
   * to be connected. Two profiles would mean two sessions and an account picker they have to get right twice —
   * which is what the product owner flagged, and the reason this launches here rather than leaving the seller to
   * find SellerOps in whichever browser their machine happens to default to.
   *
   * The marketplace tab is deliberately NOT opened here; see `openSurface` below.
   */
  const context = await launchNaverContext(cfg.profileDir);
  const appPage = context.pages()[0] ?? (await context.newPage());
  // Neither URL is ever logged: raw URLs are prohibited output (roadmap §9), so only the fact is.
  await appPage.goto(cfg.appUrl, { waitUntil: "domcontentloaded" }).catch(() => {});
  log("aw_import_app_opened", {});

  // The launch ref is only known per run, long after this capability is built — it arrives in START_RUN.
  // `buildSegmentIngestUpload` reads it inside the returned upload function via a getter, so the answer is
  // read at ingest time, which is when it exists. The scope evidence is NOT read here: the session passes the
  // engine's single record into `driver.ingest` at ingest time (see import-session's INGEST case), so the
  // driver never derives an evidence value of its own.
  let boundRef = "";
  // The bearer token and opaque account slot the scope resolve learned, reused by the readiness reporter and
  // the account-scoped profile selection. `boundAccountSlot` is null until a scope has been resolved: the
  // seller-center tab is DEFERRED (not opened) at connect-time warm-up until then, so it is only ever opened
  // once the account it belongs to is known (product-owner decision 2026-07-27 — bind at run start).
  let boundToken = "";
  let boundAccountSlot: string | null = null;
  // The account-scoped persistent context the seller center lives in — separate from the boot context that
  // holds SellerOps, so two accounts' cookies never share a profile. Opened lazily by `openSurface`.
  let naverContext: BrowserContext | null = null;
  /**
   * Open the MARKETPLACE tab, next to SellerOps, and build the real driver.
   *
   * Called at most once, by {@link LazyImportDriver} — from the bridge's connect hook when the seller asks to be
   * connected, or, failing that, by the first run that needs the page.
   *
   * A NEW page in the SAME context, never `pages()[0]`: that one is SellerOps. Binding the driver to it would
   * point every locate, highlight and observation at our own app, and the seller would be guided to click
   * controls in the wrong window.
   */
  const openSurface = async (): Promise<ImportProbeDriver> => {
    // The seller center belongs to ONE account, so it lives in that account's own persistent profile — never
    // the boot/SellerOps profile, and never a profile shared with another account. The account is known only
    // once a run's scope has been resolved, so a warm-up that arrives before then is DEFERRED: throwing here
    // leaves the surface closed (LazyImportDriver.warmUp swallows it and does not cache the failure), and the
    // first run — which resolves the scope before it touches the driver — opens it in the right profile.
    if (boundAccountSlot === null) {
      throw new Error("seller center deferred until the run's account slot is known");
    }
    // A non-empty slot picks the account-scoped profile (isolated per channel × account); an empty slot is a
    // legacy server with no slot, and we fall back to the shared boot profile — the pre-account behaviour.
    const profileDir =
      boundAccountSlot.length > 0
        ? accountScopedProfileDirFor(cfg.profileBaseDir, NAVER_CHANNEL_CODE, boundAccountSlot)
        : cfg.profileDir;
    // A dedicated persistent context: the account's NAVER cookies persist here across agent restarts, and a
    // different account resolves to a different directory so their sessions can never mix. REUSED across a
    // re-open: if the seller closed only the tab, the context (and its cookies) survives, so a re-open makes a
    // fresh page in the SAME context rather than re-launching a persistent context on a locked profile dir.
    if (!naverContext) naverContext = await launchNaverContext(profileDir);
    // The operator logs into NAVER here themselves — the collector never types NAVER credentials.
    const page = naverContext.pages()[0] ?? (await naverContext.newPage());
    await page.goto(reviewUrl, { waitUntil: "domcontentloaded" });
    await page.bringToFront().catch(() => {});
    // Enum/boolean only — the opaque slot and the profile path are never logged (no identity on the wire, in a
    // log, or in a trace).
    log("aw_import_surface_opened", { accountScoped: boundAccountSlot.length > 0 });

    // **Guided Acquisition Reliability — detect the seller closing the marketplace window.** Resolved when this
    // page closes; the session parks the run on SURFACE_CLOSED instead of re-arming an observation on a dead
    // page forever. `markClosed()` drops the LazyImportDriver's cached driver so the next PREPARE (a re-check)
    // re-opens a fresh page in the SAME persistent context. One-shot per window; a re-open wires a new one.
    const surfaceClosed = new Promise<void>((resolveClosed) => {
      page.once("close", () => {
        log("aw_import_surface_closed", {});
        lazy.markClosed();
        resolveClosed();
      });
    });

    const proven = new NaverLiveProbeDriver(page, {
      quarantineDir: defaultQuarantineDirFor(collectorRoot),
      // Hand a detected download to a managed, seller-named copy under the gitignored downloads dir, so the
      // operator gets a real, openable file instead of an unnamed GUID temp artifact. The name is sanitized to
      // a basename (no path separators, no traversal) and NEVER logged; the write is best-effort.
      saveManagedCopy: async (suggestedFilename: string, bytes: Uint8Array): Promise<void> => {
        await mkdir(cfg.downloadDir, { recursive: true });
        await writeFile(resolve(cfg.downloadDir, safeExportFilename(suggestedFilename)), bytes);
      },
      ingest: buildSegmentIngestUpload({
        baseUrl: cfg.baseUrl,
        email: cfg.email,
        password: cfg.password,
        get launchRef() {
          return boundRef;
        },
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
    // Bind the supervisor's `NAVER_ACTION_WINDOW_IMPORT` adapter id to the concrete engine. This is the one
    // place that id becomes a driver, and it does so by composing the existing, live-proven engine unchanged
    // (`naver-acquisition-adapter` returns `new NaverLiveImportDriver(proven, opts)`). Every DOM decision still
    // lives in `proven`; nothing about export wording, consent, or the session moves here.
    const driver = createNaverActionWindowImportDriver(proven, {
      guidanceEnabled: true,
      observeTimeoutMs: 120_000,
      // Resolve when the seller closes this window, so the session parks the run on SURFACE_CLOSED and a
      // re-check re-opens it — instead of the run stranding on a dead page.
      whenSurfaceClosed: () => surfaceClosed,
      // If the surface never comes up within this window (the "idle CPU, page never rendered" failure), the
      // run parks on SURFACE_SETTLE_TIMEOUT rather than hanging. Comfortably longer than the grid settle.
      surfaceSettleGuardMs: 45_000,
      /**
       * Put this window in front of the seller when a run starts, and return it to the review surface if it has
       * drifted (product-owner request, 2026-07-26: pressing 연동 in SellerOps should bring up the seller center
       * rather than asking them to go find the window).
       *
       * Both are actions on SellerOps' OWN window — raising it, and following the same public application route
       * the launch already used. Nothing is clicked, typed, submitted or consented, and the decision refuses to
       * navigate off-origin so it can never destroy a login or a 2FA step the seller is in the middle of; that
       * case raises the window and lets `prepareSurface` report `LOGIN_REQUIRED`, which the seller clears
       * themselves. See `naver/surface-presentation.ts`.
       *
       * On the FIRST run this is nearly a no-op — the launch that just happened navigated there — and it still
       * runs, because "nearly" is not "always": the seller may have moved that window between the launch and the
       * first probe.
       */
      async presentSurface(): Promise<void> {
        const decision = decideSurfacePresentation(page.url(), reviewUrl);
        let focused = false;
        let raised = false;
        if (decision.focus) {
          // Activates the TAB. On its own this is not enough, and the gap is what the seller notices: if their
          // SellerOps tab lives in a different OS window, activating a tab in ours changes nothing they can see
          // (2026-07-26 — the operator pressed 계속 가져오기 and no seller center appeared).
          focused = await page
            .bringToFront()
            .then(() => true)
            .catch(() => false);
          raised = await raiseWindowOf(page);
        }
        if (decision.navigate) {
          // Bounded: presentation is best-effort, so a slow re-navigation must not stretch prepareSurface (the
          // PREPARE watchdog is sized against the driver's bounded legs, and an unbounded goto here would break
          // that budget). A timeout just means the window did not return to the surface — the settle probe that
          // follows decides usability regardless.
          await page.goto(reviewUrl, { waitUntil: "domcontentloaded", timeout: 10_000 }).catch(() => {});
        }
        // The DECISION plus what actually happened. `focus: true` alone used to be logged before either call was
        // made, so a failed raise was indistinguishable from a successful one — and this is exactly the line
        // someone reads to find out why a window did not appear.
        log("aw_import_surface_present", {
          reason: decision.reason,
          focus: decision.focus,
          navigate: decision.navigate,
          focused,
          raised,
        });
      },
    });
    return driver;
  };

  const lazy = new LazyImportDriver({ open: openSurface });

  // The Acquisition Supervisor, wired in front of the live import runtime (previously a deliberately-unwired
  // seam). It reads session readiness at the four probe moments (AGENT_START at boot, then BEFORE_WORK /
  // SESSION_FAILURE / MANUAL_RECHECK off each run's own `prepareSurface`) and gates admission on adapter
  // availability. It owns no durable or pure state; the backend and the readiness projector own those.
  const coordinator = new ImportAcquisitionCoordinator(NAVER_CHANNEL_CODE, (state, reason) => {
    // Persist what the probe observed (durable backend readiness), keyed by the opaque ref the server resolves
    // to the account. Best-effort: only once a run has bound its ref + token, and never allowed to fail a run.
    if (!boundRef || !boundToken) return;
    void reportSessionReadiness(cfg.baseUrl, boundToken, boundRef, state, reason).catch(() => undefined);
  });
  // A transparent decorator so a run's `prepareSurface` reading feeds readiness WITHOUT changing what the run
  // sees — this is what keeps the existing NAVER import path byte-for-byte equivalent with the supervisor wired.
  const driver = new ReadinessObservingImportDriver(lazy, (res) => coordinator.observeSurfaceReading(res));

  const config: AgentImportConfig = {
    announceRunId: `run_${randomBytes(6).toString("hex")}`,
    channelCode: NAVER_CHANNEL_CODE,
    driver,
    // BEFORE_WORK admission: refuse a run only when no adapter is bound for (channel × REVIEW). For NAVER the
    // adapter is `NAVER_ACTION_WINDOW_IMPORT`, so this always admits and the live path is unchanged; the guard
    // exists so a build with no bound adapter can never start a run whose work has nowhere to go.
    admit: () => coordinator.admitSegment(),
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
        boundToken = token;
        // The opaque account slot the seller center's profile is bound to. Setting it (even to "") is what
        // lifts the warm-up deferral in `openSurface`: the account is now known, so the surface may open.
        boundAccountSlot = scope.accountSlot ?? "";
        return {
          kind: scope.kind,
          channelCode: scope.channelCode,
          accountSlot: boundAccountSlot,
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
  return {
    config,
    // Close both windows: the boot/SellerOps context and, if a run opened it, the account-scoped seller-center
    // context. The account context is closed first so its persistent profile is flushed cleanly on the way out.
    close: async () => {
      if (naverContext) await naverContext.close().catch(() => undefined);
      await context.close();
    },
    // The middle arrow of the journey the product owner described — open SellerOps, ask to connect, and THEN the
    // seller center appears. It warms up the LAZY driver directly (not through the readiness decorator, which
    // only observes `prepareSurface`). Until a run has resolved its account slot the warm-up is a deliberate
    // no-op (see `openSurface`): the seller center opens with the run, in the account's own profile.
    warmUpSurface: () => lazy.warmUp(),
    onAgentStart: () => coordinator.onAgentStart(),
  };
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
  let built: {
    config: AgentImportConfig;
    close: () => Promise<void>;
    warmUpSurface: () => Promise<void>;
    onAgentStart: () => void;
  };
  try {
    built = await buildInitialImportConfig(env);
  } catch (err) {
    // A missing precondition is an operator message, not a stack trace — and nothing has been launched.
    console.error(`[local-agent] ${(err as Error).message}`);
    process.exit(6);
    return;
  }
  const { config, close, warmUpSurface, onAgentStart } = built;
  const approvalKind = decideApprovalPresenter(env, process.platform);
  const bridge = createAgentBridge({
    ...resolveAgentBridgeConfig(args, env),
    approvalPresenter: createApprovalPresenterFor(approvalKind),
    initialImport: config,
    /**
     * The seller opened SellerOps and asked to be connected — so bring their seller center up now.
     *
     * This is the sequence the product owner asked for, and the reason it is here rather than at boot or at
     * `START_RUN`: at boot the window arrives before they have asked for anything, and at `START_RUN` they meet
     * it in the middle of a guided step. Warming up is not a run: nothing is probed and no ticket exists yet.
     *
     * Fired on every reconnect and swallowed on failure; the launch itself is idempotent.
     */
    onSellerOpsConnected: () => void warmUpSurface(),
  });
  const listen = await bridge.listen();
  console.log(
    JSON.stringify({
      mode: "IMPORT_ONLY",
      ...listen,
      initialImport: true,
      approvalPresenter: approvalKind,
      // Sanitized: no launch ref (none exists yet — it arrives in START_RUN), no dates, no account.
      //
      // Two booleans rather than one, because an operator reads this line to decide which window to look for: a
      // browser IS up and showing SellerOps, and the seller center is NOT — it opens when they ask to connect.
      browserLaunched: true,
      marketplaceOpened: false,
    }),
  );
  bridge.markAgentStarted();
  // AGENT_START readiness probe — the ~once-a-day check-in moment. No marketplace tab exists at boot (it opens
  // when the seller asks to be connected), so this records the channel as UNOBSERVED_EXTERNAL, never a guessed
  // READY. The first run's PREPARE is what actually observes the session.
  onAgentStart();

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

/**
 * Reduce a download's suggested filename to a safe basename for the managed copy: no directory component, no
 * traversal, never empty. The seller's own export name (e.g. a Korean-titled `.xlsx`) is kept as-is when it is a
 * plain basename; anything path-like or empty falls back to a fixed name. Never logged — the sanitization is for
 * the filesystem, not for output.
 */
/**
 * Best-effort backend reachability probe for the pre-flight self-check. A short-timeout GET to the public
 * `/health` endpoint; ANY failure (down, refused, timed out) answers `false`. Never throws, never logs a URL —
 * the caller logs only the boolean verdict. Kept tiny and dependency-free so the boot can await it cheaply.
 */
export async function probeBackendReachable(baseUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2_000);
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/health`, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function safeExportFilename(suggested: string): string {
  const base = basename(suggested).replace(/[/\\]/g, "").trim();
  if (base === "" || base === "." || base === "..") return "review-export.xlsx";
  return base;
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
  const hostIssuance = !hostReply && resolveApiIssuanceChannel(args, process.env);
  const hostCoupangIssuance = !hostReply && !hostIssuance && resolveCoupangIssuanceChannel(args, process.env);
  const awChannel = hostReply || hostIssuance || hostCoupangIssuance ? null : resolveActionWindowChannel(args, process.env);
  const actionWindow: AgentActionWindowConfig | undefined = awChannel
    ? buildActionWindowConfig(awChannel, args, process.env)
    : undefined;
  const replySubmission: AgentReplySubmissionConfig | undefined = hostReply ? buildReplySubmissionConfig() : undefined;
  const apiIssuance: AgentApiIssuanceConfig | undefined = hostIssuance ? buildApiIssuanceConfig() : undefined;
  // The LIVE guided walk takes precedence over the dev fixture when its binding is complete; when the flag is
  // present but the binding is not, the carrier is NOT hosted and the refusal is logged. Never a silent
  // downgrade to the fixture: the operator granted a live walk and a simulation that looks like one is worse
  // than nothing being hosted at all.
  const liveWalkRefusal = args.includes(ACTION_WINDOW_COUPANG_ISSUANCE_LIVE_FLAG)
    // The REPOSITORY root, not the collector package — `verifyRepoIdentity` compares this by realpath against
    // git's own toplevel, so handing it a subdirectory fails every time and looks like a decoy repo.
    ? coupangLiveWalkRefusal(args, process.env, verifyRepoIdentity, resolve(collectorRoot, ".."))
    : "PHASE_NOT_BOUND";
  const hostLiveWalk = args.includes(ACTION_WINDOW_COUPANG_ISSUANCE_LIVE_FLAG) && liveWalkRefusal === null;
  if (args.includes(ACTION_WINDOW_COUPANG_ISSUANCE_LIVE_FLAG) && !hostLiveWalk) {
    log("aw_coupang_live_walk_refused", { refusal: liveWalkRefusal ?? "unknown" }, "warn");
  }
  const coupangIssuance: AgentCoupangIssuanceConfig | undefined = hostLiveWalk
    ? buildCoupangIssuanceLiveConfig()
    : hostCoupangIssuance
      ? buildCoupangIssuanceConfig()
      : undefined;
  // Approval-presenter wiring lives HERE and only here — never as a `createAgentBridge` default (see
  // `decideApprovalPresenter`). `none` means no human channel exists on this host, so pairing fails closed.
  const approvalKind = decideApprovalPresenter(process.env, process.platform);
  const bridge = createAgentBridge({
    ...resolveAgentBridgeConfig(args, process.env),
    approvalPresenter: createApprovalPresenterFor(approvalKind),
    ...(actionWindow ? { actionWindow } : {}),
    ...(replySubmission ? { replySubmission } : {}),
    ...(apiIssuance ? { apiIssuance } : {}),
    ...(coupangIssuance ? { coupangIssuance } : {}),
  });
  const bridgeListen = await bridge.listen();
  // Sanitized: the presenter KIND only (an enum) — never a code, origin, or pairing detail. Makes it visible
  // that this host can (or cannot) show an approval code, which decides whether pairing can succeed at all.
  console.log(JSON.stringify({ event: "BRIDGE", ...bridgeListen, actionWindow: actionWindow !== undefined, replySubmission: replySubmission !== undefined, apiIssuance: apiIssuance !== undefined, coupangIssuance: coupangIssuance !== undefined, approvalPresenter: approvalKind, ...(awChannel ? { actionWindowChannel: awChannel } : {}) }));
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
