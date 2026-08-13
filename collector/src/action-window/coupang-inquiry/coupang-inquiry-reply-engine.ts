/**
 * **Action Window Runtime — Coupang 고객문의 reply-entry engine (ISOLATED, v2).**
 *
 * A pure reducer for a guided, human-performed Coupang inquiry answer. See
 * `./coupang-inquiry-reply-stages.ts` for why this run has no driver and reads no DOM: the WING
 * 고객문의 screen has never been measured, so there is nothing calibrated to point at, and pointing
 * at a guess is worse than pointing at nothing.
 *
 * The engine's whole job is to hold the honest shape of the run:
 *
 *  - it carries the seller to a **screened** destination and then rests;
 *  - it advances only on the seller's own reported action, never on a timer and never on inference;
 *  - it can reach exactly one success terminal, `OPERATOR_REPORTED`, which records what the operator
 *    said next to a `verification` that is always `UNVERIFIED`. The two fields are separate so no
 *    consumer can read a report as a confirmation.
 *
 * There is no submit path in this file. There is no click path. The reply text never enters the
 * runtime at all — only an opaque `submissionRef` binds the run to the draft the seller approved.
 *
 * Pure: no I/O, no browser, no wall clock (`occurredAt` comes from an injected marker source).
 */
import type {
  ActionWindowRunView,
  EventEnvelope,
  EventPayload,
  EventType,
  OperatorOutcome,
  RunStatus,
} from "../../../../contracts/action-window/v2/index";
import {
  COUPANG_INQUIRY_REPLY_PAUSED_COMMANDS,
  COUPANG_INQUIRY_REPLY_RUN_COPY_KEY,
  COUPANG_INQUIRY_REPLY_TERMINAL_STAGES,
  COUPANG_INQUIRY_REPLY_TOTAL_STEPS,
  coupangInquiryReplyAllowedCommands,
  coupangInquiryReplyStageToRunStatus,
  coupangInquiryReplyStageToStepStatus,
  coupangInquiryReplyStepMetaAt,
  isCoupangInquiryReplyBarrier,
  type CoupangInquiryReplyStage,
} from "./coupang-inquiry-reply-stages";

/** An opaque 16-hex ref — the contract's shape for every binding this run carries. */
const OPAQUE_REF = /^[0-9a-f]{16}$/;

export interface CoupangInquiryReplyConfig {
  runId: string;
  /**
   * Opaque 16-hex binding to the reply draft the seller approved in SellerOps. NEVER the reply text,
   * the inquiry id, the buyer, or the product — this run is not allowed to know any of them, and the
   * ref exists so an audit can tie the report back to a draft without any of them travelling.
   */
  submissionRef: string;
  /** Monotonic display marker source; never `Date` inside the reducer. */
  clock: () => string;
}

export type CoupangInquiryReplyOutcome = { ok: true } | { ok: false; reason: string };

export class CoupangInquiryReplyEngine {
  static readonly CHANNEL_CODE = "COUPANG";

  private readonly runId: string;
  private readonly submissionRef: string;
  private readonly clock: () => string;

  private stage: CoupangInquiryReplyStage = "PREPARE_SESSION";
  private started = false;
  private paused = false;
  private guidanceEnabled = true;
  private activeStepIndex = 1;
  private completedSteps = 0;
  private revision = 0;
  private seq = 0;
  private readonly log: EventEnvelope[] = [];

  constructor(config: CoupangInquiryReplyConfig) {
    if (!OPAQUE_REF.test(config.submissionRef)) {
      // Fail closed at construction: a run with a malformed binding could still be reported, and a
      // report that cannot be tied back to an approved draft is an audit record of nothing.
      throw new Error("coupang inquiry reply run requires an opaque 16-hex submissionRef");
    }
    this.runId = config.runId;
    this.submissionRef = config.submissionRef;
    this.clock = config.clock;
  }

  /** Begin the run: the guided window is opening at the screened destination. */
  start(): CoupangInquiryReplyOutcome {
    if (this.started) {
      return { ok: false, reason: "run already started" };
    }
    this.started = true;
    this.bump();
    this.emit("RUN_STARTED", { status: this.runStatus(), submissionRef: this.submissionRef });
    this.emitStepReady();
    return { ok: true };
  }

  /**
   * The guided window is open on the WING host. The run moves to its first human barrier — it does
   * NOT claim the seller is on the inquiry screen, only that a window exists for them to get there.
   */
  onWindowOpened(): CoupangInquiryReplyOutcome {
    return this.advanceTo("PREPARE_SESSION", "WAIT_FOR_SCREEN");
  }

  /**
   * The seller confirmed, through the trusted confirmation channel, that they are looking at their
   * own 고객문의 screen. Nothing verifies this and nothing pretends to: no DOM is read, so the
   * seller's word is the only evidence, and the step records exactly that.
   */
  onScreenConfirmed(): CoupangInquiryReplyOutcome {
    return this.advanceTo("WAIT_FOR_SCREEN", "WAIT_FOR_SUBMIT");
  }

  /**
   * The operator reports what happened at the submit barrier. This is the only path to a success
   * terminal, and `verification` rides along as a separate, always-`UNVERIFIED` field.
   */
  onOperatorReported(outcome: OperatorOutcome): CoupangInquiryReplyOutcome {
    if (this.paused) {
      return { ok: false, reason: "run is paused" };
    }
    if (this.stage !== "WAIT_FOR_SUBMIT") {
      // A report from any other stage would be a report about a barrier the seller never reached.
      return { ok: false, reason: `cannot report from stage ${this.stage}` };
    }
    const stepId = this.stepId();
    this.completedSteps = COUPANG_INQUIRY_REPLY_TOTAL_STEPS;
    this.stage = "OPERATOR_REPORTED";
    this.bump();
    this.emit("SUBMISSION_REPORTED", {
      stepId,
      operatorOutcome: outcome,
      verification: "UNVERIFIED",
      submissionRef: this.submissionRef,
    });
    this.emit("RUN_OPERATOR_REPORTED", {
      status: "OPERATOR_REPORTED",
      operatorOutcome: outcome,
      verification: "UNVERIFIED",
      submissionRef: this.submissionRef,
    });
    return { ok: true };
  }

  pause(): CoupangInquiryReplyOutcome {
    if (this.isTerminal() || this.paused) {
      return { ok: false, reason: "run cannot be paused" };
    }
    this.paused = true;
    this.bump();
    this.emit("RUN_STATUS_CHANGED", { status: "PAUSED" });
    return { ok: true };
  }

  resume(): CoupangInquiryReplyOutcome {
    if (!this.paused) {
      return { ok: false, reason: "run is not paused" };
    }
    this.paused = false;
    this.bump();
    this.emit("RUN_STATUS_CHANGED", { status: this.runStatus() });
    return { ok: true };
  }

  cancel(): CoupangInquiryReplyOutcome {
    if (this.isTerminal()) {
      return { ok: false, reason: "run already terminal" };
    }
    this.paused = false;
    this.stage = "CANCELLED";
    this.bump();
    this.emit("RUN_STATUS_CHANGED", { status: "CANCELLED" });
    return { ok: true };
  }

  setGuidanceEnabled(enabled: boolean): CoupangInquiryReplyOutcome {
    if (this.isTerminal()) {
      return { ok: false, reason: "run already terminal" };
    }
    this.guidanceEnabled = enabled;
    this.bump();
    return { ok: true };
  }

  /** A fail-closed stop — the destination failed screening, the window died, anything ambiguous. */
  fail(): CoupangInquiryReplyOutcome {
    if (this.isTerminal()) {
      return { ok: false, reason: "run already terminal" };
    }
    this.paused = false;
    this.stage = "FAILED";
    this.bump();
    this.emit("RUN_FAILED", { status: "FAILED" });
    return { ok: true };
  }

  private advanceTo(
    from: CoupangInquiryReplyStage,
    to: CoupangInquiryReplyStage,
  ): CoupangInquiryReplyOutcome {
    if (this.paused) {
      return { ok: false, reason: "run is paused" };
    }
    if (this.stage !== from) {
      return { ok: false, reason: `cannot advance from stage ${this.stage}` };
    }
    this.emit("STEP_COMPLETED", { stepId: this.stepId() });
    this.completedSteps += 1;
    this.stage = to;
    this.activeStepIndex += 1;
    this.bump();
    this.emitStepReady();
    return { ok: true };
  }

  private emitStepReady(): void {
    const meta = coupangInquiryReplyStepMetaAt(this.activeStepIndex);
    this.emit("STEP_READY", {
      stepId: meta.stepId,
      stepNumber: meta.stepNumber,
      totalSteps: COUPANG_INQUIRY_REPLY_TOTAL_STEPS,
      stepStatus: coupangInquiryReplyStageToStepStatus(this.stage),
    });
    if (isCoupangInquiryReplyBarrier(this.stage)) {
      this.emit("HUMAN_ACTION_REQUIRED", { stepId: meta.stepId });
    }
  }

  private bump(): void {
    this.revision += 1;
  }

  private emit(type: EventType, payload: EventPayload): void {
    this.seq += 1;
    this.log.push({
      protocolVersion: 2,
      eventId: `${this.runId}-${this.seq}`,
      runId: this.runId,
      sequence: this.seq,
      revision: this.revision,
      type,
      occurredAt: this.clock(),
      payload,
    });
  }

  private stepId(): string {
    return coupangInquiryReplyStepMetaAt(this.activeStepIndex).stepId;
  }

  private runStatus(): RunStatus {
    return coupangInquiryReplyStageToRunStatus(this.stage);
  }

  private isTerminal(): boolean {
    return COUPANG_INQUIRY_REPLY_TERMINAL_STAGES.includes(this.stage);
  }

  view(): ActionWindowRunView {
    const meta = coupangInquiryReplyStepMetaAt(this.activeStepIndex);
    const status: RunStatus = this.paused ? "PAUSED" : this.runStatus();
    return {
      protocolVersion: 2,
      runId: this.runId,
      revision: this.revision,
      channelCode: CoupangInquiryReplyEngine.CHANNEL_CODE,
      runCopyKey: COUPANG_INQUIRY_REPLY_RUN_COPY_KEY,
      status,
      // Always ACTION_WINDOW: the seller performs every marketplace action. It is also what keeps
      // the v2 WAITING_FOR_HUMAN invariant satisfied at both barriers.
      executionMode: "ACTION_WINDOW",
      intent: "REPLY_SUBMISSION",
      currentStep: {
        stepId: meta.stepId,
        stepNumber: meta.stepNumber,
        totalSteps: COUPANG_INQUIRY_REPLY_TOTAL_STEPS,
        copyKey: meta.copyKey,
        status: this.paused ? "AWAITING_USER" : coupangInquiryReplyStageToStepStatus(this.stage),
      },
      guidanceEnabled: this.guidanceEnabled,
      allowedCommands: this.paused
        ? [...COUPANG_INQUIRY_REPLY_PAUSED_COMMANDS]
        : [...coupangInquiryReplyAllowedCommands(this.stage)],
      progress: { completedSteps: this.completedSteps, totalSteps: COUPANG_INQUIRY_REPLY_TOTAL_STEPS },
      updatedAt: this.clock(),
    };
  }

  events(): readonly EventEnvelope[] {
    return this.log;
  }

  currentStage(): CoupangInquiryReplyStage {
    return this.stage;
  }

  isAtBarrier(): boolean {
    return isCoupangInquiryReplyBarrier(this.stage);
  }
}
