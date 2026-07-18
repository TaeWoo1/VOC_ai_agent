/**
 * **Action Window Runtime — reply-submission stages & v2 contract mapping (ISOLATED).**
 *
 * The internal state machine for a guided, human-performed reply SUBMISSION. It is deliberately a
 * SEPARATE module from the export runtime's `../stages.ts`: the audited v1 export engine, its stage
 * machine, and its persisted-run store are left untouched (product-owner decision, 2026-07-18). This
 * module maps reply-submission stages onto the **v2** contract's enums and is the only place that
 * does so.
 *
 * A reply submission has NO downstream evidence chain — no download, no artifact, no ingest, and no
 * verifier, because a reply post has no read-back oracle. So the terminal is `OPERATOR_REPORTED`
 * (never `COMPLETED`), reached when the operator reports they acted at the human barrier.
 *
 * Pure: no I/O, no browser, no time source.
 */
import type {
  RunStatus,
  StepStatus,
  ExecutionMode,
  CommandType,
  CopyParams,
} from "../../../../contracts/action-window/v2/index";

export type ReplyStage =
  | "PREPARE_SESSION"
  | "LOCATE_COMPOSER"
  | "HIGHLIGHT_COMPOSER"
  | "WAIT_FOR_SUBMIT"
  | "OPERATOR_REPORTED"
  | "FAILED"
  | "CANCELLED"
  | "PAUSED";

export const REPLY_TERMINAL_STAGES: readonly ReplyStage[] = ["OPERATOR_REPORTED", "FAILED", "CANCELLED"];

/**
 * The fixed reply-submission step plan — TWO steps, not three. There is no automatic downstream step
 * because there is nothing to detect/validate/ingest; the human barrier IS the last step, and it ends
 * at an operator report, not a verified completion.
 *
 * Copy ownership: Runtime carries dotted semantic `copyKey`s + sanitized primitive `copyParams` ONLY.
 * FE maps these keys to localized copy (and must never render a label that reads as 발송/전송/등록).
 */
export interface ReplyStepMeta {
  stepNumber: number;
  stepId: string;
  copyKey: string;
  mode: ExecutionMode;
  copyParams?: CopyParams;
}
export const REPLY_STEP_PLAN: readonly ReplyStepMeta[] = [
  { stepNumber: 1, stepId: "aw.prepare_reply_surface", copyKey: "actionWindow.step.prepareReplySurface", mode: "AUTOMATIC_OPERATION" },
  { stepNumber: 2, stepId: "aw.user_reply_submit", copyKey: "actionWindow.step.userReplySubmit", mode: "ACTION_WINDOW", copyParams: { targetKind: "reply_composer" } },
];
export const REPLY_TOTAL_STEPS = REPLY_STEP_PLAN.length;

export function replyStepMetaByIndex(stepIndex: number): ReplyStepMeta {
  const meta = REPLY_STEP_PLAN[stepIndex - 1];
  if (!meta) throw new Error(`invalid reply stepIndex ${stepIndex}`);
  return meta;
}

/** Which 1-based step a stage belongs to. Has a `default`, like the export machine's counterpart. */
export function replyStageStepIndex(stage: ReplyStage): number {
  switch (stage) {
    case "PREPARE_SESSION":
    case "LOCATE_COMPOSER":
    case "HIGHLIGHT_COMPOSER":
      return 1;
    case "WAIT_FOR_SUBMIT":
    case "OPERATOR_REPORTED":
      return 2;
    default:
      return 2; // FAILED / CANCELLED / PAUSED resolve against the stored active step
  }
}

export function replyStageToRunStatus(stage: ReplyStage): RunStatus {
  switch (stage) {
    case "PREPARE_SESSION":
      return "PREPARING";
    case "LOCATE_COMPOSER":
    case "HIGHLIGHT_COMPOSER":
      return "RUNNING";
    case "WAIT_FOR_SUBMIT":
      return "WAITING_FOR_HUMAN";
    // The honest terminal: the operator reported, and there is no verifier to promote it to COMPLETED.
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

export function replyStageToStepStatus(stage: ReplyStage): StepStatus {
  switch (stage) {
    case "PREPARE_SESSION":
      return "PREPARING";
    case "LOCATE_COMPOSER":
      return "PREPARING";
    case "HIGHLIGHT_COMPOSER":
      return "READY";
    case "WAIT_FOR_SUBMIT":
      return "AWAITING_USER";
    case "OPERATOR_REPORTED":
      return "OPERATOR_REPORTED";
    case "FAILED":
      return "FAILED";
    case "CANCELLED":
      return "SKIPPED";
    case "PAUSED":
      return "PENDING";
  }
}

/**
 * Commands accepted in a given stage. Terminal stages accept nothing.
 *
 * <p>At the human barrier the operator reports via one of two existing commands — there is no new
 * command type, by design:
 * <ul>
 *   <li>`REQUEST_STEP_RECHECK` = "I posted the reply" → recorded as `OPERATOR_REPORTED_SUBMITTED`;
 *   <li>`SWITCH_TO_MANUAL` = "I did not post it through guidance" → `SUBMISSION_ABORTED`.
 * </ul>
 * Both terminate the run at `OPERATOR_REPORTED`. The Runtime never submits; it only observes and
 * records what the operator reports.
 */
export function replyAllowedCommands(stage: ReplyStage): CommandType[] {
  switch (stage) {
    case "PREPARE_SESSION":
    case "LOCATE_COMPOSER":
    case "HIGHLIGHT_COMPOSER":
      return ["PAUSE_RUN", "CANCEL_RUN", "FIND_CURRENT_STEP", "SET_GUIDANCE_ENABLED"];
    case "WAIT_FOR_SUBMIT":
      return ["REQUEST_STEP_RECHECK", "SWITCH_TO_MANUAL", "SET_GUIDANCE_ENABLED", "PAUSE_RUN", "CANCEL_RUN", "FIND_CURRENT_STEP"];
    case "PAUSED":
      return ["RESUME_RUN", "CANCEL_RUN", "FIND_CURRENT_STEP"];
    case "OPERATOR_REPORTED":
    case "FAILED":
    case "CANCELLED":
      return [];
  }
}
