/**
 * Live, GATED, human-attended NAVER **Action Window** export entrypoint (R4 supervised pilot).
 *
 *   set -a && . ./.env && set +a   # NAVER_REVIEW_URL + COLLECTOR_BROWSER_CHANNEL
 *   npx tsx src/cli/run-action-window-live-naver.ts -- --i-understand-this-opens-live-naver
 *
 * This is the FIRST entrypoint that drives the R4 Action Window engine over a REAL NAVER page via
 * `NaverLiveProbeDriver` — the standalone, minimal-blast-radius live pilot host (the bridge-hosted
 * channel in `local-agent.ts` stays fixture-only). It combines the §8-4 probe's gate + headed
 * `launchNaverContext` + sentinel handshake with the engine/session/downstream loop, injecting the
 * live driver in place of the fixture driver. It is deliberately standalone: no product FE, no Bridge
 * WS — an in-process loopback channel plus a minimal automated operator client stand in for the run
 * controls so a solo, seated operator can drive ONE run while watching the real Chrome window (the
 * driver mounts its highlight overlay there).
 *
 * The user-direct model is unchanged and enforced by the driver, not this file: the SELLER performs
 * login / 2FA / CAPTCHA / account+store+period selection and the real export action on the platform's
 * own control; the Runtime only prepares, highlights, OBSERVES (never simulates) the seller's action,
 * verifies the transition, detects the download read-only, quarantine-validates it (temporary save →
 * magic sniff → DELETE), and hands it to the existing ingestion path. This file issues only the run
 * commands (START_RUN → the seller acts → REQUEST_STEP_RECHECK); it never touches the page, never
 * reports a user action, and imports no legacy capture path and no upload client directly.
 *
 * Sanitized output only: the final line is the run's status / progress / blocker code / channel enum —
 * never a URL, path, filename, selector, or any page content (the same contract the driver and the
 * message layer enforce; `findProhibitedFields` guards the wire).
 *
 * LIVE-ONLY — refuses without the explicit per-run approval flag, and additionally refuses under
 * `NODE_ENV=production` (this is a dev/operator CLI, never a hosted surface). Standing state: NAVER
 * live work is PAUSED. Building/verifying this entrypoint is OFFLINE and hermetic; RUNNING it live is a
 * separate, per-run operator-approved step gated by R4 §3 G2/G3/G6 and the full §4 boundary — this
 * file grants none of that.
 */
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";
import type { Page } from "playwright";
import { loadConfig, type CollectorConfig } from "../config";
import { log } from "../log";
import { launchNaverContext } from "../profile";
import {
  createLoopbackChannel,
  type AwClientTransport,
  type AwServerFrame,
} from "../../../contracts/action-window/v1/transport";
import {
  ACTION_WINDOW_PROTOCOL_VERSION,
  type ActionWindowRunView,
  type CommandEnvelope,
  type CommandType,
  type EventType,
} from "../../../contracts/action-window/v1/index";
import { NaverLiveProbeDriver } from "../action-window/naver-live-driver";
import { NAVER_CHANNEL_CODE, NAVER_RUN_COPY_KEY } from "../action-window/naver-surface";
import { defaultQuarantineDirFor } from "../action-window/quarantine";
import { defaultOperationRunDirFor } from "../action-window/run-store";
import { buildBackendIngestUpload, type AwIngestUploadFn } from "../action-window/ingest-handoff";
import { createPersistentRunSession } from "../action-window/run-lifecycle";
import type { RunConfig } from "../action-window/engine";
import type { ActionWindowSession } from "../action-window/session";
import { approvalRequiredMessage, hasLiveRunApproval } from "./live-run-approval";
import { sentinelPathFor } from "./probe-sentinel";

const HYDRATION_TIMEOUT_MS = 15_000;
/** The seat operator may need to clear 2FA/CAPTCHA + the Commerce account/store/period flow. */
const CONFIRM_TIMEOUT_MS = 10 * 60_000;
const SENTINEL_POLL_INTERVAL_MS = 750;
/** The OBSERVE step blocks on the seller's REAL action — give a seated human a generous window. */
const OBSERVE_TIMEOUT_MS = 10 * 60_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;

/** Refusal reason for a run attempted in a hosted/production environment (defense-in-depth). */
export const PRODUCTION_REFUSAL =
  "Refusing to open live NAVER under NODE_ENV=production — this is a dev/operator CLI, never a hosted surface.";

/* ────────────────────────────── Gate (pure) ────────────────────────────── */

/**
 * Decide whether a live run is refused, and why. Pure: no browser, no config, no I/O — so the gate is
 * unit-testable and `main()` never launches anything on a refusal. `null` = permitted to proceed.
 */
export function liveRunRefusal(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): { reason: string; exitCode: number } | null {
  if (!hasLiveRunApproval([...args])) return { reason: approvalRequiredMessage(), exitCode: 3 };
  if (env.NODE_ENV === "production") return { reason: PRODUCTION_REFUSAL, exitCode: 4 };
  return null;
}

/* ────────────────────────── Downstream deps (pure) ────────────────────────── */

export interface LiveRunDeps {
  quarantineDir: string;
  persistDir: string;
  ingest: AwIngestUploadFn;
  runConfig: RunConfig;
  observeTimeoutMs: number;
  downloadTimeoutMs: number;
}

/**
 * Assemble the injected downstream capabilities + run config from config — WITHOUT a `Page` and
 * without launching a browser, so it is hermetically testable. The quarantine + operation-run dirs
 * are the same gitignored locations the fixture channel uses; ingest is the real backend upload built
 * from SellerOps dev creds (the driver never imports `../upload`).
 */
export function buildLiveRunDeps(cfg: CollectorConfig, collectorRoot: string): LiveRunDeps {
  return {
    quarantineDir: defaultQuarantineDirFor(collectorRoot),
    persistDir: defaultOperationRunDirFor(collectorRoot),
    ingest: buildBackendIngestUpload({
      baseUrl: cfg.baseUrl,
      email: cfg.email,
      password: cfg.password,
      channelCode: "NAVER",
    }),
    runConfig: {
      runId: `run_${randomBytes(6).toString("hex")}`,
      channelCode: NAVER_CHANNEL_CODE,
      runCopyKey: NAVER_RUN_COPY_KEY,
      guidanceEnabled: true,
    },
    observeTimeoutMs: OBSERVE_TIMEOUT_MS,
    downloadTimeoutMs: DOWNLOAD_TIMEOUT_MS,
  };
}

/* ─────────────────── Automated operator client + run driver ─────────────────── */

/**
 * Minimal automated operator client on the FE end of the in-process loopback. It stands in for the
 * operator's run controls (START / recheck / cancel) and tracks the latest sanitized View Model. It
 * is NOT the product FE: it never reports a user action (the seller's real action is observed by the
 * driver) and never touches the page.
 */
export class LiveRunOperatorClient {
  view: ActionWindowRunView | undefined;
  readonly serverFrames: AwServerFrame[] = [];
  private cmdSeq = 0;
  private readonly seenEvents = new Set<EventType>();
  private readonly eventWaiters = new Map<EventType, Array<() => void>>();

  constructor(
    private readonly transport: AwClientTransport,
    private readonly runId: string,
  ) {
    transport.subscribe((frame) => {
      this.serverFrames.push(frame);
      if (frame.kind === "aw_view") this.view = frame.view;
      if (frame.kind === "aw_event") this.recordEvent(frame.event.type);
    });
  }

  private recordEvent(type: EventType): void {
    this.seenEvents.add(type);
    const waiters = this.eventWaiters.get(type);
    if (!waiters) return;
    this.eventWaiters.delete(type);
    for (const resolve of waiters) resolve();
  }

  /**
   * Resolve once `type` has been emitted (immediately if it already has), or `false` on deadline.
   * The FE stand-in waits for the run's own event stream rather than assuming the seller has acted.
   */
  awaitEvent(type: EventType, timeoutMs: number): Promise<boolean> {
    if (this.seenEvents.has(type)) return Promise.resolve(true);
    return new Promise<boolean>((resolveOuter) => {
      const timer = setTimeout(() => {
        const waiters = this.eventWaiters.get(type)?.filter((w) => w !== onEvent);
        if (waiters?.length) this.eventWaiters.set(type, waiters);
        else this.eventWaiters.delete(type);
        resolveOuter(false);
      }, timeoutMs);
      const onEvent = (): void => {
        clearTimeout(timer);
        resolveOuter(true);
      };
      const existing = this.eventWaiters.get(type);
      if (existing) existing.push(onEvent);
      else this.eventWaiters.set(type, [onEvent]);
    });
  }

  send(type: CommandType, payload?: CommandEnvelope["payload"]): void {
    this.transport.send({
      kind: "aw_command",
      command: {
        protocolVersion: ACTION_WINDOW_PROTOCOL_VERSION,
        commandId: `${this.runId}-c${++this.cmdSeq}-${randomUUID().slice(0, 8)}`,
        runId: this.runId,
        expectedRevision: this.view?.revision ?? 0,
        type,
        ...(payload ? { payload } : {}),
      },
    });
  }
}

/**
 * Drive exactly ONE supervised run to a terminal/parked state. START_RUN prepares/locates/highlights
 * and parks at the human barrier; the SELLER then acts on the platform's own control (the live driver
 * never simulates it) and REQUEST_STEP_RECHECK runs verify → detect → validate → ingest. A fail-closed
 * START (hostile session, ambiguous/missing target) lands terminal and is never rechecked. Returns the
 * final sanitized view.
 *
 * The barrier wait is the whole point of this function. `whenSettled()` resolves as soon as the drive
 * chain rests — the observation runs as a separate, untracked task (`session.ts`) — so rechecking on
 * settle alone would fire ~1 s after the highlight, while the seller is still reading the screen. The
 * stage would leave WAIT_FOR_USER_ACTION before their action landed, the session's stage guard would
 * drop the observation, and USER_ACTION_OBSERVED would never be recorded. So we wait on the run's own
 * event stream instead.
 *
 * On observe-timeout we recheck ANYWAY, deliberately: observation is an audit record, NOT the
 * completion authority (verification is), and the in-page click listener has never been proven on a
 * live run. `armObserve` arms download detection with `timeout: 0`, so a download that already fired
 * is still detected here — a missed observation costs latency, never the run.
 */
export async function driveOneRun(
  session: ActionWindowSession,
  client: LiveRunOperatorClient,
  opts?: { observeTimeoutMs?: number },
): Promise<ActionWindowRunView | undefined> {
  client.send("START_RUN", { channelCode: NAVER_CHANNEL_CODE });
  await session.whenSettled();
  if (client.view?.status === "WAITING_FOR_HUMAN") {
    const observed = await client.awaitEvent("USER_ACTION_OBSERVED", opts?.observeTimeoutMs ?? OBSERVE_TIMEOUT_MS);
    log("aw.live.barrier", { observed });
    await session.whenSettled();
    client.send("REQUEST_STEP_RECHECK");
    await session.whenSettled();
  }
  return client.view;
}

/* ─────────────────────────── Live session assembly ─────────────────────────── */

export interface AssembledLiveRun {
  session: ActionWindowSession;
  client: LiveRunOperatorClient;
  driver: NaverLiveProbeDriver;
}

/**
 * Wire the live driver over the given `Page` into a persisted session on an in-process loopback, with
 * an attached automated operator client. This is the only place a real `Page` meets the engine.
 */
export function assembleLiveRun(page: Page, deps: LiveRunDeps): AssembledLiveRun {
  const channel = createLoopbackChannel();
  const driver = new NaverLiveProbeDriver(page, {
    quarantineDir: deps.quarantineDir,
    ingest: deps.ingest,
    observeTimeoutMs: deps.observeTimeoutMs,
    downloadTimeoutMs: deps.downloadTimeoutMs,
    guidanceEnabled: true,
  });
  const opened = createPersistentRunSession(
    { dir: deps.persistDir, transport: channel.server, driver },
    deps.runConfig,
  );
  opened.session.attach();
  const client = new LiveRunOperatorClient(channel.client, deps.runConfig.runId);
  return { session: opened.session, client, driver };
}

/* ────────────────────────────── CLI (live) ────────────────────────────── */

const CONFIRM_PROMPT = [
  "",
  "A browser window is open on NAVER. In that SAME window:",
  "  1) Complete the NAVER-ID login (and any 2FA/CAPTCHA) yourself.",
  "  2) Select account / store / period and reach the review-management export surface.",
  "  3) Leave the browser OPEN — do NOT act on the export control yet.",
  "",
  "Then signal readiness by creating the sentinel file shown below (in Claude Code,",
  "just say \"ready\"). The collector then prepares and HIGHLIGHTS the one export control.",
  "",
  "  >> From the moment the highlight appears you have about 60 SECONDS. <<",
  "",
  "The export is TWO steps, and BOTH must land inside that window:",
  "  1) act on the highlighted export control yourself;",
  "  2) manually confirm the expected NAVER confirmation dialog that opens —",
  "     the download only starts once YOU confirm it.",
  "Act promptly. The Runtime only observes, verifies, detects the download",
  "read-only, validates it, and ingests it. It performs NEITHER step for you, and",
  "it cannot see step 2 — the download starting is the only evidence you confirmed.",
  "",
  "If the window lapses the run fails closed: no download, nothing written anywhere.",
  "That is safe — but this run's approval is spent, and a retry needs a fresh one.",
  "(Ctrl-C to abort.)",
].join("\n");

function banner(): void {
  const line = "─".repeat(64);
  console.error(line);
  console.error(" LIVE NAVER Action Window export — explicit per-run approval required.");
  console.error(" A human logs in and performs the real export action; the Runtime only prepares,");
  console.error(" highlights, observes, verifies, detects the download read-only, validates, and");
  console.error(" ingests. No credential typing, no auth bypass, no Runtime-performed export.");
  console.error(line);
}

async function settleSpa(page: Page): Promise<void> {
  try {
    await page.waitForLoadState("networkidle", { timeout: HYDRATION_TIMEOUT_MS });
  } catch {
    /* best-effort — drive against the page as the human left it */
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function removeSentinel(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    /* best-effort — a leftover is cleared by the next run's startup unlink */
  }
}

async function waitForSentinel(path: string, timeoutMs: number, intervalMs: number): Promise<boolean> {
  const maxChecks = Math.max(1, Math.ceil(timeoutMs / intervalMs));
  for (let i = 0; i < maxChecks; i += 1) {
    if (existsSync(path)) return true;
    await sleep(intervalMs);
  }
  return existsSync(path);
}

async function main(): Promise<void> {
  banner();
  const args = process.argv.slice(2);
  const refusal = liveRunRefusal(args, process.env);
  if (refusal) {
    console.error(refusal.reason);
    process.exit(refusal.exitCode);
    return;
  }

  const cfg = loadConfig();
  if (!cfg.naverReviewUrl) {
    console.error("Set NAVER_REVIEW_URL to the review-management export page URL first.");
    process.exit(2);
    return;
  }

  const collectorRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const deps = buildLiveRunDeps(cfg, collectorRoot);

  const sentinelPath = sentinelPathFor(cfg.statusFile);
  mkdirSync(dirname(sentinelPath), { recursive: true });
  removeSentinel(sentinelPath);

  const ctx = await launchNaverContext(cfg.profileDir, cfg.browserChannel);
  const page = (ctx.pages()[0] ?? (await ctx.newPage())) as Page;
  let assembled: AssembledLiveRun | undefined;
  try {
    await page.goto(cfg.naverReviewUrl, { waitUntil: "domcontentloaded" });

    console.error(CONFIRM_PROMPT);
    console.error("");
    console.error("  Sentinel file (create this when ready):");
    console.error(`    ${sentinelPath}`);
    console.error("");
    const ready = await waitForSentinel(sentinelPath, CONFIRM_TIMEOUT_MS, SENTINEL_POLL_INTERVAL_MS);
    if (!ready) {
      console.error("No sentinel within the timeout; aborting without driving a run.");
      log("aw.live.aborted", { reason: "sentinel-timeout" });
      return;
    }

    await settleSpa(page);
    assembled = assembleLiveRun(page, deps);
    const view = await driveOneRun(assembled.session, assembled.client);

    const result = {
      status: view?.status,
      progress: view?.progress,
      channelCode: view?.channelCode,
      ...(view?.blocker ? { blockerCode: view.blocker.code } : {}),
    };
    console.log(JSON.stringify(result, null, 2));
    log("aw.live.run", {
      status: view?.status,
      ...(view?.blocker ? { blockerCode: view.blocker.code } : {}),
    });
    // The readiness evidence seam. The wire flattens EVERY readiness HALT to UNSUPPORTED_STATE, so
    // without this a live run cannot distinguish a period/scope problem from any other cause — the
    // gap that left the period/scope step unobservable. Fixed enums / booleans / coarse buckets only
    // (see `NaverPrepareDiagnostic`); never transported, never persisted.
    const diagnostic = assembled.driver.prepareDiagnostic();
    if (diagnostic) log("aw.live.readiness", { ...diagnostic });
  } finally {
    try {
      await assembled?.driver.cleanup();
    } catch {
      /* best-effort teardown */
    }
    removeSentinel(sentinelPath);
    await ctx.close();
  }
}

// Run ONLY when invoked directly (never on import) so hermetic tests launch nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
