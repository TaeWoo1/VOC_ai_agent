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
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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
import { NaverLiveProbeDriver, type CandidateInspection, type ExportScopeReadback } from "../action-window/naver-live-driver";
import { NAVER_CHANNEL_CODE, NAVER_RUN_COPY_KEY } from "../action-window/naver-surface";
import { defaultQuarantineDirFor } from "../action-window/quarantine";
import { defaultOperationRunDirFor } from "../action-window/run-store";
import { buildBackendIngestUpload, type AwIngestUploadFn } from "../action-window/ingest-handoff";
import { createPersistentRunSession } from "../action-window/run-lifecycle";
import type { RecoverableSurfaceBlockerCode, RunConfig } from "../action-window/engine";
import type { ActionWindowSession } from "../action-window/session";
import {
  approvalRequiredMessage,
  classifyOnlyMisuseMessage,
  hasLiveRunApproval,
  hasNoIngest,
  hasSessionRecovery,
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

/**
 * The recovery bound is **TIME, SHARED across attempts** — not a per-attempt timeout (PO, 2026-07-17;
 * D-029). A per-attempt timeout multiplies: 3 × 10 min would take the worst-case time a live NAVER browser
 * is held open on a single-use G6 from ~21 min to ~52 min. One shared budget is monotonic regardless of
 * attempt count (~32 min) and degrades into an honest operator sentence — "you have N minutes to recover".
 * "You have 3 tries" is not one: a try costs nothing if you are standing at the seat.
 *
 * This budget covers the time spent waiting on the HUMAN. Machine time (settleSpa + the probe) is bounded
 * separately by MAX_RECOVERY_ATTEMPTS × (HYDRATION_TIMEOUT_MS + the driver's readiness settle).
 */
const RECOVERY_BUDGET_MS = 10 * 60_000;
/**
 * Spin backstop ONLY — not the bound. Every iteration costs either a deliberate human file-create or a full
 * timeout, and a timeout breaks the loop, so an uncapped loop cannot spin. This is defense-in-depth against
 * the very trap `awaitFreshSentinel` closes; it has its own outcome so that if it EVER fires we learn that
 * the trap reopened, rather than mistaking it for a seller who gave up.
 */
const MAX_RECOVERY_ATTEMPTS = 3;

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
  /**
   * DEV-ONLY live-debug campaign switch (`AW_LIVE_DEBUG=1`, the seated NAVER live-debug sprint). Default
   * `false` ⇒ the production single-run flow. When `true`, `main` runs the bounded retry campaign and the
   * driver overlays sanitized candidate labels on a fail-closed continuation. Never product behavior.
   */
  liveDebug?: boolean;
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
  opts?: { declineIngest?: boolean; liveDebug?: boolean },
): LiveRunDeps {
  const declineIngest = opts?.declineIngest ?? false;
  return {
    quarantineDir: defaultQuarantineDirFor(collectorRoot),
    persistDir: defaultOperationRunDirFor(collectorRoot),
    declineIngest,
    liveDebug: opts?.liveDebug ?? false,
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
  /**
   * The reason the LAST rejected command was refused, or undefined. Recorded because the recovery loop
   * must not assume acceptance: a rejected `REQUEST_STEP_RECHECK` drives nothing, so `whenSettled()`
   * returns in one tick with the run STILL parked — and an unguarded loop would cheerfully re-prompt the
   * operator for the whole budget, logging a truthful-but-useless "still-blocked" every time.
   *
   * Rejection is unreachable today, but only via a proof spanning three modules: `allowedCommands` permits
   * recheck at the park (`stages.ts`), `expectedRevision` cannot go stale because nothing drives while
   * parked, and `commandId` carries a fresh `randomUUID()` suffix (below) so no idempotent replay fires.
   * The single pre-existing recheck fails harmlessly; a LOOP resting on that proof does not.
   */
  lastRejection: string | undefined;
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
      if (frame.kind === "aw_command_result" && !frame.accepted) this.lastRejection = frame.reason ?? "UNKNOWN";
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

/** How a single recovery attempt ended. Fixed enums — this is an audit surface, not a debug string. */
export type RecoveryOutcome =
  /** The probe cleared the blocker: the run is legitimately at the export barrier. */
  | "recovered"
  /** Re-parked — the seller has not fixed the session yet. */
  | "still-blocked"
  /** Terminal. The logged `blockerCode` says WHICH, and that distinction is the whole evidence value. */
  | "failed"
  /** The probe THREW: the driver is torn down, the run is dead, and `lastDiagnostic` is now STALE. */
  | "driver-error"
  /** The engine refused the recheck. Unreachable today; a loop must not assume that stays true. */
  | "rejected"
  | "sentinel-timeout"
  | "budget-exhausted"
  | "attempts-exhausted";

/** Waiting on a human signal: did it arrive, and how long did we wait. */
export interface SentinelWait {
  ready: boolean;
  /** Poll-derived (`checks × intervalMs`), never a wall-clock read — the `export-surface-settle` convention. */
  waitedMs: number;
}

/**
 * The recovery gate: prompt the seated operator and wait for them to signal that they fixed their session.
 * Injected so `driveOneRun` stays free of console/fs/page and remains hermetically testable — the same
 * reason `observeTimeoutMs` is a parameter. `budgetMs` is what REMAINS of the shared recovery budget.
 */
export type RecoveryGate = (
  code: RecoverableSurfaceBlockerCode,
  attempt: number,
  budgetMs: number,
) => Promise<SentinelWait>;

/**
 * The parked blocker code, or `null` if this view is not a recovery park.
 *
 * A park is the ONLY `WAITING_FOR_HUMAN` that carries a blocker: the status comes from just two stages
 * (`WAIT_FOR_USER_ACTION`, where `onSurfaceReady` already cleared the blocker, and `AWAIT_SESSION_RECOVERY`),
 * and this CLI builds its session with `createPersistentRunSession`, so no restore path can inject one.
 * Narrowing to the two recoverable codes rather than casting keeps D-028's compile-time guarantee at this
 * boundary: a future third recoverable code cannot be silently absorbed here — it simply is not a park, so
 * the loop returns early rather than prompting a human about a state it does not understand.
 */
function parkedCode(view: ActionWindowRunView | undefined): RecoverableSurfaceBlockerCode | null {
  if (view?.status !== "WAITING_FOR_HUMAN") return null;
  const blocker = view.blocker;
  if (!blocker || blocker.recoverable !== true) return null;
  return blocker.code === "LOGIN_REQUIRED" || blocker.code === "SESSION_EXPIRED" ? blocker.code : null;
}

/**
 * Classify a post-recheck view. TOTAL, and `"recovered"` is asserted POSITIVELY — never reached by
 * falling through.
 *
 * ⚠ This function is the audit honesty of the whole loop. The obvious shape —
 * `isParked ? "still-blocked" : status === "FAILED" ? "failed" : "recovered"` — reports **"recovered" for a
 * run that just died**: when `prepareSurface` throws, `session.ts`'s `.catch(() => this.fatalCleanup())`
 * tears the driver down and NEVER publishes, so the last view is the `PREPARING` + blocker one that
 * `reprobeSession` pushed. Nothing else produces that shape, which is what makes `driver-error` detectable
 * without a driver change. Logging that as "recovered" is exactly the audit-lie class D-028 rejected
 * `HUMAN_ACTION_REQUIRED` for — and here it would be a lie WE introduced, not one we inherited.
 */
function outcomeOf(view: ActionWindowRunView | undefined, rejection: string | undefined): RecoveryOutcome {
  if (rejection) return "rejected";
  if (parkedCode(view)) return "still-blocked";
  if (view?.status === "FAILED") return "failed";
  if (view?.status === "PREPARING" && view.blocker) return "driver-error";
  if (view?.status === "WAITING_FOR_HUMAN" && !view.blocker) return "recovered";
  return "driver-error"; // never fall through to a claim of success
}

/**
 * Prompt → wait → recheck, until the run leaves the park or the budget/backstop stops us.
 *
 * The bound is the SHARED budget, not the attempt count (D-029). `blockerCode` rides every line because it
 * is what makes `"failed"` legible: `UNSUPPORTED_STATE` means *logged in, surface not ready* — D-028's
 * falsifier landing FALSE — while `TARGET_NOT_FOUND` means *logged in, surface READY, control unlocatable*,
 * a completely different finding. `safeMeta` filters log KEYS, never values, so the enum survives intact.
 */
async function recoverLoop(
  session: ActionWindowSession,
  client: LiveRunOperatorClient,
  opts: { awaitRecovery: RecoveryGate; onRecoveryProbe?: (attempt: number) => void; recoveryBudgetMs?: number; maxRecoveryAttempts?: number },
): Promise<void> {
  const max = opts.maxRecoveryAttempts ?? MAX_RECOVERY_ATTEMPTS;
  let remaining = opts.recoveryBudgetMs ?? RECOVERY_BUDGET_MS;

  for (let attempt = 1; ; attempt += 1) {
    const code = parkedCode(client.view);
    if (!code) return;
    if (attempt > max) return log("aw.live.recovery", { outcome: "attempts-exhausted", attempts: max });
    if (remaining <= 0) return log("aw.live.recovery", { outcome: "budget-exhausted", attempt });

    const wait = await opts.awaitRecovery(code, attempt, remaining);
    remaining -= wait.waitedMs;
    if (!wait.ready) return log("aw.live.recovery", { outcome: "sentinel-timeout", attempt });

    // Per-command, not per-run: a rejection from an earlier attempt must not condemn this one.
    client.lastRejection = undefined;
    client.send("REQUEST_STEP_RECHECK");
    await session.whenSettled();

    const outcome = outcomeOf(client.view, client.lastRejection);
    const blockerCode = client.view?.blocker?.code;
    log("aw.live.recovery", { outcome, attempt, ...(blockerCode ? { blockerCode } : {}) });
    // The probe's diagnostic may be recorded ONLY when the probe actually completed. `lastDiagnostic` is
    // assigned after an unguarded `page.content()`, so a THROWN probe leaves the PREVIOUS probe's value in
    // place — and a seller who just logged in and navigated is precisely when a page read throws. Logging
    // it then would report the PRE-login readiness as post-login evidence: D-028's falsifier, or a stale
    // lie, indistinguishably. Stale ⟺ threw ⟺ driver-error, so this guard closes it with no driver change.
    if (outcome !== "driver-error") opts.onRecoveryProbe?.(attempt);
    if (outcome === "driver-error" || outcome === "rejected") return;
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
  opts?: {
    observeTimeoutMs?: number;
    /**
     * Supply this and a recovery PARK is driven instead of returned: prompt → the seller logs in → they
     * signal → the Runtime re-probes for real. Omit it and the behavior is exactly what it was before A3
     * (a park returns at once), which is the honest semantics — a caller with no way to reach an operator
     * cannot recover — and is why every pre-A3 test passes unmodified.
     */
    awaitRecovery?: RecoveryGate;
    /** Record probe-scoped evidence after a recovery re-probe. Called ONLY when the probe completed. */
    onRecoveryProbe?: (attempt: number) => void;
    recoveryBudgetMs?: number;
    maxRecoveryAttempts?: number;
  },
): Promise<ActionWindowRunView | undefined> {
  client.send("START_RUN", { channelCode: NAVER_CHANNEL_CODE });
  await session.whenSettled();

  // A park is recoverable, so drive the recovery BEFORE deciding anything about the barrier. This runs
  // first precisely so the discriminator below never has to know about it: every loop exit is either
  // unblocked (recovered → really at the barrier), still blocked, or terminal.
  if (opts?.awaitRecovery) {
    await recoverLoop(session, client, { ...opts, awaitRecovery: opts.awaitRecovery });
  }

  // WAITING_FOR_HUMAN is TWO different barriers, and only one of them is ours to wait on. A recovery
  // park (login/reconnect) is also WAITING_FOR_HUMAN, but nothing was located, highlighted, or armed —
  // so USER_ACTION_OBSERVED can never fire there. Waiting anyway would burn the full observe window on
  // the one failure mode that used to fail fast, AND log an `aw.live.barrier` reading for a barrier the
  // run never reached. The discriminator is the blocker: a blocker is set only by fail() (→ FAILED) and
  // park(), and a successful re-probe clears it before LOCATE, so the export barrier always waits
  // UNBLOCKED. If that ever stops holding, this returns early rather than waiting — the safe direction.
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
export function assembleLiveRun(page: Page, deps: LiveRunDeps, selectLabel?: string): AssembledLiveRun {
  const channel = createLoopbackChannel();
  const driver = new NaverLiveProbeDriver(page, {
    quarantineDir: deps.quarantineDir,
    ingest: deps.ingest,
    observeTimeoutMs: deps.observeTimeoutMs,
    downloadTimeoutMs: deps.downloadTimeoutMs,
    guidanceEnabled: true,
    // DEV-ONLY: off on the production path (both undefined ⇒ unchanged driver behavior).
    liveDebug: deps.liveDebug ?? false,
    ...(selectLabel ? { continuationSelectLabel: selectLabel } : {}),
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
 *    approved scope.** On the confirm/ingest axis the prompt is shared across scopes (Run 5 =
 *    act-but-never-confirm; the export pilot = act + confirm + ingest), so hardcoding either is
 *    wrong for the other. The dispatch record carries the choreography; this prompt carries the facts.
 *
 * It is a FUNCTION of the run's ingest policy for the same reason: it once said "there is no
 * no-ingest mode", which `--no-ingest` made false. What the human is told about the fate of their
 * data must be derived from what this run will actually do, never restated as a constant.
 *
 * It is ALSO a function of the run's SCOPE on one axis the "shared across scopes" note above did not
 * contemplate: **login-first vs signal-logged-out.** The default head tells the operator to log in and
 * reach the export surface *before* the first signal — correct for the export pilot / Run 5, but the
 * exact opposite of the session-recovery scope, whose premise is signalling WHILE LOGGED OUT so the run
 * parks on `LOGIN_REQUIRED` and recovers. Run 6 (§8-23) proved one head cannot serve both on this axis
 * and left "should the entrypoint branch its operator prose on run scope" reported-not-resolved; this
 * `sessionRecovery` branch is that resolution (PO, 2026-07-17). It swaps ONLY the head prose — the
 * ingest body and tail stay shared because they describe what happens *after* recovery, and no gating,
 * readiness, or run behaviour changes. `recoveryPrompt` (the second-signal prose) was already correct.
 */
export function confirmPrompt(declineIngest: boolean, sessionRecovery = false): string {
  const head = sessionRecovery ? PROMPT_HEAD_RECOVERY : PROMPT_HEAD;
  return [...head, ...(declineIngest ? PROMPT_NO_INGEST : PROMPT_INGEST), ...PROMPT_TAIL].join("\n");
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
  "NAVER may interpose FURTHER steps after your confirmation (e.g. an in-page notification",
  "with its own download button — observed on 2026-07-24). When that happens the collector",
  "HIGHLIGHTS the new control and WAITS — click it yourself, like the first one. The",
  "download window restarts from that click. The collector never clicks anything.",
  "",
];

/**
 * The session-recovery head (`--session-recovery`). Same facts, opposite opening choreography: the
 * operator signals WHILE LOGGED OUT on purpose, the run parks on `LOGIN_REQUIRED`, and `recoveryPrompt`
 * then carries the rest. It deliberately does NOT restate the two-windows / period-scope guidance —
 * those apply only after recovery, and `recoveryPrompt` re-prints them there — so this head carries no
 * interpolated timings and cannot go stale on a timer change.
 */
const PROMPT_HEAD_RECOVERY = [
  "",
  "This is a SESSION-RECOVERY run. Do NOT log in first — that is the point.",
  "",
  "A browser window is open on NAVER, logged OUT by design. In that SAME window:",
  "  1) Do NOT log in yet, and do NOT touch the export control.",
  "  2) Signal readiness NOW (in Claude Code, just say \"ready\") WHILE STILL LOGGED OUT.",
  "",
  "The Runtime re-reads the page, finds no session, and PARKS on LOGIN_REQUIRED.",
  "This is EXPECTED — the run is paused, not failed. It then prints a recovery",
  "prompt that walks you through the rest, in the SAME window:",
  "  - complete the NAVER-ID login (and any 2FA/CAPTCHA) yourself,",
  "  - RETURN to the review-management export surface yourself,",
  "  - signal readiness AGAIN.",
  "",
  "Only after that second signal does the Runtime highlight the export control and",
  "the two download windows begin. At the export barrier, follow THIS RUN'S approved",
  "scope — for a non-mutating run, click nothing and let the window lapse.",
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

/**
 * The prose a seated human reads when their run PARKS on a login/session blocker (A3 · D-029).
 *
 * This is the **only place D-028's guidance-only precondition is ever delivered on the CLI path.** D-028
 * ratified "the seller is back on the review-export surface" as a §4 human precondition the Runtime observes
 * and never gates — and then nothing implemented it: `confirmPrompt` carries the equivalent for the initial
 * wait, but a recovery had no prompt at all. A guidance-only precondition with nowhere to print the guidance
 * is guidance nobody reads.
 *
 * It obeys `confirmPrompt`'s two rules, for the same reasons:
 *  - **Timings are INTERPOLATED from the constants**, never restated in prose.
 *  - **It is a FUNCTION of the run's ingest policy.** A park can insert a ten-minute login detour between
 *    `confirmPrompt`'s irreversibility warning and the moment the seller acts, so the consequence is
 *    re-stated here, derived from what THIS run will actually do (PO, 2026-07-17).
 *
 * It reports the remaining BUDGET, not "attempt N of 3": the bound is time, and a try costs nothing.
 */
export function recoveryPrompt(
  code: RecoverableSurfaceBlockerCode,
  attempt: number,
  budgetMs: number,
  declineIngest: boolean,
): string {
  return [
    "",
    "─".repeat(64),
    ` THE RUN IS PAUSED — NOT FAILED. Session blocker: ${code}`,
    "─".repeat(64),
    "",
    `This is recovery attempt ${attempt}. Nothing has been clicked and nothing has been`,
    "captured. The run is alive and waiting for you. In the SAME browser window:",
    "",
    "  1) Complete the NAVER-ID login (and any 2FA/CAPTCHA) yourself.",
    "",
    "  >> 2) RETURN TO THE REVIEW-MANAGEMENT EXPORT PAGE BEFORE YOU SIGNAL READY. <<",
    "     The Runtime does NOT navigate. It re-reads whatever page your login left",
    "     you on. If that is not the export surface, the run ENDS — terminal",
    "     UNSUPPORTED_STATE — and this run's approval is spent. Nothing enforces",
    "     this step but you.",
    "",
    "  3) Signal readiness by creating the sentinel file shown below AGAIN (in Claude",
    `     Code, just say "ready"). The previous one was cleared on purpose, so a`,
    "     leftover signal cannot be mistaken for this one.",
    "",
    `You have about ${Math.round(budgetMs / 60_000)} MINUTE(S) of recovery time left across all attempts.`,
    "If it lapses the run stays parked and closes down — safe, but the approval is spent.",
    "",
    "If you signal and your session is good, the collector re-checks and then HIGHLIGHTS",
    "the one export control, and the normal two windows begin:",
    `  1) up to ${Math.round(OBSERVE_TIMEOUT_MS / 60_000)} MINUTES from the highlight for YOU to act on it.`,
    `  2) then ${Math.round(DOWNLOAD_TIMEOUT_MS / 1_000)} SECONDS from YOUR action for a download to start.`,
    "",
    ...(declineIngest ? PROMPT_NO_INGEST : PROMPT_INGEST),
    "(Ctrl-C to abort.)",
  ].join("\n");
}

const PROMPT_TAIL = [
  "For a run that is non-mutating BY CONSTRUCTION, do not act at all: let window 2",
  "lapse. No download means no artifact, and nothing is written anywhere.",
  "",
  "If a window lapses the run fails closed: no download, nothing written anywhere.",
  "That is safe — but this run's approval is spent, and a retry needs a fresh one.",
  "(Ctrl-C to abort.)",
];

/**
 * OPERATOR-LOCAL export-scope read-back prompt (Run 7 attempt-3 finding). Formats the seller's own
 * selected range / filters so they can confirm the scope that WILL export before acting. Returns a
 * plain string the caller prints to stderr — it is NEVER logged, persisted, or sent over the wire
 * (see `readExportScope`). An empty read-back tells the operator the runtime could not read a range,
 * which is itself worth surfacing (they should verify manually).
 */
function exportScopePrompt(scope: ExportScopeReadback): string {
  const lines = [
    "",
    "  >> CONFIRM THE EXPORT SCOPE — this is what WILL export, not just what is on screen. <<",
  ];
  if (scope.rangeValues.length > 0) {
    lines.push(`     Selected range/date values: ${scope.rangeValues.join("  ·  ")}`);
  } else {
    lines.push("     Selected range/date values: (none read — verify the period on screen yourself)");
  }
  if (scope.filterLabels.length > 0) {
    lines.push(`     Active filters: ${scope.filterLabels.join("  ·  ")}`);
  }
  lines.push(
    "     If this is NOT the range you intend to export (e.g. it excludes the answered review",
    "     you meant to include), fix the period/filters on the page BEFORE you act. §8.",
    "",
  );
  return lines.join("\n");
}

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

/**
 * Poll for the sentinel file up to `timeoutMs`. Bounded by a fixed iteration count, and `waitedMs` is
 * derived from that count rather than a wall-clock read — the same convention `export-surface-settle.ts`
 * uses. The recovery budget is spent against this number, so it must not depend on the clock.
 *
 * ⚠ PRECONDITION (carried verbatim from `probe-same-session.ts`, where this helper's docstring lives and
 * where THIS copy dropped it): **the caller clears any stale sentinel BEFORE calling this**, so a hit here
 * only ever reflects a post-startup creation. `awaitFreshSentinel` is that precondition made structural.
 */
async function waitForSentinel(path: string, timeoutMs: number, intervalMs: number): Promise<SentinelWait> {
  const maxChecks = Math.max(1, Math.ceil(timeoutMs / intervalMs));
  for (let i = 0; i < maxChecks; i += 1) {
    if (existsSync(path)) return { ready: true, waitedMs: i * intervalMs };
    await sleep(intervalMs);
  }
  return { ready: existsSync(path), waitedMs: maxChecks * intervalMs };
}

/**
 * Clear any stale sentinel, THEN wait for a new one — `waitForSentinel`'s documented precondition, enforced
 * structurally instead of by hoping the caller remembers.
 *
 * This exists because the recovery wait is the SECOND use of a handshake built for exactly one. `main()`
 * clears the sentinel at startup and in its `finally` — never in between — so the "ready" file the seller
 * created before the run is still on disk when a park happens. Without the removal below, the wait returns
 * `true` on its first `existsSync`: the recheck fires milliseconds after the park against the same
 * logged-out page, re-parks, and drains the loop — logging an exhaustion that is indistinguishable from a
 * seller who walked away. The seller never gets a chance and nothing errors. This one line is the guard.
 *
 * ⚠ The caller must not `await` between printing the prompt and calling this: the removal is only safe
 * because it lands in the same synchronous tick as the prompt, so no operator can interleave a signal.
 */
export async function awaitFreshSentinel(path: string, timeoutMs: number, intervalMs: number): Promise<SentinelWait> {
  removeSentinel(path);
  return waitForSentinel(path, timeoutMs, intervalMs);
}

/* ─────────────────────── DEV-ONLY live-debug campaign (sprint) ─────────────────────── */

/** DEV-ONLY bounds for ONE seated live-debug campaign (2026-07-24 sprint). Not product behavior. */
const MAX_DEBUG_ATTEMPTS = 5;
const CAMPAIGN_BUDGET_MS = 90 * 60_000;

/** The operator-identified disambiguation hint file, alongside the sentinel in the gitignored `.status`. */
function debugHintPathFor(sentinelPath: string): string {
  return join(dirname(sentinelPath), "aw-debug-selection.json");
}

/** Read a sanitized `{selectLabel:"B2"}` hint, accepting ONLY an `A#`/`B#` label. Anything else ⇒ none. */
function readDebugHint(path: string): string | undefined {
  try {
    if (!existsSync(path)) return undefined;
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { selectLabel?: unknown };
    const label = typeof parsed.selectLabel === "string" ? parsed.selectLabel.trim() : "";
    return /^[AB]\d+$/.test(label) ? label : undefined;
  } catch {
    return undefined;
  }
}

function removeDebugHint(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    /* best-effort */
  }
}

/** Operator-local (stderr, never logged/transported) sanitized dump of the labelled candidates. */
function debugCandidatesPrompt(ins: CandidateInspection): string {
  const lines = [
    "",
    "  >> CANDIDATE CONTINUATION CONTROLS — sanitized labels are drawn ON the page (A=magenta, B=green) <<",
    `     dialogs:${ins.dialogCount}  path-A:${ins.pathACount}  path-B:${ins.pathBCount}  overlap:${ins.overlapCount}`,
  ];
  if (ins.candidates.length === 0) {
    lines.push("     (no eligible candidate in THIS frame — the real dialog may be cross-frame)");
  }
  for (const c of ins.candidates) {
    lines.push(`       ${c.label}  via=${c.via}  kind=${c.tagBucket}  enabled=${c.enabled}  inDialog=${c.inExportDialog}`);
  }
  lines.push(
    "     Which VISIBLE label is the real consent action? Set the hint, then say the next attempt go.",
    "",
  );
  return lines.join("\n");
}

/** Short between-attempt prompt (session + scope are reused; the operator just re-arms). */
function debugAttemptPrompt(attempt: number, remainingMin: number): string {
  return [
    "",
    "─".repeat(64),
    ` DEV LIVE-DEBUG — attempt ${attempt}/${MAX_DEBUG_ATTEMPTS} · ~${remainingMin} min left in this campaign`,
    "─".repeat(64),
    "  Same browser, same login, same selected scope — nothing is reloaded.",
    "  Re-confirm your 1점 scope on screen, then act on the highlighted export control.",
    "  The Runtime never clicks. A started+validated download ingests into the disposable backend.",
    "",
  ].join("\n");
}

/**
 * DEV-ONLY seated live-debug campaign (the 2026-07-24 sprint). Reuses ONE browser/context + the
 * operator's on-page scope across up to `MAX_DEBUG_ATTEMPTS` / `CAMPAIGN_BUDGET_MS`. Each attempt: wait
 * for the operator's "attempt N go" sentinel, read back the export scope, drive one run. On the
 * continuation fail-closed the driver has overlaid sanitized candidate labels — printed here so the
 * operator can name the real consent action (written to the hint file, honored next attempt). Aborts
 * immediately on backend-target drift (non-loopback), profile loss (page closed), or any terminal
 * surface/ingest failure that is NOT the consent-dialog `DOWNLOAD_TIMEOUT`. Never clicks; the reply flag
 * is never reachable here. The disposable backend is left intact (teardown is the operator's guarded step).
 */
async function runDebugCampaign(
  page: Page,
  deps: LiveRunDeps,
  sentinelPath: string,
  baseUrl: string,
  onAssembled: (a: AssembledLiveRun) => void,
): Promise<void> {
  const loopback = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/i.test(baseUrl);
  if (!loopback) {
    log("aw.live.debug", { event: "abort-backend-target-drift" });
    console.error("ABORT: live-debug campaign requires a loopback disposable backend; refusing.");
    return;
  }
  const hintPath = debugHintPathFor(sentinelPath);
  removeDebugHint(hintPath);
  log("aw.live.debug", { event: "campaign-start", maxAttempts: MAX_DEBUG_ATTEMPTS });
  const startedAt = Date.now();

  for (let attempt = 1; attempt <= MAX_DEBUG_ATTEMPTS; attempt += 1) {
    const elapsed = Date.now() - startedAt;
    if (elapsed > CAMPAIGN_BUDGET_MS) {
      log("aw.live.debug", { event: "campaign-timeout", attempt });
      break;
    }
    const remainingMin = Math.max(0, Math.round((CAMPAIGN_BUDGET_MS - elapsed) / 60_000));
    console.error(attempt === 1 ? confirmPrompt(deps.declineIngest) : debugAttemptPrompt(attempt, remainingMin));
    console.error("  Sentinel file (create this when ready):");
    console.error(`    ${sentinelPath}`);
    console.error("");
    const wait = await awaitFreshSentinel(sentinelPath, CONFIRM_TIMEOUT_MS, SENTINEL_POLL_INTERVAL_MS);
    if (!wait.ready) {
      log("aw.live.debug", { event: "sentinel-timeout", attempt });
      break;
    }
    if (page.isClosed()) {
      log("aw.live.debug", { event: "abort-profile-loss", attempt });
      break;
    }
    await settleSpa(page);

    const selectLabel = readDebugHint(hintPath);
    const assembled = assembleLiveRun(page, deps, selectLabel);
    onAssembled(assembled);
    // Clear the PRIOR attempt's labels / seen-stamps now that the operator has answered — fresh DOM slate.
    await assembled.driver.clearContinuationDebug();
    console.error(exportScopePrompt(await assembled.driver.readExportScope()));
    log("aw.live.debug", { event: "attempt-start", attempt, hinted: selectLabel !== undefined });

    let view: ActionWindowRunView | undefined;
    try {
      view = await driveOneRun(assembled.session, assembled.client, { observeTimeoutMs: deps.observeTimeoutMs });
    } catch {
      // A non-convergence (`whenSettled did not converge`) or a transient page error: treat as a failed
      // attempt (bounded), never a campaign crash. Nothing was clicked or captured.
      log("aw.live.debug", { event: "drive-threw", attempt });
      view = assembled.client.view;
    }

    const status = view?.status;
    const blockerCode = view?.blocker?.code;
    log("aw.live.run", { status, ...(blockerCode ? { blockerCode } : {}) });
    const continuation = assembled.driver.lastContinuation();
    if (continuation) log("aw.live.continuation", { ...continuation });
    const inspection = assembled.driver.lastInspection();
    if (inspection) {
      log("aw.live.debug.candidates", {
        attempt,
        dialogCount: inspection.dialogCount,
        pathACount: inspection.pathACount,
        pathBCount: inspection.pathBCount,
        overlapCount: inspection.overlapCount,
        total: inspection.candidates.length,
      });
      console.error(debugCandidatesPrompt(inspection));
    }

    if (status === "COMPLETED") {
      log("aw.live.debug", { event: "success", attempt });
      console.error(`\n  >> LIVE-DEBUG SUCCESS on attempt ${attempt}: export detected + ingested. <<\n`);
      return;
    }
    // Only the consent-dialog fail-closed retries; anything else terminal is drift/ingest → stop and report.
    if (!(status === "FAILED" && blockerCode === "DOWNLOAD_TIMEOUT")) {
      log("aw.live.debug", { event: "abort-non-continuation-failure", attempt, ...(blockerCode ? { blockerCode } : {}) });
      console.error(`\n  ABORT: attempt ${attempt} ended in ${status ?? "unknown"}${blockerCode ? "/" + blockerCode : ""} — not the consent-dialog case. Stopping the campaign.\n`);
      return;
    }
    // Consume the hint that just failed so a stale one never auto-applies; the operator re-sets it.
    removeDebugHint(hintPath);
  }
  log("aw.live.debug", { event: "campaign-end" });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const declineIngest = hasNoIngest(args);
  const sessionRecovery = hasSessionRecovery(args);
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
  const liveDebug = (process.env.AW_LIVE_DEBUG ?? "") === "1";
  if (liveDebug) log("aw.live.debug", { event: "enabled" });
  const deps = buildLiveRunDeps(cfg, collectorRoot, { declineIngest, liveDebug });
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

    if (deps.liveDebug) {
      // DEV-ONLY seated campaign — the outer finally still owns teardown (cleanup + sentinel + ctx.close).
      await runDebugCampaign(page, deps, sentinelPath, cfg.baseUrl, (a) => {
        assembled = a;
      });
      return;
    }

    console.error(confirmPrompt(declineIngest, sessionRecovery));
    console.error("");
    console.error("  Sentinel file (create this when ready):");
    console.error(`    ${sentinelPath}`);
    console.error("");
    const { ready } = await waitForSentinel(sentinelPath, CONFIRM_TIMEOUT_MS, SENTINEL_POLL_INTERVAL_MS);
    if (!ready) {
      console.error("No sentinel within the timeout; aborting without driving a run.");
      log("aw.live.aborted", { reason: "sentinel-timeout" });
      return;
    }

    await settleSpa(page);
    assembled = assembleLiveRun(page, deps);
    // OPERATOR-LOCAL export-scope read-back (Run 7 attempt-3 finding): show the seller the range /
    // filters that will ACTUALLY export, so they confirm the real scope rather than a review visible
    // elsewhere on the page. Printed to the operator's own console ONLY — never through `log()`, never
    // over the wire, never persisted (see `readExportScope`'s contract).
    console.error(exportScopePrompt(await assembled.driver.readExportScope()));
    const view = await driveOneRun(assembled.session, assembled.client, {
      // A2-B made login/session blockers RECOVERABLE; until A3 this CLI could not exercise that, because
      // the `finally` below closes the browser the instant this returns. Wiring the gate here is what makes
      // the capability reachable on the live path — and it is the whole point of the slice.
      awaitRecovery: async (code, attempt, budgetMs) => {
        console.error(recoveryPrompt(code, attempt, budgetMs, declineIngest));
        console.error("  Sentinel file (create this again when ready):");
        console.error(`    ${sentinelPath}`);
        console.error("");
        // NO `await` may be introduced above this line — the stale-sentinel removal inside
        // `awaitFreshSentinel` is only safe while it shares a synchronous tick with the prompt.
        const wait = await awaitFreshSentinel(
          sentinelPath,
          Math.min(budgetMs, CONFIRM_TIMEOUT_MS),
          SENTINEL_POLL_INTERVAL_MS,
        );
        // The seller just logged in and navigated; give the page a chance to land before we read it.
        // Best-effort only — the driver's own readiness settle handles hydration.
        if (wait.ready) await settleSpa(page);
        return wait;
      },
      // Per-attempt readiness evidence. The single post-run line below reports only the LAST probe, which
      // after a recovery is the post-login one — but it cannot show the PROGRESSION (pre-login halt vs
      // post-login halt), and that progression is exactly D-028's falsifier: does the seller still see a
      // readiness-READY export surface after logging in? `recoverLoop` withholds this call on a thrown
      // probe, when the diagnostic would be stale.
      onRecoveryProbe: (attempt) => {
        const diagnostic = assembled?.driver.prepareDiagnostic();
        if (diagnostic) log("aw.live.readiness", { ...diagnostic, attempt });
      },
    });

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
    // The continuation-checkpoint evidence seam (Run 7 attempt-2 finding): how many NAVER-native
    // follow-up controls were highlighted before the download, whether the last one was acted on,
    // and whether detection failed closed on ambiguity. Booleans + a small count only; never
    // transported, never persisted.
    const continuation = assembled.driver.lastContinuation();
    if (continuation) log("aw.live.continuation", { ...continuation });
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
