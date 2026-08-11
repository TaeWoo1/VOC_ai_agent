/**
 * **Action Window Runtime — Coupang WING API-issuance guidance engine (ISOLATED, v2).**
 *
 * A pure reducer for ONE guided Coupang WING open-API issuance walk: the seller logs in, reaches the open-API
 * issuance page, selects 자체개발, confirms 업체명, sets the 호출 IP, presses 발급 themselves, and
 * ⚠ **This sequence is FALSIFIED by live evidence and the walk it describes is FENCED OFF**
 * (`COUPANG_WING_GUIDED_ISSUANCE_FENCED`). 자체개발 / 호출 IP match 0 and 업체명 never resolves uniquely on the
 * real no-key surface, and 발급 opens a configuration step rather than creating the key. Left unchanged
 * pending the Stage-2 observation — see `coupang-issuance-stages.ts`. The original wording said "presses
 * 발급 **to issue the key**", which was the specific claim that was wrong.
 * copies the Access Key / Secret Key / 업체코드 into SellerOps's own masked form — every real step theirs. The
 * runtime observes a sanitized page category, highlights the one control to press next, watches the seller's own
 * click, and advances. It is a fixed 7-step LINE (no branch).
 *
 * **The guarantees this engine exists to make structural:**
 *
 *  1. **It never acts on WING.** There is no effect that logs in, clicks, submits, issues a key, or reads a
 *     credential VALUE. The effects are PROBE / VERIFY_REACH / locate / highlight / observe / CLEAR_HIGHLIGHT /
 *     CLEANUP — all observation or annotation.
 *  2. **`발급` (issue) is an explicit human checkpoint.** The runtime highlights the 발급 button and RESTS; the
 *     seller presses it themselves and advances with "다음". The engine never auto-advances the issue step and
 *     never arms a click observer for it.
 *  3. **`COMPLETED` means the GUIDANCE finished, nothing more.** No credential is stored, no connection made.
 *  4. **Every stop the seller can clear is recoverable.** A login gate, a missing control, or an unexpected page
 *     PARK (not FAIL). A `REQUEST_STEP_RECHECK` re-probes / re-guides.
 *
 * Pure: no I/O, no browser, no wall-clock.
 */
import type { ActionWindowRunView, EventEnvelope, EventPayload, EventType, RunStatus } from "../../../../contracts/action-window/v2/index";
import { branchAfterWingProbe } from "../../cli/coupang-wing-classifier";
import { COUPANG_TARGET_BARRIER_STAGE, isCoupangCheckpointTarget, type CoupangIssuanceTarget, type WingSurfaceProbe } from "./coupang-issuance-driver";
import type { LocateResult } from "../engine";
import {
  COUPANG_ISSUANCE_PAUSED_COMMANDS,
  COUPANG_ISSUANCE_RUN_COPY_KEY,
  COUPANG_ISSUANCE_TOTAL_STEPS,
  coupangIssuanceAllowedCommands,
  coupangIssuanceStageToRunStatus,
  coupangIssuanceStageToStepStatus,
  coupangIssuanceStepMetaAt,
  coupangIssuanceStepPlan,
  isCoupangIssuanceBarrier,
  isCoupangIssuanceObservedWait,
  isCoupangIssuancePark,
  isCoupangIssuanceTerminal,
  type CoupangIssuanceStage,
} from "./coupang-issuance-stages";

/** What the session should do next. Every one is observation or annotation — never a marketplace action. */
export type CoupangIssuanceEffect =
  | "PROBE"
  /**
   * Re-probe the surface to VERIFY the seller reached the open-API issuance page after the `reach_open_api`
   * navigation guidance — step 1 completes only on a confirmed `open_api_issuance`; a wrong page / login parks
   * recoverably. Distinct from `PROBE` (which expects the WING home / issuance page at the top).
   */
  | "VERIFY_REACH"
  /**
   * Keep WATCHING for a WING surface we recognize, re-probing on the session's own cadence.
   *
   * This replaces a park. The dedicated window opens on a blank tab, so the very FIRST probe of every run was
   * guaranteed to be `unknown` and the run parked on `page_mismatch` — telling a seller who has not logged in
   * yet that "화면이 바뀐 것 같아요", and then never recovering on its own. Not being there yet is the expected
   * state at the start of a walk, not drift.
   */
  | "AWAIT_SURFACE"
  /** Locate → highlight → arm the barrier for one control, as a single batched step in the session. */
  | { guide: CoupangIssuanceTarget }
  | { observe: CoupangIssuanceTarget }
  | "CLEAR_HIGHLIGHT"
  | "CLEANUP"
  | "NONE";

export type CoupangIssuanceCommandOutcome =
  | { ok: true; idempotent: boolean; effect: CoupangIssuanceEffect }
  | { ok: false; reason: string };

export interface CoupangIssuanceRunConfig {
  runId: string;
  /** Sanitized channel identity (SEMANTIC_CODE) — always `coupang`. */
  channelCode: string;
}

export type CoupangIssuanceClock = () => string;

/** Synthetic monotonic occurrence marker (NOT wall-clock). `occurredAt` is opaque, display-only. */
export function makeCoupangIssuanceClock(start = 1): CoupangIssuanceClock {
  let n = start;
  return () => `2026-01-01T00:00:00.${String(n++).padStart(6, "0")}Z`;
}

/**
 * An opaque 16-hex target signature — the ONLY shape allowed to become a `targetRef` on the wire. The engine
 * validates every `LocateResult.sig` against this before using it, so a driver that ever returned a raw value (a
 * selector, an id, or a credential) as its "signature" fails closed at the barrier rather than emitting it.
 */
const HEX16 = /^[0-9a-f]{16}$/;

/**
 * The stages a surface probe is allowed to move. Every `PROBE` is issued from `opening` (`start` and the
 * park/wait `recheck` both set it), and every surface-wait poll runs in one of the two waits — so anything else
 * arriving here is a SECOND reader arriving after the first already advanced the run.
 */
const PROBE_ADVANCEABLE_STAGES: readonly CoupangIssuanceStage[] = ["opening", "waiting_login", "awaiting_wing_surface"];

const TARGET_BARRIER = COUPANG_TARGET_BARRIER_STAGE;
const TARGET_STEP: Readonly<Record<CoupangIssuanceTarget, number>> = {
  reach_open_api: 1,
  issue: 2,
  confirm_purpose: 3,
  terms_consent: 4,
  issue_final: 5,
  credentials: 6,
  return: 7,
};

export class CoupangIssuanceEngine {
  private readonly runId: string;
  private readonly channelCode: string;
  private readonly clock: CoupangIssuanceClock;

  private started = false;
  private stage: CoupangIssuanceStage = "opening";
  private revision = 0;
  private seq = 0;
  private activeStepIndex = 1;
  private completedSteps = 0;
  private guidanceEnabled = true;
  /** The control the current barrier/checkpoint rests on, so a recheck/resume re-guides the right section. */
  private currentTarget: CoupangIssuanceTarget | null = null;
  private targetSig: Partial<Record<CoupangIssuanceTarget, string>> = {};
  private blockerCode: "LOGIN_REQUIRED" | "TARGET_NOT_FOUND" | "UI_DRIFT" | "SURFACE_SETTLE_TIMEOUT" | null = null;
  private blockerRecoverable = false;
  /** A pause is an overlay on a barrier, not a stage — the product's stage list is exactly 14. */
  private paused = false;
  private readonly log: EventEnvelope[] = [];

  constructor(config: CoupangIssuanceRunConfig, opts?: { clock?: CoupangIssuanceClock }) {
    this.runId = config.runId;
    this.channelCode = config.channelCode;
    this.clock = opts?.clock ?? makeCoupangIssuanceClock();
  }

  /* ── inbound command ─────────────────────────────────────────────────────── */

  command(command: { type: string; expectedRevision: number }): CoupangIssuanceCommandOutcome {
    if (!this.started) {
      if (command.type !== "START_RUN") return { ok: false, reason: "INVALID_FOR_STATE" };
      return { ok: true, idempotent: false, effect: this.start() };
    }
    if (command.type === "START_RUN") return { ok: true, idempotent: true, effect: "NONE" };
    if (command.expectedRevision < this.revision) return { ok: false, reason: "STALE_REVISION" };
    const allowed = this.paused ? COUPANG_ISSUANCE_PAUSED_COMMANDS : coupangIssuanceAllowedCommands(this.stage);
    if (!allowed.includes(command.type as never)) return { ok: false, reason: "INVALID_FOR_STATE" };
    switch (command.type) {
      case "SET_GUIDANCE_ENABLED":
      case "FIND_CURRENT_STEP":
        return { ok: true, idempotent: true, effect: "NONE" };
      case "PAUSE_RUN":
        return { ok: true, idempotent: false, effect: this.pause() };
      case "RESUME_RUN":
        return { ok: true, idempotent: false, effect: this.resume() };
      case "CANCEL_RUN":
        return { ok: true, idempotent: false, effect: this.abort() };
      case "SWITCH_TO_MANUAL":
        return { ok: true, idempotent: false, effect: this.abort() };
      case "REQUEST_STEP_RECHECK":
        return { ok: true, idempotent: false, effect: this.recheck() };
      default:
        return { ok: false, reason: "INVALID_FOR_STATE" };
    }
  }

  /**
   * "I did it, look again." — the repair at a park, and "다음" at a checkpoint.
   *
   * <p>Recovery depends on WHERE the seller is:
   * <ul>
   *   <li><b>Park while guiding a same-page CHECKPOINT</b> (자체개발 / 업체명 / 호출 IP / 발급 / keys / return) →
   *       RE-GUIDE that section IN PLACE (re-settle → re-locate → re-highlight). The seller is on the issuance
   *       page, NOT the WING home — re-probing would reclassify their legitimate issuance page and dead-end
   *       them.</li>
   *   <li><b>Park with no checkpoint in flight</b> (the initial probe, a login gate, or the `reach_open_api`
   *       transition) → re-probe the surface from the top; the seller belongs back on the WING home.</li>
   *   <li><b>Checkpoint barrier</b> → "다음" advances it.</li>
   *   <li><b>reach_open_api barrier</b> → re-arm the navigation observation.</li>
   * </ul>
   *
   * <p>An OBSERVED WAIT takes the same path as a park. It is not one — nothing is blocked and the runtime is
   * still looking — but "look again" means exactly the same thing there, and a recheck that resolved to `NONE`
   * was the reason the wait had no way out once its window elapsed.
   */
  private recheck(): CoupangIssuanceEffect {
    if (isCoupangIssuancePark(this.stage) || isCoupangIssuanceObservedWait(this.stage)) {
      if (this.currentTarget && isCoupangCheckpointTarget(this.currentTarget)) {
        const target = this.currentTarget;
        this.blockerCode = null;
        this.blockerRecoverable = false;
        this.activeStepIndex = TARGET_STEP[target];
        // Re-locate as AUTOMATIC work (RUNNING), NOT a barrier, so the FE never sees a "press this highlighted
        // control" barrier before the re-highlight exists; a concurrent recheck while this automatic stage shows
        // resolves to NONE, so it cannot double-guide.
        this.stage = "locating_open_api";
        this.emit("RUN_STATUS_CHANGED", { status: "RUNNING" });
        return { guide: target };
      }
      this.blockerCode = null;
      this.blockerRecoverable = false;
      this.stage = "opening";
      this.activeStepIndex = 1;
      this.currentTarget = null;
      this.emit("RUN_STATUS_CHANGED", { status: "PREPARING" });
      return "PROBE";
    }
    if (isCoupangIssuanceBarrier(this.stage) && this.currentTarget) {
      // At a same-page VIEWPORT CHECKPOINT, `REQUEST_STEP_RECHECK` IS the operator's "다음": there is no WING
      // action to re-observe — the seller acted on the highlighted section — so it COMPLETES the checkpoint and
      // guides the next control. At the transition-observe barrier (reach_open_api) it re-arms the navigation
      // observation (the runtime alone decides the transition happened, by observing it).
      if (isCoupangCheckpointTarget(this.currentTarget)) return this.advanceCheckpoint(this.currentTarget);
      return { observe: this.currentTarget };
    }
    return "NONE";
  }

  /**
   * "다음" at a viewport checkpoint: the operator confirmed they acted on the highlighted section (자체개발 / 업체명
   * / 호출 IP / 발급 / keys / return). No WING click was observed — a checkpoint is a same-page pointer — so this
   * COMPLETES the step and guides the next control. Only meaningful while resting on that checkpoint's barrier.
   */
  private advanceCheckpoint(target: CoupangIssuanceTarget): CoupangIssuanceEffect {
    if (this.currentTarget !== target || this.stage !== TARGET_BARRIER[target]) return "NONE";
    this.completedSteps = this.activeStepIndex;
    this.emit("STEP_COMPLETED", { stepId: this.stepId(), stepStatus: "COMPLETED" });
    return this.advanceAfterBarrier(target);
  }

  /* ── automatic-drive callbacks ────────────────────────────────────────────── */

  private start(): CoupangIssuanceEffect {
    this.started = true;
    this.stage = "opening";
    this.activeStepIndex = 1;
    this.emit("RUN_STARTED", { status: "PREPARING" });
    this.emit("RUN_STATUS_CHANGED", { status: "PREPARING" });
    return "PROBE";
  }

  /**
   * The sanitized page category the seller is on. login parks; wing_home guides the reach_open_api
   * transition-observe (step 1); open_api_issuance completes step 1 automatically and guides 자체개발; anything
   * else parks recoverably.
   */
  onSurfaceProbed(probe: WingSurfaceProbe): CoupangIssuanceEffect {
    if (isCoupangIssuanceTerminal(this.stage)) return "NONE";
    // ONLY a run that has not yet reached its first guided control may be advanced by a probe. Two readers can
    // reach here at once — a surface-wait poll and a `REQUEST_STEP_RECHECK`'s `PROBE` — and without this the
    // SECOND one re-ran the whole branch on a run the first had already advanced: `STEP_COMPLETED` for step 1
    // emitted twice and two independent `{guide:"issue"}` chains armed on one target. The same target+stage
    // re-check `advanceCheckpoint` has always done, applied to the probe path that was missing it.
    if (!PROBE_ADVANCEABLE_STAGES.includes(this.stage)) return "NONE";
    if (!probe.ok || probe.blockerCode === "LOGIN_REQUIRED" || probe.pageCategory === "login") {
      // A wait, not a park: the seller logs in inside the WING window and the runtime notices by itself. It used
      // to need a `REQUEST_STEP_RECHECK` from the SellerOps tab, which is the tab they were told not to return to.
      this.waitingFor("waiting_login", "LOGIN_REQUIRED");
      return "AWAIT_SURFACE";
    }
    const { branch } = branchAfterWingProbe(probe.pageCategory);
    if (branch === "open_api") {
      // Already on the issuance page — step 1 (reach the open-API page) is done automatically.
      this.stage = "locating_open_api";
      this.activeStepIndex = 1;
      this.emit("RUN_STATUS_CHANGED", { status: "RUNNING" });
      this.completedSteps = 1;
      this.emit("STEP_COMPLETED", { stepId: this.stepIdFor(1), stepStatus: "COMPLETED" });
      this.activeStepIndex = 2;
      this.currentTarget = "issue";
      return { guide: "issue" };
    }
    if (branch === "wing_home") {
      // The seller is on the WING home — guide the reach_open_api transition-observe (step 1).
      this.stage = "locating_open_api";
      this.activeStepIndex = 1;
      this.emit("RUN_STATUS_CHANGED", { status: "RUNNING" });
      this.currentTarget = "reach_open_api";
      return { guide: "reach_open_api" };
    }
    // Anything else is a page we do not recognize YET. Watch, do not park: at run start this is the blank tab
    // the window opened on, and mid-walk it is most often a page still settling.
    return this.awaitSurface();
  }

  /** Locate result for the control being guided. Not found / not unique → recoverable target_not_found. */
  onTargetLocated(target: CoupangIssuanceTarget, res: LocateResult): CoupangIssuanceEffect {
    if (isCoupangIssuanceTerminal(this.stage)) return "NONE";
    // Not unique, OR a signature that is not an opaque 16-hex token → park. The hex check is fail-closed against
    // a driver that returned a raw value as its "sig": such a value must never reach `targetRef`.
    if (res.count !== 1 || !res.sig || !HEX16.test(res.sig)) return this.park("target_not_found", "TARGET_NOT_FOUND");
    this.targetSig[target] = res.sig;
    return { guide: target }; // session proceeds to highlight; kept as a `guide` continuation marker
  }

  /**
   * The driver re-validated while annotating. A changed unique match between locate and highlight means the page
   * moved under us, so park on `page_mismatch` rather than highlight the wrong control (anti-drift).
   */
  onTargetHighlighted(target: CoupangIssuanceTarget, res: LocateResult): CoupangIssuanceEffect {
    if (isCoupangIssuanceTerminal(this.stage)) return "NONE";
    if (res.count !== 1 || !res.sig || !HEX16.test(res.sig) || res.sig !== this.targetSig[target]) {
      const effect = this.park("page_mismatch", "UI_DRIFT");
      return effect === "NONE" ? "CLEAR_HIGHLIGHT" : effect;
    }
    this.stage = TARGET_BARRIER[target];
    this.activeStepIndex = TARGET_STEP[target];
    this.currentTarget = target;
    this.emit("STEP_READY", { stepId: this.stepId(), stepStatus: "READY" });
    this.emit("HUMAN_ACTION_REQUIRED", { stepId: this.stepId() });
    this.emit("TARGET_HIGHLIGHTED", { stepId: this.stepId(), targetRef: res.sig });
    this.emit("RUN_STATUS_CHANGED", { status: "WAITING_FOR_HUMAN" });
    // WING-RESIDENT advance: every step now arms an observation the driver reports ON the WING page, so the seller
    // never bounces back to the SellerOps tab to press "다음". A same-page VIEWPORT CHECKPOINT (자체개발 / 업체명 /
    // 호출 IP / 발급 / keys / return) arms an observation of its WING-resident advance button (highlighted +
    // scrolled into view, the run RESTS until the seller presses it); the transition-observe target
    // (reach_open_api) arms an observation of the seller's navigation. A `REQUEST_STEP_RECHECK` from the FE stays
    // valid as a fallback/recovery — `advanceCheckpoint` guards against double-advance either way.
    return { observe: target };
  }

  /**
   * The seller acted on the control. An OBSERVATION — it advances only a still-open barrier for that same target,
   * so a late or duplicated observation cannot skip a step. `reach_open_api` is the ONLY observed target.
   */
  onUserActionObserved(target: CoupangIssuanceTarget): CoupangIssuanceEffect {
    if (this.currentTarget !== target || this.stage !== TARGET_BARRIER[target]) return "NONE";
    // The driver observed the seller LEAVE the WING home, but step 1 is not done until we re-probe and confirm
    // they reached the open-API issuance page. Defer completion to `onReachVerified` so a wrong page parks.
    if (target === "reach_open_api") return "VERIFY_REACH";
    // A same-page CHECKPOINT completes when the driver observes the seller press its WING-resident advance button.
    // `advanceCheckpoint` re-checks target + stage, so a late or duplicated observation (or a racing FE
    // `REQUEST_STEP_RECHECK`) cannot skip a step or advance the wrong one — the second caller resolves to NONE.
    return this.advanceCheckpoint(target);
  }

  /**
   * Verify the seller reached the open-API issuance page after the `reach_open_api` navigation guidance (the
   * `VERIFY_REACH` re-probe). Only meaningful while still resting on the `reach_open_api` barrier.
   *   - `open_api_issuance` → step 1 (reach the open-API page) is done — emit the observation + completion and
   *     guide 자체개발 (step 2).
   *   - `login` → the session expired mid-navigation; park recoverably on `waiting_login`.
   *   - anything else (still on the home, a wrong page, or a multi-hop landing) → recoverable `page_mismatch`.
   */
  onReachVerified(probe: WingSurfaceProbe): CoupangIssuanceEffect {
    if (isCoupangIssuanceTerminal(this.stage)) return "NONE";
    if (this.stage !== TARGET_BARRIER.reach_open_api || this.currentTarget !== "reach_open_api") return "NONE";
    if (!probe.ok || probe.blockerCode === "LOGIN_REQUIRED" || probe.pageCategory === "login") {
      // A WAIT, exactly as on the probe path. This branch was left as a park when the other one was converted,
      // and live on 2026-08-10 it swallowed a whole run: one login reading during the seller's navigation put
      // the walk in a park that never looked again, so reaching the issuance page changed nothing.
      this.waitingFor("waiting_login", "LOGIN_REQUIRED");
      return "AWAIT_SURFACE";
    }
    if (probe.pageCategory === "open_api_issuance") {
      this.emit("USER_ACTION_OBSERVED", { stepId: this.stepId(), observed: true });
      this.completedSteps = this.activeStepIndex; // step 1 (reach the open-API issuance page)
      this.emit("STEP_COMPLETED", { stepId: this.stepId(), stepStatus: "COMPLETED" });
      this.currentTarget = "issue";
      return { guide: "issue" };
    }
    // Still on the way (the home, an intermediate hop, a page mid-hydration) → keep watching. The seller is
    // moving through WING; "not there yet" is not drift, and it must not need a command from the other tab.
    return this.awaitSurface();
  }

  /** Where the run goes once a barrier's control has been acted on. */
  private advanceAfterBarrier(target: CoupangIssuanceTarget): CoupangIssuanceEffect {
    switch (target) {
      // `reach_open_api` never reaches here — its barrier advances via `onReachVerified` (issuance-page
      // verification), not this checkpoint path. Kept only so the switch stays exhaustive.
      case "reach_open_api":
        this.currentTarget = "issue";
        return { guide: "issue" };
      // MEASURED: 발급 opens the purpose screen. It does not create a key, and this hop no longer pretends it
      // does — the old plan went `issue → credentials`, i.e. straight from a press that reveals a form to
      // "copy your keys", past two screens and the control that actually issues.
      //
      // The purpose screen is ONE step, not two. `OPEN API` is already selected, so a separate "confirm the
      // radio" step asked the seller to verify something nobody had asked them to change and then made them
      // advance twice through a single screen. That check is a clause in `confirm_purpose`'s copy now.
      case "issue":
        this.currentTarget = "confirm_purpose";
        return { guide: "confirm_purpose" };
      case "confirm_purpose":
        this.currentTarget = "terms_consent";
        return { guide: "terms_consent" };
      case "terms_consent":
        this.currentTarget = "issue_final";
        return { guide: "issue_final" };
      // THE KEY-CREATION BOUNDARY. Only after the seller reports pressing it can a credential exist to copy.
      case "issue_final":
        this.currentTarget = "credentials";
        return { guide: "credentials" };
      case "credentials":
        this.currentTarget = "return";
        return { guide: "return" };
      case "return":
        return this.complete();
    }
  }

  private complete(): CoupangIssuanceEffect {
    this.stage = "guidance_complete";
    this.activeStepIndex = COUPANG_ISSUANCE_TOTAL_STEPS;
    this.completedSteps = COUPANG_ISSUANCE_TOTAL_STEPS;
    this.currentTarget = null;
    // "completed" is the guidance finishing — NOT a stored credential or a made connection.
    this.emit("RUN_COMPLETED", { status: "COMPLETED" });
    return "CLEANUP";
  }

  /**
   * The seller closed the WING window. Not a failure — the same shape as being off the expected page — so it
   * parks recoverably on `page_mismatch`; re-opening and a `REQUEST_STEP_RECHECK` recovers. Idempotent on a
   * terminal or already-parked run. Returns `CLEAR_HIGHLIGHT` so a parked run points at nothing.
   */
  onSurfaceClosed(): CoupangIssuanceEffect {
    if (isCoupangIssuanceTerminal(this.stage)) return "NONE";
    if (this.stage === "page_mismatch" && this.blockerCode === "UI_DRIFT") return "NONE";
    this.park("page_mismatch", "UI_DRIFT");
    return "CLEAR_HIGHLIGHT";
  }

  /**
   * **The observed wait's window elapsed.** Nothing is watching WING any more, so the run must stop CLAIMING to
   * be: an observed wait reports RUNNING with no blocker precisely because the runtime is looking on the
   * seller's behalf, and once it has stopped, that reading is false.
   *
   * It converts to a recoverable `page_mismatch` park carrying `SURFACE_SETTLE_TIMEOUT` — "화면이 아직 준비되지
   * 않았어요", which is what actually happened (ten minutes of readings, none of them a surface the tutorial
   * recognized) rather than `UI_DRIFT`'s "화면이 바뀐 것 같아요", the misleading message this stage was created
   * to stop showing a seller who simply had not logged in yet.
   *
   * **The seller's own 다시 확인 is the recovery, and deliberately the ONLY one.** Every other park restarts
   * itself on a timer; this one does not, because it is reached *by* a watch running out. Restarting it would
   * re-enter the same ten-minute watch, and a run nobody is sitting at would poll a page nobody is looking at
   * for as long as the agent lives — the exact thing the watch is bounded to prevent. The button was missing
   * here; that was the defect. It is present now, at this stage and throughout the wait before it.
   *
   * **`waiting_login` expires to nothing on purpose**, and this is the one place on the walk where the seller is
   * left to come back to the SellerOps tab. It is worth being explicit about, because it is a real limit rather
   * than an oversight:
   *  - it is ALREADY a park carrying `LOGIN_REQUIRED` with `REQUEST_STEP_RECHECK` offered, so the frontend has
   *    been showing a blocker card and a button the whole time — nothing about the expiry is silent;
   *  - converting it would mean re-announcing a blocker the seller is already looking at;
   *  - and there is no WING-resident surface to offer anything on: at a login screen the walk has mounted no
   *    overlay, so "keep watching" is the only thing it could do, which is what just ran out.
   * A seller who has been at a WING login for ten minutes is not mid-flow. Restarting the watch for them would
   * poll a login page for as long as the agent lives.
   *
   * Idempotent, and a no-op on any other stage: a poll that finishes after the run has already moved on must
   * not park a healthy run.
   */
  onSurfaceWaitExpired(): CoupangIssuanceEffect {
    if (isCoupangIssuanceTerminal(this.stage)) return "NONE";
    if (!isCoupangIssuanceObservedWait(this.stage)) return "NONE";
    return this.park("page_mismatch", "SURFACE_SETTLE_TIMEOUT");
  }

  /**
   * A drive effect threw — most often a navigation RACE: the seller's own page moved under an in-page
   * locate/highlight read. Not a failure; it PARKS recoverably on `page_mismatch` rather than leaving the run
   * idle with no barrier. Recovery is decided in {@link recheck}. Returns `CLEAR_HIGHLIGHT` so any half-applied
   * annotation is dropped.
   */
  onDriveFault(): CoupangIssuanceEffect {
    if (isCoupangIssuanceTerminal(this.stage)) return "NONE";
    if (this.currentTarget) this.activeStepIndex = TARGET_STEP[this.currentTarget];
    this.park("page_mismatch", "UI_DRIFT");
    return "CLEAR_HIGHLIGHT";
  }

  /* ── operator-driven transitions ──────────────────────────────────────────── */

  private pause(): CoupangIssuanceEffect {
    this.paused = true;
    this.emit("RUN_STATUS_CHANGED", { status: "PAUSED" });
    return "NONE";
  }

  private resume(): CoupangIssuanceEffect {
    this.paused = false;
    this.emit("RUN_STATUS_CHANGED", { status: "WAITING_FOR_HUMAN" });
    if (!this.currentTarget) return "NONE";
    // Resume RE-GUIDES a viewport checkpoint (re-settle → re-locate → re-scroll → re-overlay); it re-arms the
    // navigation observation for reach_open_api.
    return isCoupangCheckpointTarget(this.currentTarget) ? { guide: this.currentTarget } : { observe: this.currentTarget };
  }

  /** Cancel, or leave for the manual path — both are the same benign, non-completing terminal. */
  private abort(): CoupangIssuanceEffect {
    this.paused = false;
    this.stage = "operator_aborted";
    this.blockerCode = null;
    this.blockerRecoverable = false;
    this.emit("RUN_STATUS_CHANGED", { status: "CANCELLED" });
    return "CLEANUP";
  }

  /**
   * Park recoverably at a seller-clearable stop. Emits `RUN_BLOCKED { recoverable: true }` and stops, never a
   * `RUN_FAILED`: the run is not over. A `REQUEST_STEP_RECHECK` re-probes / re-guides.
   */
  /**
   * Enter (or stay in) an OBSERVED WAIT: the runtime has not seen a surface it can act on and is watching for
   * one. Idempotent, so a poll that keeps reading the same unrecognized page does not emit an event per tick.
   *
   * Unlike {@link park} this is not a blocker the seller has to clear from the SellerOps tab — it clears itself
   * the moment WING shows something we recognize.
   */
  private waitingFor(stage: "waiting_login" | "awaiting_wing_surface", code: "LOGIN_REQUIRED" | null): void {
    if (this.stage === stage && this.blockerCode === code) return;
    this.paused = false;
    this.blockerCode = code;
    this.blockerRecoverable = code !== null;
    this.stage = stage;
    if (code) this.emit("RUN_BLOCKED", { code, recoverable: true });
    this.emit("RUN_STATUS_CHANGED", { status: code ? "WAITING_FOR_HUMAN" : "RUNNING" });
  }

  /** Watch for a recognizable WING surface. Carries NO blocker — "not there yet" is not a fault. */
  private awaitSurface(): CoupangIssuanceEffect {
    this.waitingFor("awaiting_wing_surface", null);
    return "AWAIT_SURFACE";
  }

  private park(
    stage: "waiting_login" | "target_not_found" | "page_mismatch",
    code: "LOGIN_REQUIRED" | "TARGET_NOT_FOUND" | "UI_DRIFT" | "SURFACE_SETTLE_TIMEOUT",
  ): CoupangIssuanceEffect {
    if (this.stage === stage && this.blockerCode === code) return "NONE";
    this.paused = false;
    this.blockerCode = code;
    this.blockerRecoverable = true;
    this.stage = stage;
    this.emit("RUN_BLOCKED", { code, recoverable: true });
    this.emit("RUN_STATUS_CHANGED", { status: "WAITING_FOR_HUMAN" });
    return "NONE";
  }

  /* ── outbound state ──────────────────────────────────────────────────────── */

  private emit(type: EventType, payload: EventPayload): void {
    this.seq += 1;
    this.revision += 1;
    this.log.push({
      protocolVersion: 2,
      eventId: `${this.runId}-e${this.seq}`,
      runId: this.runId,
      sequence: this.seq,
      revision: this.revision,
      type,
      occurredAt: this.clock(),
      payload,
    });
  }

  private stepIdFor(stepNumber: number): string {
    return coupangIssuanceStepMetaAt(coupangIssuanceStepPlan(), stepNumber).stepId;
  }
  private stepId(): string {
    return this.stepIdFor(this.activeStepIndex);
  }

  view(): ActionWindowRunView {
    const plan = coupangIssuanceStepPlan();
    const meta = coupangIssuanceStepMetaAt(plan, this.activeStepIndex);
    const status: RunStatus = this.paused ? "PAUSED" : coupangIssuanceStageToRunStatus(this.stage);
    const view: ActionWindowRunView = {
      protocolVersion: 2,
      runId: this.runId,
      revision: this.revision,
      channelCode: this.channelCode,
      runCopyKey: COUPANG_ISSUANCE_RUN_COPY_KEY,
      status,
      // Always ACTION_WINDOW: this is a guided walk. Also what keeps the WAITING_FOR_HUMAN contract invariant
      // satisfied for every barrier/park stage (validateRunView requires it).
      executionMode: "ACTION_WINDOW",
      intent: "API_ISSUANCE_GUIDANCE",
      // Deliberately NO appBranch — the Coupang walk is linear.
      currentStep: {
        stepId: meta.stepId,
        stepNumber: meta.stepNumber,
        totalSteps: COUPANG_ISSUANCE_TOTAL_STEPS,
        copyKey: meta.copyKey,
        ...(meta.copyParams ? { copyParams: meta.copyParams } : {}),
        status: coupangIssuanceStageToStepStatus(this.stage),
      },
      guidanceEnabled: this.guidanceEnabled,
      allowedCommands: this.paused ? [...COUPANG_ISSUANCE_PAUSED_COMMANDS] : [...coupangIssuanceAllowedCommands(this.stage)],
      progress: { completedSteps: this.completedSteps, totalSteps: COUPANG_ISSUANCE_TOTAL_STEPS },
      updatedAt: this.clock(),
    };
    // A blocker is exposed only while the run is parked for it — the recoverable parks, never a terminal.
    if (this.blockerCode && isCoupangIssuancePark(this.stage)) {
      view.blocker = { code: this.blockerCode, recoverable: this.blockerRecoverable };
    }
    return view;
  }

  events(): readonly EventEnvelope[] {
    return this.log;
  }
  currentStage(): CoupangIssuanceStage {
    return this.stage;
  }
  isStarted(): boolean {
    return this.started;
  }
  isPaused(): boolean {
    return this.paused;
  }
  /** Whether the run is resting on the seller right now (a barrier or a recoverable park). */
  isAtBarrier(): boolean {
    return isCoupangIssuanceBarrier(this.stage) || isCoupangIssuancePark(this.stage);
  }
  activeTarget(): CoupangIssuanceTarget | null {
    return this.currentTarget;
  }
}
