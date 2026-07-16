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
import {
  approvalRequiredMessage,
  classifyOnlyMisuseMessage,
  hasLiveRunApproval,
  hasNoIngest,
  isClassifyOnly,
} from "./live-run-approval";
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

/** Refusal reason for a discovery classify-only flag aimed at the Action Window runtime. */
export const CLASSIFY_ONLY_EXIT_CODE = 5;

/**
 * Decide whether a live run is refused, and why. Pure: no browser, no config, no I/O — so the gate is
 * unit-testable and `main()` never launches anything on a refusal. `null` = permitted to proceed.
 *
 * The approval gate is checked FIRST and keeps dominating: an unapproved run is refused for that
 * reason alone, whatever else is on the command line.
 */
export function liveRunRefusal(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): { reason: string; exitCode: number } | null {
  if (!hasLiveRunApproval([...args])) return { reason: approvalRequiredMessage(), exitCode: 3 };
  if (env.NODE_ENV === "production") return { reason: PRODUCTION_REFUSAL, exitCode: 4 };
  // A discovery classify-only flag has no honest meaning here. Refuse loudly rather than ignore it
  // (it was silently discarded before) and rather than redefine it into a click-and-capture run.
  if (isClassifyOnly([...args])) {
    return { reason: classifyOnlyMisuseMessage(), exitCode: CLASSIFY_ONLY_EXIT_CODE };
  }
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
  /** Run-scoped `--no-ingest` policy, threaded to the session executor. */
  declineIngest: boolean;
}

/**
 * The ingest capability handed to a `--no-ingest` run: a capability that CANNOT upload. It closes
 * over no credentials and reaches no backend. The session already declines before touching the
 * driver's ingest seam, so this is the SECOND independent barrier — reaching it at all means barrier
 * one is broken, which is a programming error and must be loud rather than silently uploading.
 */
export function declinedIngestGuard(): AwIngestUploadFn {
  return () => {
    throw new Error(
      "action-window: ingest was invoked under --no-ingest — the session must decline before this seam",
    );
  };
}

/**
 * Assemble the injected downstream capabilities + run config from config — WITHOUT a `Page` and
 * without launching a browser, so it is hermetically testable. The quarantine + operation-run dirs
 * are the same gitignored locations the fixture channel uses; ingest is the real backend upload built
 * from SellerOps dev creds (the driver never imports `../upload`).
 *
 * Under `--no-ingest` the real uploader is never CONSTRUCTED — the dev creds never enter a closure.
 */
export function buildLiveRunDeps(
  cfg: CollectorConfig,
  collectorRoot: string,
  opts?: { declineIngest?: boolean },
): LiveRunDeps {
  const declineIngest = opts?.declineIngest ?? false;
  return {
    quarantineDir: defaultQuarantineDirFor(collectorRoot),
    persistDir: defaultOperationRunDirFor(collectorRoot),
    declineIngest,
    ingest: declineIngest
      ? declinedIngestGuard()
      : buildBackendIngestUpload({
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
  // WAITING_FOR_HUMAN is now TWO different barriers, and only one of them is ours to wait on. A recovery
  // park (login/reconnect) is also WAITING_FOR_HUMAN, but nothing was located, highlighted, or armed —
  // so USER_ACTION_OBSERVED can never fire there. Waiting anyway would burn the full observe window on
  // the one failure mode that used to fail fast, AND log an `aw.live.barrier` reading for a barrier the
  // run never reached. The discriminator is the blocker: a blocker is set only by fail() (→ FAILED) and
  // park(), and a successful re-probe clears it before LOCATE, so the export barrier always waits
  // UNBLOCKED. If that ever stops holding, this returns early rather than waiting — the safe direction.
  //
  // A parked run simply returns its view. Driving the recovery (prompt → seller logs in → recheck) is
  // deliberately NOT here: `main()`'s finally closes the browser as soon as this returns.
  const atExportBarrier = client.view?.status === "WAITING_FOR_HUMAN" && !client.view.blocker;
  if (atExportBarrier) {
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
    { dir: deps.persistDir, transport: channel.server, driver, declineIngest: deps.declineIngest },
    deps.runConfig,
  );
  opened.session.attach();
  const client = new LiveRunOperatorClient(channel.client, deps.runConfig.runId);
  return { session: opened.session, client, driver };
}

/* ────────────────────────────── CLI (live) ────────────────────────────── */

/**
 * The prose a seated human reads MID-RUN. EXPORTED so its invariants are test-locked: it was
 * previously unexported and unasserted, which is exactly how it rotted — through Run 5 it still
 * told the operator to confirm the dialog (contradicting that run's approved scope) and quoted a
 * single "about 60 SECONDS" budget from the highlight, which `40d7c53` made false when it moved
 * the download deadline to start at the human's action.
 *
 * Two rules keep it honest:
 *  - **The timings are INTERPOLATED from the constants**, never restated in prose. A future timer
 *    change cannot leave the operator reading a stale number.
 *  - **It describes the MECHANISM and defers the confirm/do-not-confirm choice to the run's
 *    approved scope.** This prompt is shared across scopes (Run 5 = act-but-never-confirm; the
 *    export pilot = act + confirm + ingest), so hardcoding either is wrong for the other. The
 *    dispatch record carries the choreography; this prompt carries the facts.
 *
 * It is a FUNCTION of the run's ingest policy for the same reason: it once said "there is no
 * no-ingest mode", which `--no-ingest` made false. What the human is told about the fate of their
 * data must be derived from what this run will actually do, never restated as a constant.
 */
export function confirmPrompt(declineIngest: boolean): string {
  return [...PROMPT_HEAD, ...(declineIngest ? PROMPT_NO_INGEST : PROMPT_INGEST), ...PROMPT_TAIL].join("\n");
}

const PROMPT_HEAD = [
  "",
  "A browser window is open on NAVER. In that SAME window:",
  "  1) Complete the NAVER-ID login (and any 2FA/CAPTCHA) yourself.",
  "  2) Reach the review-management export surface for the intended account / store.",
  "  3) Leave the browser OPEN — do NOT act on the export control yet.",
  "",
  "  >> SELECT THE REVIEW PERIOD / SCOPE YOURSELF — NOW, BEFORE SIGNALLING READY. <<",
  "     This is YOUR step and nothing enforces it. The Runtime observes period/scope",
  "     but never sets, requires, or checks it: readiness passes on a populated grid",
  "     whether or not you picked one. Whatever the surface is showing when you act",
  "     is what gets exported.",
  "",
  "Then signal readiness by creating the sentinel file shown below (in Claude Code,",
  "just say \"ready\"). The collector then prepares and HIGHLIGHTS the one export control.",
  "",
  "There are TWO windows, not one:",
  `  1) up to ${Math.round(OBSERVE_TIMEOUT_MS / 60_000)} MINUTES from the highlight for YOU to act on the highlighted`,
  "     export control. The Runtime waits — it never acts for you.",
  `  2) then ${Math.round(DOWNLOAD_TIMEOUT_MS / 1_000)} SECONDS from YOUR action for a download to start.`,
  "",
  "Whether you complete any NAVER confirmation that may appear is defined by THIS RUN'S",
  "APPROVED SCOPE — not by this prompt. The Runtime cannot see such a dialog; a started",
  "download is the only evidence you completed one.",
  "",
];

/** Default policy: a validated download is ingested. */
const PROMPT_INGEST = [
  "  >> A download that starts and validates is INGESTED into SellerOps. <<",
  "     That write is real and irreversible.",
  "",
];

/** `--no-ingest`: the run declines the handoff. Say what still happens, not just what doesn't. */
const PROMPT_NO_INGEST = [
  "  >> THIS RUN IS --no-ingest: a download that starts is validated and then <<",
  "  >> DISCARDED. Nothing is uploaded and nothing is written to SellerOps.    <<",
  "     This is NOT a no-click run: your action is real, and a real file lands",
  "     in quarantine before it is validated and dropped.",
  "",
];

const PROMPT_TAIL = [
  "For a run that is non-mutating BY CONSTRUCTION, do not act at all: let window 2",
  "lapse. No download means no artifact, and nothing is written anywhere.",
  "",
  "If a window lapses the run fails closed: no download, nothing written anywhere.",
  "That is safe — but this run's approval is spent, and a retry needs a fresh one.",
  "(Ctrl-C to abort.)",
];

function banner(declineIngest: boolean): void {
  const line = "─".repeat(64);
  console.error(line);
  console.error(" LIVE NAVER Action Window export — explicit per-run approval required.");
  console.error(" A human logs in and performs the real export action; the Runtime only prepares,");
  console.error(" highlights, observes, verifies, detects the download read-only, validates, and");
  console.error(
    declineIngest
      ? " DECLINES the ingest (--no-ingest). No credential typing, no auth bypass, no Runtime-performed export."
      : " ingests. No credential typing, no auth bypass, no Runtime-performed export.",
  );
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
  const args = process.argv.slice(2);
  const declineIngest = hasNoIngest(args);
  banner(declineIngest);
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
  const deps = buildLiveRunDeps(cfg, collectorRoot, { declineIngest });
  // The wire flattens a declined run and an operator cancel to the same CANCELLED. This fixed-enum
  // LOG is the only thing that tells them apart. Log only — never extend it to transport/persistence.
  if (declineIngest) log("aw.live.ingest_declined", { policy: "no-ingest" });

  const sentinelPath = sentinelPathFor(cfg.statusFile);
  mkdirSync(dirname(sentinelPath), { recursive: true });
  removeSentinel(sentinelPath);

  const ctx = await launchNaverContext(cfg.profileDir, cfg.browserChannel);
  const page = (ctx.pages()[0] ?? (await ctx.newPage())) as Page;
  let assembled: AssembledLiveRun | undefined;
  try {
    await page.goto(cfg.naverReviewUrl, { waitUntil: "domcontentloaded" });

    console.error(confirmPrompt(declineIngest));
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
