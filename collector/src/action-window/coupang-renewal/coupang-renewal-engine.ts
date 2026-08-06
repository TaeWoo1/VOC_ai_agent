/**
 * **Action Window Runtime — Coupang WING credential-RENEWAL guidance engine (ISOLATED, v2).**
 *
 * A pure reducer for ONE guided Coupang WING open-API **renewal** walk: the seller logs in, reaches the open-API
 * page, checks the `유효기간` (validity period) SellerOps highlights, presses `재발급` (re-issue) THEMSELVES at an
 * explicit human checkpoint, and copies the NEW Access Key / Secret Key / 업체코드 into SellerOps's own masked
 * form — every real step theirs. The runtime observes a sanitized page category, highlights the one section to
 * look at next, and advances on the operator's own `다음`. It is a fixed 5-step LINE (no branch).
 *
 * The reducer is a faithful sibling of the issuance engine — same guarantees:
 *   1. It never acts on WING (effects are PROBE / VERIFY_REACH / locate / highlight / observe / CLEAR_HIGHLIGHT /
 *      CLEANUP — all observation or annotation). It never re-issues a key and never reads a credential VALUE.
 *   2. `재발급` (re-issue) is an explicit human checkpoint: highlight + rest; the seller presses it and `다음`s.
 *   3. `COMPLETED` means the GUIDANCE finished — no credential is stored or replaced by this runtime.
 *   4. Every seller-clearable stop PARKS recoverably; a `REQUEST_STEP_RECHECK` re-probes / re-guides.
 *
 * Pure: no I/O, no browser, no wall-clock.
 */
import type { ActionWindowRunView, EventEnvelope, EventPayload, EventType, RunStatus } from "../../../../contracts/action-window/v2/index";
import { branchAfterWingProbe } from "../../cli/coupang-wing-classifier";
import {
  COUPANG_RENEWAL_TARGET_BARRIER_STAGE,
  isCoupangRenewalCheckpointTarget,
  type CoupangRenewalTarget,
  type WingSurfaceProbe,
} from "./coupang-renewal-driver";
import type { LocateResult } from "../engine";
import {
  COUPANG_RENEWAL_PAUSED_COMMANDS,
  COUPANG_RENEWAL_RUN_COPY_KEY,
  COUPANG_RENEWAL_TOTAL_STEPS,
  coupangRenewalAllowedCommands,
  coupangRenewalStageToRunStatus,
  coupangRenewalStageToStepStatus,
  coupangRenewalStepMetaAt,
  coupangRenewalStepPlan,
  isCoupangRenewalBarrier,
  isCoupangRenewalPark,
  isCoupangRenewalTerminal,
  type CoupangRenewalStage,
} from "./coupang-renewal-stages";

/** What the session should do next. Every one is observation or annotation — never a marketplace action. */
export type CoupangRenewalEffect =
  | "PROBE"
  | "VERIFY_REACH"
  | { guide: CoupangRenewalTarget }
  | { observe: CoupangRenewalTarget }
  | "CLEAR_HIGHLIGHT"
  | "CLEANUP"
  | "NONE";

export type CoupangRenewalCommandOutcome =
  | { ok: true; idempotent: boolean; effect: CoupangRenewalEffect }
  | { ok: false; reason: string };

export interface CoupangRenewalRunConfig {
  runId: string;
  /** Sanitized channel identity (SEMANTIC_CODE) — always `coupang`. */
  channelCode: string;
}

export type CoupangRenewalClock = () => string;

/** Synthetic monotonic occurrence marker (NOT wall-clock). `occurredAt` is opaque, display-only. */
export function makeCoupangRenewalClock(start = 1): CoupangRenewalClock {
  let n = start;
  return () => `2026-01-01T00:00:00.${String(n++).padStart(6, "0")}Z`;
}

/** The ONLY shape allowed to become a `targetRef` on the wire — an opaque 16-hex signature. */
const HEX16 = /^[0-9a-f]{16}$/;

const TARGET_BARRIER = COUPANG_RENEWAL_TARGET_BARRIER_STAGE;
const TARGET_STEP: Readonly<Record<CoupangRenewalTarget, number>> = {
  reach_open_api: 1,
  check_expiry: 2,
  reissue: 3,
  credentials: 4,
  return: 5,
};

export class CoupangRenewalEngine {
  private readonly runId: string;
  private readonly channelCode: string;
  private readonly clock: CoupangRenewalClock;

  private started = false;
  private stage: CoupangRenewalStage = "opening";
  private revision = 0;
  private seq = 0;
  private activeStepIndex = 1;
  private completedSteps = 0;
  private guidanceEnabled = true;
  private currentTarget: CoupangRenewalTarget | null = null;
  private targetSig: Partial<Record<CoupangRenewalTarget, string>> = {};
  private blockerCode: "LOGIN_REQUIRED" | "TARGET_NOT_FOUND" | "UI_DRIFT" | null = null;
  private blockerRecoverable = false;
  private paused = false;
  private readonly log: EventEnvelope[] = [];

  constructor(config: CoupangRenewalRunConfig, opts?: { clock?: CoupangRenewalClock }) {
    this.runId = config.runId;
    this.channelCode = config.channelCode;
    this.clock = opts?.clock ?? makeCoupangRenewalClock();
  }

  /* ── inbound command ─────────────────────────────────────────────────────── */

  command(command: { type: string; expectedRevision: number }): CoupangRenewalCommandOutcome {
    if (!this.started) {
      if (command.type !== "START_RUN") return { ok: false, reason: "INVALID_FOR_STATE" };
      return { ok: true, idempotent: false, effect: this.start() };
    }
    if (command.type === "START_RUN") return { ok: true, idempotent: true, effect: "NONE" };
    if (command.expectedRevision < this.revision) return { ok: false, reason: "STALE_REVISION" };
    const allowed = this.paused ? COUPANG_RENEWAL_PAUSED_COMMANDS : coupangRenewalAllowedCommands(this.stage);
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

  /** "I did it, look again." — the repair at a park, and `다음` at a checkpoint (same recovery model as issuance). */
  private recheck(): CoupangRenewalEffect {
    if (isCoupangRenewalPark(this.stage)) {
      if (this.currentTarget && isCoupangRenewalCheckpointTarget(this.currentTarget)) {
        const target = this.currentTarget;
        this.blockerCode = null;
        this.blockerRecoverable = false;
        this.activeStepIndex = TARGET_STEP[target];
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
    if (isCoupangRenewalBarrier(this.stage) && this.currentTarget) {
      if (isCoupangRenewalCheckpointTarget(this.currentTarget)) return this.advanceCheckpoint(this.currentTarget);
      return { observe: this.currentTarget };
    }
    return "NONE";
  }

  /** `다음` at a viewport checkpoint: complete the step (no WING click was observed) and guide the next control. */
  private advanceCheckpoint(target: CoupangRenewalTarget): CoupangRenewalEffect {
    if (this.currentTarget !== target || this.stage !== TARGET_BARRIER[target]) return "NONE";
    this.completedSteps = this.activeStepIndex;
    this.emit("STEP_COMPLETED", { stepId: this.stepId(), stepStatus: "COMPLETED" });
    return this.advanceAfterBarrier(target);
  }

  /* ── automatic-drive callbacks ────────────────────────────────────────────── */

  private start(): CoupangRenewalEffect {
    this.started = true;
    this.stage = "opening";
    this.activeStepIndex = 1;
    this.emit("RUN_STARTED", { status: "PREPARING" });
    this.emit("RUN_STATUS_CHANGED", { status: "PREPARING" });
    return "PROBE";
  }

  /**
   * The sanitized page category the seller is on. login parks; wing_home guides the reach_open_api
   * transition-observe (step 1); open_api_issuance completes step 1 automatically and guides `유효기간`; anything
   * else parks recoverably.
   */
  onSurfaceProbed(probe: WingSurfaceProbe): CoupangRenewalEffect {
    if (isCoupangRenewalTerminal(this.stage)) return "NONE";
    if (!probe.ok || probe.blockerCode === "LOGIN_REQUIRED" || probe.pageCategory === "login") {
      return this.park("waiting_login", "LOGIN_REQUIRED");
    }
    const { branch } = branchAfterWingProbe(probe.pageCategory);
    if (branch === "open_api") {
      this.stage = "locating_open_api";
      this.activeStepIndex = 1;
      this.emit("RUN_STATUS_CHANGED", { status: "RUNNING" });
      this.completedSteps = 1;
      this.emit("STEP_COMPLETED", { stepId: this.stepIdFor(1), stepStatus: "COMPLETED" });
      this.activeStepIndex = 2;
      this.currentTarget = "check_expiry";
      return { guide: "check_expiry" };
    }
    if (branch === "wing_home") {
      this.stage = "locating_open_api";
      this.activeStepIndex = 1;
      this.emit("RUN_STATUS_CHANGED", { status: "RUNNING" });
      this.currentTarget = "reach_open_api";
      return { guide: "reach_open_api" };
    }
    return this.park("page_mismatch", "UI_DRIFT");
  }

  /** Locate result for the control being guided. Not found / not unique → recoverable target_not_found. */
  onTargetLocated(target: CoupangRenewalTarget, res: LocateResult): CoupangRenewalEffect {
    if (isCoupangRenewalTerminal(this.stage)) return "NONE";
    if (res.count !== 1 || !res.sig || !HEX16.test(res.sig)) return this.park("target_not_found", "TARGET_NOT_FOUND");
    this.targetSig[target] = res.sig;
    return { guide: target };
  }

  /** The driver re-validated while annotating. A changed unique match → park on page_mismatch (anti-drift). */
  onTargetHighlighted(target: CoupangRenewalTarget, res: LocateResult): CoupangRenewalEffect {
    if (isCoupangRenewalTerminal(this.stage)) return "NONE";
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
    // A same-page VIEWPORT CHECKPOINT (유효기간 / 재발급 / keys / return) does NOT arm a WING observation — the
    // section is highlighted + scrolled into view and the run RESTS until `다음`. Only reach_open_api observes.
    return isCoupangRenewalCheckpointTarget(target) ? "NONE" : { observe: target };
  }

  /** The seller acted on the control. Advances only a still-open barrier for that same target. */
  onUserActionObserved(target: CoupangRenewalTarget): CoupangRenewalEffect {
    if (this.currentTarget !== target || this.stage !== TARGET_BARRIER[target]) return "NONE";
    if (target === "reach_open_api") return "VERIFY_REACH";
    // A viewport CHECKPOINT never completes on an observed WING action — it advances only on `다음`. Fail closed.
    return "NONE";
  }

  /** Verify the seller reached the open-API page after the reach_open_api navigation guidance. */
  onReachVerified(probe: WingSurfaceProbe): CoupangRenewalEffect {
    if (isCoupangRenewalTerminal(this.stage)) return "NONE";
    if (this.stage !== TARGET_BARRIER.reach_open_api || this.currentTarget !== "reach_open_api") return "NONE";
    if (!probe.ok || probe.blockerCode === "LOGIN_REQUIRED" || probe.pageCategory === "login") {
      return this.park("waiting_login", "LOGIN_REQUIRED");
    }
    if (probe.pageCategory === "open_api_issuance") {
      this.emit("USER_ACTION_OBSERVED", { stepId: this.stepId(), observed: true });
      this.completedSteps = this.activeStepIndex; // step 1 (reach the open-API page)
      this.emit("STEP_COMPLETED", { stepId: this.stepId(), stepStatus: "COMPLETED" });
      this.currentTarget = "check_expiry";
      return { guide: "check_expiry" };
    }
    return this.park("page_mismatch", "UI_DRIFT");
  }

  /** Where the run goes once a barrier's control has been acted on. */
  private advanceAfterBarrier(target: CoupangRenewalTarget): CoupangRenewalEffect {
    switch (target) {
      // reach_open_api never reaches here — its barrier advances via onReachVerified. Kept for exhaustiveness.
      case "reach_open_api":
        this.currentTarget = "check_expiry";
        return { guide: "check_expiry" };
      case "check_expiry":
        this.currentTarget = "reissue";
        return { guide: "reissue" };
      case "reissue":
        this.currentTarget = "credentials";
        return { guide: "credentials" };
      case "credentials":
        this.currentTarget = "return";
        return { guide: "return" };
      case "return":
        return this.complete();
    }
  }

  private complete(): CoupangRenewalEffect {
    this.stage = "guidance_complete";
    this.activeStepIndex = COUPANG_RENEWAL_TOTAL_STEPS;
    this.completedSteps = COUPANG_RENEWAL_TOTAL_STEPS;
    this.currentTarget = null;
    // "completed" is the guidance finishing — NOT a stored/replaced credential.
    this.emit("RUN_COMPLETED", { status: "COMPLETED" });
    return "CLEANUP";
  }

  /** The seller closed the WING window. Parks recoverably on page_mismatch; re-opening + `다음` recovers. */
  onSurfaceClosed(): CoupangRenewalEffect {
    if (isCoupangRenewalTerminal(this.stage)) return "NONE";
    if (this.stage === "page_mismatch" && this.blockerCode === "UI_DRIFT") return "NONE";
    this.park("page_mismatch", "UI_DRIFT");
    return "CLEAR_HIGHLIGHT";
  }

  /** A drive effect threw — most often a navigation RACE. Parks recoverably rather than leaving the run idle. */
  onDriveFault(): CoupangRenewalEffect {
    if (isCoupangRenewalTerminal(this.stage)) return "NONE";
    if (this.currentTarget) this.activeStepIndex = TARGET_STEP[this.currentTarget];
    this.park("page_mismatch", "UI_DRIFT");
    return "CLEAR_HIGHLIGHT";
  }

  /* ── operator-driven transitions ──────────────────────────────────────────── */

  private pause(): CoupangRenewalEffect {
    this.paused = true;
    this.emit("RUN_STATUS_CHANGED", { status: "PAUSED" });
    return "NONE";
  }

  private resume(): CoupangRenewalEffect {
    this.paused = false;
    this.emit("RUN_STATUS_CHANGED", { status: "WAITING_FOR_HUMAN" });
    if (!this.currentTarget) return "NONE";
    return isCoupangRenewalCheckpointTarget(this.currentTarget) ? { guide: this.currentTarget } : { observe: this.currentTarget };
  }

  /** Cancel, or leave for the manual path — both are the same benign, non-completing terminal. */
  private abort(): CoupangRenewalEffect {
    this.paused = false;
    this.stage = "operator_aborted";
    this.blockerCode = null;
    this.blockerRecoverable = false;
    this.emit("RUN_STATUS_CHANGED", { status: "CANCELLED" });
    return "CLEANUP";
  }

  /** Park recoverably at a seller-clearable stop. Emits RUN_BLOCKED { recoverable: true } — never RUN_FAILED. */
  private park(
    stage: "waiting_login" | "target_not_found" | "page_mismatch",
    code: "LOGIN_REQUIRED" | "TARGET_NOT_FOUND" | "UI_DRIFT",
  ): CoupangRenewalEffect {
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
    return coupangRenewalStepMetaAt(coupangRenewalStepPlan(), stepNumber).stepId;
  }
  private stepId(): string {
    return this.stepIdFor(this.activeStepIndex);
  }

  view(): ActionWindowRunView {
    const plan = coupangRenewalStepPlan();
    const meta = coupangRenewalStepMetaAt(plan, this.activeStepIndex);
    const status: RunStatus = this.paused ? "PAUSED" : coupangRenewalStageToRunStatus(this.stage);
    const view: ActionWindowRunView = {
      protocolVersion: 2,
      runId: this.runId,
      revision: this.revision,
      channelCode: this.channelCode,
      runCopyKey: COUPANG_RENEWAL_RUN_COPY_KEY,
      status,
      executionMode: "ACTION_WINDOW",
      intent: "API_ISSUANCE_GUIDANCE",
      // Deliberately NO appBranch — the Coupang renewal walk is linear.
      currentStep: {
        stepId: meta.stepId,
        stepNumber: meta.stepNumber,
        totalSteps: COUPANG_RENEWAL_TOTAL_STEPS,
        copyKey: meta.copyKey,
        ...(meta.copyParams ? { copyParams: meta.copyParams } : {}),
        status: coupangRenewalStageToStepStatus(this.stage),
      },
      guidanceEnabled: this.guidanceEnabled,
      allowedCommands: this.paused ? [...COUPANG_RENEWAL_PAUSED_COMMANDS] : [...coupangRenewalAllowedCommands(this.stage)],
      progress: { completedSteps: this.completedSteps, totalSteps: COUPANG_RENEWAL_TOTAL_STEPS },
      updatedAt: this.clock(),
    };
    if (this.blockerCode && isCoupangRenewalPark(this.stage)) {
      view.blocker = { code: this.blockerCode, recoverable: this.blockerRecoverable };
    }
    return view;
  }

  events(): readonly EventEnvelope[] {
    return this.log;
  }
  currentStage(): CoupangRenewalStage {
    return this.stage;
  }
  isStarted(): boolean {
    return this.started;
  }
  isPaused(): boolean {
    return this.paused;
  }
  isAtBarrier(): boolean {
    return isCoupangRenewalBarrier(this.stage) || isCoupangRenewalPark(this.stage);
  }
  activeTarget(): CoupangRenewalTarget | null {
    return this.currentTarget;
  }
}
