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
  | "LOCATE_ROW"
  | "HIGHLIGHT_ROW"
  | "WAIT_FOR_ROW_OPEN"
  | "LOCATE_COMPOSER"
  | "HIGHLIGHT_COMPOSER"
  | "WAIT_FOR_SUBMIT"
  | "OPERATOR_REPORTED"
  | "FAILED"
  | "CANCELLED"
  | "PAUSED";

export const REPLY_TERMINAL_STAGES: readonly ReplyStage[] = ["OPERATOR_REPORTED", "FAILED", "CANCELLED"];

/** Run mode. `ABORT_REHEARSAL` makes the submitted path structurally impossible (guided-only, abort-terminal). */
export type ReplyRunMode = "FULL_SUBMIT" | "ABORT_REHEARSAL";
/** Which step plan a run follows — chosen from whether a privacy-safe target hint is present. */
export type ReplyPlanKind = "LEGACY" | "GUIDED";

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

/**
 * The GUIDED plan — three steps. Step 2 is the review-row open barrier (the operator clicks the reply
 * control themselves); step 3 is the composer submit barrier. Used only when a privacy-safe target hint
 * is present (and always in `ABORT_REHEARSAL`).
 */
export const REPLY_STEP_PLAN_GUIDED: readonly ReplyStepMeta[] = [
  { stepNumber: 1, stepId: "aw.prepare_reply_surface", copyKey: "actionWindow.step.prepareReplySurface", mode: "AUTOMATIC_OPERATION" },
  { stepNumber: 2, stepId: "aw.open_review_row", copyKey: "actionWindow.step.openReviewRow", mode: "ACTION_WINDOW", copyParams: { targetKind: "review_row" } },
  { stepNumber: 3, stepId: "aw.user_reply_submit", copyKey: "actionWindow.step.userReplySubmit", mode: "ACTION_WINDOW", copyParams: { targetKind: "reply_composer" } },
];

/** The legacy plan's step total. Guided runs use `REPLY_STEP_PLAN_GUIDED.length` (3) — read per-run. */
export const REPLY_TOTAL_STEPS = REPLY_STEP_PLAN.length;

/** Resolve the step plan for a run's plan kind. */
export function replyPlanFor(kind: ReplyPlanKind): readonly ReplyStepMeta[] {
  return kind === "GUIDED" ? REPLY_STEP_PLAN_GUIDED : REPLY_STEP_PLAN;
}

/** Index into a given plan (1-based). */
export function replyStepMetaAt(plan: readonly ReplyStepMeta[], stepIndex: number): ReplyStepMeta {
  const meta = plan[stepIndex - 1];
  if (!meta) throw new Error(`invalid reply stepIndex ${stepIndex}`);
  return meta;
}

/** Legacy-plan convenience (kept for callers that predate guided plans). */
export function replyStepMetaByIndex(stepIndex: number): ReplyStepMeta {
  return replyStepMetaAt(REPLY_STEP_PLAN, stepIndex);
}

/** Which 1-based step a stage belongs to. Has a `default`, like the export machine's counterpart. */
export function replyStageStepIndex(stage: ReplyStage, guided = false): number {
  switch (stage) {
    case "PREPARE_SESSION":
    case "LOCATE_ROW":
    case "HIGHLIGHT_ROW":
      return 1;
    case "WAIT_FOR_ROW_OPEN":
      return 2; // guided-only: the review-row open barrier
    case "LOCATE_COMPOSER":
    case "HIGHLIGHT_COMPOSER":
      return guided ? 3 : 1;
    case "WAIT_FOR_SUBMIT":
    case "OPERATOR_REPORTED":
      return guided ? 3 : 2;
    default:
      return guided ? 3 : 2; // FAILED / CANCELLED / PAUSED resolve against the stored active step
  }
}

export function replyStageToRunStatus(stage: ReplyStage): RunStatus {
  switch (stage) {
    case "PREPARE_SESSION":
      return "PREPARING";
    case "LOCATE_ROW":
    case "HIGHLIGHT_ROW":
    case "LOCATE_COMPOSER":
    case "HIGHLIGHT_COMPOSER":
      return "RUNNING";
    case "WAIT_FOR_ROW_OPEN":
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
    case "LOCATE_ROW":
      return "PREPARING";
    case "HIGHLIGHT_ROW":
      return "READY";
    case "WAIT_FOR_ROW_OPEN":
      return "AWAITING_USER";
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
 * Commands accepted in a given stage, for a given run mode. Terminal stages accept nothing.
 *
 * <p>Two design rules:
 * <ul>
 *   <li>**Abort is acceptable from process start through every non-terminal stage.** `SWITCH_TO_MANUAL`
 *       ("I did not post it through guidance" → `SUBMISSION_ABORTED`) is accepted in EVERY non-terminal
 *       stage in both modes, so an operator abort — armed from process start — always yields a clean
 *       `SUBMISSION_ABORTED` rather than racing a fail-closed into `FAILED`.
 *   <li>**The submitted path is confined and mode-gated.** `REQUEST_STEP_RECHECK` ("I posted the reply" →
 *       `OPERATOR_REPORTED_SUBMITTED`) is accepted ONLY at `WAIT_FOR_SUBMIT` and ONLY in `FULL_SUBMIT`.
 *       In `ABORT_REHEARSAL` no stage lists it, so `OPERATOR_REPORTED_SUBMITTED` is structurally
 *       unreachable and the FE never even offers "I posted it".
 * </ul>
 * There is no new command type, by design. The Runtime never submits; it only observes and records.
 */
export function replyAllowedCommands(stage: ReplyStage, mode: ReplyRunMode = "FULL_SUBMIT"): CommandType[] {
  // Abort is always available while the run is live.
  const abort: CommandType[] = ["SWITCH_TO_MANUAL"];
  switch (stage) {
    case "PREPARE_SESSION":
    case "LOCATE_ROW":
    case "HIGHLIGHT_ROW":
    case "LOCATE_COMPOSER":
    case "HIGHLIGHT_COMPOSER":
      return [...abort, "PAUSE_RUN", "CANCEL_RUN", "FIND_CURRENT_STEP", "SET_GUIDANCE_ENABLED"];
    case "WAIT_FOR_ROW_OPEN":
      // The row-open barrier is lifted by OBSERVATION (the operator's own click), never a report command.
      return [...abort, "SET_GUIDANCE_ENABLED", "PAUSE_RUN", "CANCEL_RUN", "FIND_CURRENT_STEP"];
    case "WAIT_FOR_SUBMIT":
      return [
        ...(mode === "FULL_SUBMIT" ? (["REQUEST_STEP_RECHECK"] as CommandType[]) : []),
        ...abort,
        "SET_GUIDANCE_ENABLED",
        "PAUSE_RUN",
        "CANCEL_RUN",
        "FIND_CURRENT_STEP",
      ];
    case "PAUSED":
      return [...abort, "RESUME_RUN", "CANCEL_RUN", "FIND_CURRENT_STEP"];
    case "OPERATOR_REPORTED":
    case "FAILED":
    case "CANCELLED":
      return [];
  }
}
