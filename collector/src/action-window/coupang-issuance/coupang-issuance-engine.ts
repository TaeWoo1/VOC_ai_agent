/**
 * **Action Window Runtime — Coupang WING API-issuance guidance engine (ISOLATED, v2).**
 *
 * A pure reducer for ONE guided Coupang WING open-API issuance walk: the seller logs in, reaches the open-API
 * issuance page, selects 자체개발, confirms 업체명, sets the 호출 IP, presses 발급 to issue the key themselves, and
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

const TARGET_BARRIER = COUPANG_TARGET_BARRIER_STAGE;
const TARGET_STEP: Readonly<Record<CoupangIssuanceTarget, number>> = {
  reach_open_api: 1,
  self_dev: 2,
  vendor_info: 3,
  call_ip: 4,
  issue: 5,
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
  private blockerCode: "LOGIN_REQUIRED" | "TARGET_NOT_FOUND" | "UI_DRIFT" | null = null;
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
   */
  private recheck(): CoupangIssuanceEffect {
    if (isCoupangIssuancePark(this.stage)) {
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
    if (!probe.ok || probe.blockerCode === "LOGIN_REQUIRED" || probe.pageCategory === "login") {
      return this.park("waiting_login", "LOGIN_REQUIRED");
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
      this.currentTarget = "self_dev";
      return { guide: "self_dev" };
    }
    if (branch === "wing_home") {
      // The seller is on the WING home — guide the reach_open_api transition-observe (step 1).
      this.stage = "locating_open_api";
      this.activeStepIndex = 1;
      this.emit("RUN_STATUS_CHANGED", { status: "RUNNING" });
      this.currentTarget = "reach_open_api";
      return { guide: "reach_open_api" };
    }
    // login is handled above; anything else is an unexpected page → recoverable page_mismatch park.
    return this.park("page_mismatch", "UI_DRIFT");
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
      return this.park("waiting_login", "LOGIN_REQUIRED");
    }
    if (probe.pageCategory === "open_api_issuance") {
      this.emit("USER_ACTION_OBSERVED", { stepId: this.stepId(), observed: true });
      this.completedSteps = this.activeStepIndex; // step 1 (reach the open-API issuance page)
      this.emit("STEP_COMPLETED", { stepId: this.stepId(), stepStatus: "COMPLETED" });
      this.currentTarget = "self_dev";
      return { guide: "self_dev" };
    }
    // Wrong page / multiple transitions → recoverable park; a REQUEST_STEP_RECHECK re-probes from the top.
    return this.park("page_mismatch", "UI_DRIFT");
  }

  /** Where the run goes once a barrier's control has been acted on. */
  private advanceAfterBarrier(target: CoupangIssuanceTarget): CoupangIssuanceEffect {
    switch (target) {
      // `reach_open_api` never reaches here — its barrier advances via `onReachVerified` (issuance-page
      // verification), not this checkpoint path. Kept only so the switch stays exhaustive.
      case "reach_open_api":
        this.currentTarget = "self_dev";
        return { guide: "self_dev" };
      case "self_dev":
        this.currentTarget = "vendor_info";
        return { guide: "vendor_info" };
      case "vendor_info":
        this.currentTarget = "call_ip";
        return { guide: "call_ip" };
      case "call_ip":
        this.currentTarget = "issue";
        return { guide: "issue" };
      case "issue":
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
  private park(
    stage: "waiting_login" | "target_not_found" | "page_mismatch",
    code: "LOGIN_REQUIRED" | "TARGET_NOT_FOUND" | "UI_DRIFT",
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
