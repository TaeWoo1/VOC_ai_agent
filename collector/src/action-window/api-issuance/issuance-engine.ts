/**
 * **Action Window Runtime — NAVER API-issuance guidance engine (ISOLATED, v2).**
 *
 * A pure reducer for ONE guided API-center onboarding walk: the seller logs in, opens or creates their
 * Commerce API application, adds the API group, and copies the Application ID / Secret into SellerOps's own
 * masked form — every real step theirs. The runtime observes a sanitized page category, highlights the one
 * control to press next, watches the seller's own click, and advances.
 *
 * **The guarantees this engine exists to make structural:**
 *
 *  1. **It never acts on the API center.** There is no effect that logs in, clicks, submits, creates an
 *     application, selects an API group, or reads a credential VALUE. The effects are PROBE / READ_APPS /
 *     locate / highlight / observe / CLEAR_HIGHLIGHT / CLEANUP — all observation or annotation.
 *  2. **`COMPLETED` means the GUIDANCE finished, nothing more.** No credential is stored, no connection made;
 *     that is a separate masked form. So `guidance_complete` is honest completion of a tutorial, not a claim.
 *  3. **Every stop the seller can clear is recoverable.** A login gate, a missing control, or an unexpected
 *     page PARK (not FAIL). A `REQUEST_STEP_RECHECK` re-probes the surface from the top.
 *
 * Pure: no I/O, no browser, no wall-clock.
 */
import type { ActionWindowRunView, EventEnvelope, EventPayload, EventType, RunStatus } from "../../../../contracts/action-window/v2/index";
import { branchAfterProbe, classifyAppListPopulation } from "./api-center-adapter";
import { TARGET_BARRIER_STAGE, type ApplicationsRead, type IssuanceSurfaceProbe, type IssuanceTarget } from "./issuance-driver";
import type { LocateResult } from "../engine";
import {
  ISSUANCE_PAUSED_COMMANDS,
  ISSUANCE_RUN_COPY_KEY,
  ISSUANCE_TOTAL_STEPS,
  issuanceAllowedCommands,
  issuanceStageToRunStatus,
  issuanceStageToStepStatus,
  issuanceStepMetaAt,
  issuanceStepPlan,
  isIssuanceBarrier,
  isIssuancePark,
  isIssuanceTerminal,
  type IssuanceStage,
} from "./issuance-stages";

/** What the session should do next. Every one is observation or annotation — never a marketplace action. */
export type IssuanceEffect =
  | "PROBE"
  | "READ_APPS"
  /** Locate → highlight → arm the barrier for one control, as a single batched step in the session. */
  | { guide: IssuanceTarget }
  | { observe: IssuanceTarget }
  | "CLEAR_HIGHLIGHT"
  | "CLEANUP"
  | "NONE";

export type IssuanceCommandOutcome = { ok: true; idempotent: boolean; effect: IssuanceEffect } | { ok: false; reason: string };

export interface IssuanceRunConfig {
  runId: string;
  /** Sanitized channel identity (SEMANTIC_CODE, e.g. `naver`). */
  channelCode: string;
}

export type IssuanceClock = () => string;

/** Synthetic monotonic occurrence marker (NOT wall-clock). `occurredAt` is opaque, display-only. */
export function makeIssuanceClock(start = 1): IssuanceClock {
  let n = start;
  return () => `2026-01-01T00:00:00.${String(n++).padStart(6, "0")}Z`;
}

/**
 * An opaque 16-hex target signature — the ONLY shape allowed to become a `targetRef` on the wire. The engine
 * validates every `LocateResult.sig` against this before using it, so a driver that ever returned a raw value
 * (a selector, an id, or — the case that matters — a credential) as its "signature" fails closed at the
 * barrier rather than emitting that value in a `TARGET_HIGHLIGHTED` event. The contract's `findProhibitedFields`
 * would also reject it downstream, but this refuses it at the source.
 */
const HEX16 = /^[0-9a-f]{16}$/;

/** The seller barrier each target rests on (shared with the session via issuance-driver). */
const TARGET_BARRIER = TARGET_BARRIER_STAGE;
const TARGET_STEP: Readonly<Record<IssuanceTarget, number>> = {
  create_app: 2,
  open_app: 2,
  api_group: 3,
  credentials: 4,
  return: 5,
};

export class IssuanceEngine {
  private readonly runId: string;
  private readonly channelCode: string;
  private readonly clock: IssuanceClock;

  private started = false;
  private stage: IssuanceStage = "opening";
  private revision = 0;
  private seq = 0;
  private activeStepIndex = 1;
  private completedSteps = 0;
  private guidanceEnabled = true;
  private hasExistingApp = false;
  /** The control the current barrier rests on, so a recheck/resume re-arms the right observation. */
  private currentTarget: IssuanceTarget | null = null;
  private targetSig: Partial<Record<IssuanceTarget, string>> = {};
  private blockerCode: "LOGIN_REQUIRED" | "TARGET_NOT_FOUND" | "UI_DRIFT" | null = null;
  private blockerRecoverable = false;
  /** A pause is an overlay on a barrier, not a 15th stage — the product's stage list is exactly 14. */
  private paused = false;
  private readonly log: EventEnvelope[] = [];

  constructor(config: IssuanceRunConfig, opts?: { clock?: IssuanceClock }) {
    this.runId = config.runId;
    this.channelCode = config.channelCode;
    this.clock = opts?.clock ?? makeIssuanceClock();
  }

  /* ── inbound command ─────────────────────────────────────────────────────── */

  command(command: { type: string; expectedRevision: number }): IssuanceCommandOutcome {
    if (!this.started) {
      if (command.type !== "START_RUN") return { ok: false, reason: "INVALID_FOR_STATE" };
      return { ok: true, idempotent: false, effect: this.start() };
    }
    if (command.type === "START_RUN") return { ok: true, idempotent: true, effect: "NONE" };
    if (command.expectedRevision < this.revision) return { ok: false, reason: "STALE_REVISION" };
    const allowed = this.paused ? ISSUANCE_PAUSED_COMMANDS : issuanceAllowedCommands(this.stage);
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
   * "I did it, look again."
   *
   * <p>At a park (login / target-not-found / page-mismatch) this is the repair: it re-probes the surface from
   * the top (mirroring import's `SESSION_BLOCKED → PREPARE`). At a seller barrier it re-arms observation of
   * the current control rather than completing the step — the runtime alone decides a step is done.
   */
  private recheck(): IssuanceEffect {
    if (isIssuancePark(this.stage)) {
      this.blockerCode = null;
      this.blockerRecoverable = false;
      this.stage = "opening";
      this.activeStepIndex = 1;
      this.currentTarget = null;
      this.emit("RUN_STATUS_CHANGED", { status: "PREPARING" });
      return "PROBE";
    }
    if (isIssuanceBarrier(this.stage) && this.currentTarget) return { observe: this.currentTarget };
    return "NONE";
  }

  /* ── automatic-drive callbacks ────────────────────────────────────────────── */

  private start(): IssuanceEffect {
    this.started = true;
    this.stage = "opening";
    this.activeStepIndex = 1;
    this.emit("RUN_STARTED", { status: "PREPARING" });
    this.emit("RUN_STATUS_CHANGED", { status: "PREPARING" });
    return "PROBE";
  }

  /** The sanitized page category the seller is on. Login parks; app_list proceeds; anything else parks. */
  onSurfaceProbed(probe: IssuanceSurfaceProbe): IssuanceEffect {
    if (isIssuanceTerminal(this.stage)) return "NONE";
    if (!probe.ok || probe.blockerCode === "LOGIN_REQUIRED" || probe.pageCategory === "login") {
      return this.park("waiting_login", "LOGIN_REQUIRED");
    }
    const { branch } = branchAfterProbe(probe.pageCategory);
    if (branch === "app_list") {
      this.stage = "locating_applications";
      this.activeStepIndex = 1;
      this.emit("RUN_STATUS_CHANGED", { status: "RUNNING" });
      return "READ_APPS";
    }
    // `login` is already handled above; anything else is an unexpected page → recoverable page_mismatch park.
    return this.park("page_mismatch", "UI_DRIFT");
  }

  /** The applications list, read structurally. Branches existing-vs-empty via the CANDIDATE population rule. */
  onApplicationsRead(read: ApplicationsRead): IssuanceEffect {
    if (isIssuanceTerminal(this.stage)) return "NONE";
    // Step 1 (reach the applications list) is done once we can read it.
    this.completedSteps = 1;
    this.emit("STEP_COMPLETED", { stepId: this.stepIdFor(1), stepStatus: "COMPLETED" });
    const { population } = classifyAppListPopulation(read.applicationEntryRowCount);
    this.hasExistingApp = population === "existing";
    this.activeStepIndex = 2;
    if (this.hasExistingApp) {
      this.stage = "existing_app";
      this.currentTarget = "open_app";
      this.emit("STEP_READY", { stepId: this.stepId(), stepStatus: "READY" });
      return { guide: "open_app" };
    }
    this.stage = "empty_state";
    this.currentTarget = "create_app";
    this.emit("STEP_READY", { stepId: this.stepId(), stepStatus: "READY" });
    return { guide: "create_app" };
  }

  /** Locate result for the control being guided. Not found / not unique → recoverable target_not_found. */
  onTargetLocated(target: IssuanceTarget, res: LocateResult): IssuanceEffect {
    if (isIssuanceTerminal(this.stage)) return "NONE";
    // Not unique, OR a signature that is not an opaque 16-hex token → park. The hex check is fail-closed
    // against a driver that returned a raw value as its "sig": such a value must never reach `targetRef`.
    if (res.count !== 1 || !res.sig || !HEX16.test(res.sig)) return this.park("target_not_found", "TARGET_NOT_FOUND");
    this.targetSig[target] = res.sig;
    return { guide: target }; // session proceeds to highlight; kept as a `guide` continuation marker
  }

  /**
   * The driver re-validated while annotating. A changed unique match between locate and highlight means the
   * page moved under us, so park on `page_mismatch` rather than highlight the wrong control (anti-drift).
   */
  onTargetHighlighted(target: IssuanceTarget, res: LocateResult): IssuanceEffect {
    if (isIssuanceTerminal(this.stage)) return "NONE";
    if (res.count !== 1 || !res.sig || !HEX16.test(res.sig) || res.sig !== this.targetSig[target]) {
      const effect = this.park("page_mismatch", "UI_DRIFT");
      // Something may already be annotated from the locate; drop it so a parked run points at nothing.
      return effect === "NONE" ? "CLEAR_HIGHLIGHT" : effect;
    }
    this.stage = TARGET_BARRIER[target];
    this.activeStepIndex = TARGET_STEP[target];
    this.currentTarget = target;
    this.emit("STEP_READY", { stepId: this.stepId(), stepStatus: "READY" });
    this.emit("HUMAN_ACTION_REQUIRED", { stepId: this.stepId() });
    this.emit("TARGET_HIGHLIGHTED", { stepId: this.stepId(), targetRef: res.sig });
    this.emit("RUN_STATUS_CHANGED", { status: "WAITING_FOR_HUMAN" });
    return { observe: target };
  }

  /**
   * The seller acted on the control. An OBSERVATION — it advances only a still-open barrier for that same
   * target, so a late or duplicated observation cannot skip a step.
   */
  onUserActionObserved(target: IssuanceTarget): IssuanceEffect {
    if (this.currentTarget !== target || this.stage !== TARGET_BARRIER[target]) return "NONE";
    this.emit("USER_ACTION_OBSERVED", { stepId: this.stepId(), observed: true });
    this.completedSteps = this.activeStepIndex;
    this.emit("STEP_COMPLETED", { stepId: this.stepId(), stepStatus: "COMPLETED" });
    return this.advanceAfterBarrier(target);
  }

  /** Where the run goes once a barrier's control has been acted on. */
  private advanceAfterBarrier(target: IssuanceTarget): IssuanceEffect {
    switch (target) {
      case "create_app":
      case "open_app":
        this.currentTarget = "api_group";
        return { guide: "api_group" };
      case "api_group":
        this.currentTarget = "credentials";
        return { guide: "credentials" };
      case "credentials":
        this.currentTarget = "return";
        return { guide: "return" };
      case "return":
        return this.complete();
    }
  }

  private complete(): IssuanceEffect {
    this.stage = "guidance_complete";
    this.activeStepIndex = ISSUANCE_TOTAL_STEPS;
    this.completedSteps = ISSUANCE_TOTAL_STEPS;
    this.currentTarget = null;
    // "completed" is the guidance finishing — NOT a stored credential or a made connection.
    this.emit("RUN_COMPLETED", { status: "COMPLETED" });
    return "CLEANUP";
  }

  /**
   * The seller closed the API-center window. Not a failure — the same shape as being off the expected page —
   * so it parks recoverably on `page_mismatch`; re-opening and a `REQUEST_STEP_RECHECK` re-probe recovers.
   * Idempotent on a terminal or already-parked run. Returns `CLEAR_HIGHLIGHT` so a parked run points at nothing.
   */
  onSurfaceClosed(): IssuanceEffect {
    if (isIssuanceTerminal(this.stage)) return "NONE";
    if (this.stage === "page_mismatch" && this.blockerCode === "UI_DRIFT") return "NONE";
    this.park("page_mismatch", "UI_DRIFT");
    return "CLEAR_HIGHLIGHT";
  }

  /* ── operator-driven transitions ──────────────────────────────────────────── */

  private pause(): IssuanceEffect {
    this.paused = true;
    this.emit("RUN_STATUS_CHANGED", { status: "PAUSED" });
    return "NONE";
  }

  private resume(): IssuanceEffect {
    this.paused = false;
    this.emit("RUN_STATUS_CHANGED", { status: "WAITING_FOR_HUMAN" });
    return this.currentTarget ? { observe: this.currentTarget } : "NONE";
  }

  /** Cancel, or leave for the manual path — both are the same benign, non-completing terminal. */
  private abort(): IssuanceEffect {
    this.paused = false;
    this.stage = "operator_aborted";
    this.blockerCode = null;
    this.blockerRecoverable = false;
    this.emit("RUN_STATUS_CHANGED", { status: "CANCELLED" });
    return "CLEANUP";
  }

  /**
   * Park recoverably at a seller-clearable stop. Emits `RUN_BLOCKED { recoverable: true }` and stops, never a
   * `RUN_FAILED`: the run is not over. A `REQUEST_STEP_RECHECK` re-probes the surface from the top.
   */
  private park(stage: "waiting_login" | "target_not_found" | "page_mismatch", code: "LOGIN_REQUIRED" | "TARGET_NOT_FOUND" | "UI_DRIFT"): IssuanceEffect {
    // Idempotent while already parked on this exact cause.
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
    return issuanceStepMetaAt(issuanceStepPlan(this.hasExistingApp), stepNumber).stepId;
  }
  private stepId(): string {
    return this.stepIdFor(this.activeStepIndex);
  }

  view(): ActionWindowRunView {
    const plan = issuanceStepPlan(this.hasExistingApp);
    const meta = issuanceStepMetaAt(plan, this.activeStepIndex);
    const status: RunStatus = this.paused ? "PAUSED" : issuanceStageToRunStatus(this.stage);
    const view: ActionWindowRunView = {
      protocolVersion: 2,
      runId: this.runId,
      revision: this.revision,
      channelCode: this.channelCode,
      runCopyKey: ISSUANCE_RUN_COPY_KEY,
      status,
      // Always ACTION_WINDOW: this is a guided walk. This is also what keeps the WAITING_FOR_HUMAN contract
      // invariant satisfied for every barrier/park stage (validateRunView requires it).
      executionMode: "ACTION_WINDOW",
      intent: "API_ISSUANCE_GUIDANCE",
      currentStep: {
        stepId: meta.stepId,
        stepNumber: meta.stepNumber,
        totalSteps: ISSUANCE_TOTAL_STEPS,
        copyKey: meta.copyKey,
        ...(meta.copyParams ? { copyParams: meta.copyParams } : {}),
        status: issuanceStageToStepStatus(this.stage),
      },
      guidanceEnabled: this.guidanceEnabled,
      allowedCommands: this.paused ? [...ISSUANCE_PAUSED_COMMANDS] : [...issuanceAllowedCommands(this.stage)],
      progress: { completedSteps: this.completedSteps, totalSteps: ISSUANCE_TOTAL_STEPS },
      updatedAt: this.clock(),
    };
    // A blocker is exposed only while the run is parked for it — the recoverable parks, never a terminal.
    if (this.blockerCode && isIssuancePark(this.stage)) {
      view.blocker = { code: this.blockerCode, recoverable: this.blockerRecoverable };
    }
    return view;
  }

  events(): readonly EventEnvelope[] {
    return this.log;
  }
  currentStage(): IssuanceStage {
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
    return isIssuanceBarrier(this.stage) || isIssuancePark(this.stage);
  }
  activeTarget(): IssuanceTarget | null {
    return this.currentTarget;
  }
}
