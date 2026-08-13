/**
 * **Coupang WING inquiry reply-entry stages & v2 contract mapping (ISOLATED).**
 *
 * The internal state machine for ONE guided Coupang 고객문의 answer, and the only place it maps onto
 * the v2 contract's enums. A separate module from `../reply-submission/reply-stages.ts` for the same
 * reason the Coupang issuance walk is separate from NAVER's: same v2 intent, different channel
 * choreography, and the audited runtime stays untouched.
 *
 * **What this run is — and, more importantly, what it is not.**
 *
 * The NAVER reply runtime locates the review row and the composer in-page, so it can highlight the
 * exact control the seller should press. Nothing equivalent exists for the WING 고객문의 screen: no
 * sitting has ever measured it, so there is no calibrated selector, no target signature, and no
 * observation predicate. This runtime therefore has **no driver and reads no DOM at all**. It carries
 * the seller to their own screen, rests, and waits to be told what happened.
 *
 * That is a deliberate choice over the alternative of guessing selectors. A guessed target either
 * highlights the wrong control or silently matches nothing, and both are worse than an honest "you
 * are on the screen; the reply is in the panel; post it yourself." The measurement is a follow-up
 * calibration sitting; until it lands, an uncalibrated run must not pretend to point at anything.
 *
 * **Consequences that are contract-level, not stylistic:**
 *
 *  - **The Runtime never submits.** There is no click, type, or submit path here, in any driver
 *    (there is no driver), or anywhere downstream. A reply post is not idempotent; the guarantee
 *    against double-posting is structural — it never posts at all.
 *  - **The terminal is `OPERATOR_REPORTED`, never `COMPLETED`.** A Coupang reply has no read-back
 *    oracle available to this run, so observing is not verifying. The report says what the operator
 *    says happened; it never claims SellerOps confirmed it.
 *  - **No target highlight is ever emitted**, because nothing has been measured to highlight.
 *
 * Pure: no I/O, no browser, no wall clock.
 */
import type {
  CommandType,
  ExecutionMode,
  RunStatus,
  StepStatus,
} from "../../../../contracts/action-window/v2/index";

export type CoupangInquiryReplyStage =
  /** The guided window is opening at the screened WING destination. */
  | "PREPARE_SESSION"
  /** Resting: the seller navigates to their own 고객문의 screen and confirms they are there. */
  | "WAIT_FOR_SCREEN"
  /** Resting: the reply is in the panel; the seller posts it themselves on the marketplace. */
  | "WAIT_FOR_SUBMIT"
  /** Terminal: the operator reported the outcome. Reported ≠ verified. */
  | "OPERATOR_REPORTED"
  | "FAILED"
  | "CANCELLED"
  | "PAUSED";

export const COUPANG_INQUIRY_REPLY_TERMINAL_STAGES: readonly CoupangInquiryReplyStage[] = [
  "OPERATOR_REPORTED",
  "FAILED",
  "CANCELLED",
];

export const COUPANG_INQUIRY_REPLY_RUN_COPY_KEY = "actionWindow.coupangInquiryReply.run";

export interface CoupangInquiryReplyStepMeta {
  stepNumber: number;
  stepId: string;
  copyKey: string;
  mode: ExecutionMode;
}

/**
 * Three steps. Step 1 is the only automatic one and it does nothing to the marketplace — it opens a
 * window at a screened destination. Steps 2 and 3 are both human barriers, and they are separate on
 * purpose: "I am on the right screen" and "I posted the reply" are different claims, and collapsing
 * them would let a run that never reached the screen report a submission.
 */
export const COUPANG_INQUIRY_REPLY_STEP_PLAN: readonly CoupangInquiryReplyStepMeta[] = [
  {
    stepNumber: 1,
    stepId: "aw.coupang_inquiry_open_wing",
    copyKey: "actionWindow.coupangInquiryReply.openWing",
    mode: "AUTOMATIC_OPERATION",
  },
  {
    stepNumber: 2,
    stepId: "aw.coupang_inquiry_reach_screen",
    copyKey: "actionWindow.coupangInquiryReply.reachScreen",
    mode: "ACTION_WINDOW",
  },
  {
    stepNumber: 3,
    stepId: "aw.coupang_inquiry_user_reply",
    copyKey: "actionWindow.coupangInquiryReply.userReply",
    mode: "ACTION_WINDOW",
  },
];

export const COUPANG_INQUIRY_REPLY_TOTAL_STEPS = COUPANG_INQUIRY_REPLY_STEP_PLAN.length;

export function coupangInquiryReplyStepMetaAt(stepNumber: number): CoupangInquiryReplyStepMeta {
  const meta = COUPANG_INQUIRY_REPLY_STEP_PLAN[stepNumber - 1];
  if (!meta) throw new Error(`invalid coupang inquiry reply step ${stepNumber}`);
  return meta;
}

/** Which 1-based step a stage belongs to. Terminals resolve against the last human step. */
export function coupangInquiryReplyStageStepIndex(stage: CoupangInquiryReplyStage): number {
  switch (stage) {
    case "PREPARE_SESSION":
      return 1;
    case "WAIT_FOR_SCREEN":
      return 2;
    default:
      return 3;
  }
}

export function coupangInquiryReplyStageToRunStatus(stage: CoupangInquiryReplyStage): RunStatus {
  switch (stage) {
    case "PREPARE_SESSION":
      return "PREPARING";
    case "WAIT_FOR_SCREEN":
    case "WAIT_FOR_SUBMIT":
      return "WAITING_FOR_HUMAN";
    case "OPERATOR_REPORTED":
      return "OPERATOR_REPORTED";
    case "FAILED":
      return "FAILED";
    case "CANCELLED":
      return "CANCELLED";
    case "PAUSED":
      return "PAUSED";
  }
}

export function coupangInquiryReplyStageToStepStatus(stage: CoupangInquiryReplyStage): StepStatus {
  switch (stage) {
    case "PREPARE_SESSION":
      return "PREPARING";
    case "WAIT_FOR_SCREEN":
    case "WAIT_FOR_SUBMIT":
      // The v2 cross-field rule: WAITING_FOR_HUMAN is only valid with an AWAITING_USER step in
      // ACTION_WINDOW mode. Both barrier stages therefore report AWAITING_USER.
      return "AWAITING_USER";
    case "OPERATOR_REPORTED":
      return "OPERATOR_REPORTED";
    case "FAILED":
      return "FAILED";
    case "CANCELLED":
      return "SKIPPED";
    case "PAUSED":
      return "AWAITING_USER";
  }
}

/** True while the run is resting on the seller. */
export function isCoupangInquiryReplyBarrier(stage: CoupangInquiryReplyStage): boolean {
  return stage === "WAIT_FOR_SCREEN" || stage === "WAIT_FOR_SUBMIT";
}

export const COUPANG_INQUIRY_REPLY_PAUSED_COMMANDS: readonly CommandType[] = [
  "RESUME_RUN",
  "CANCEL_RUN",
  "FIND_CURRENT_STEP",
];

/**
 * What the FE may offer at each stage. `SWITCH_TO_MANUAL` is offered at every barrier: the seller
 * must always be able to walk away from the guided run and keep working on the marketplace by hand.
 */
export function coupangInquiryReplyAllowedCommands(
  stage: CoupangInquiryReplyStage,
): readonly CommandType[] {
  switch (stage) {
    case "PREPARE_SESSION":
      return ["PAUSE_RUN", "CANCEL_RUN", "FIND_CURRENT_STEP"];
    case "WAIT_FOR_SCREEN":
    case "WAIT_FOR_SUBMIT":
      return ["PAUSE_RUN", "CANCEL_RUN", "FIND_CURRENT_STEP", "SWITCH_TO_MANUAL", "SET_GUIDANCE_ENABLED"];
    case "PAUSED":
      return COUPANG_INQUIRY_REPLY_PAUSED_COMMANDS;
    default:
      // Terminals offer nothing — there is no run left to command.
      return [];
  }
}
