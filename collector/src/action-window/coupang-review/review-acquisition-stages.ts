/**
 * **`REVIEW_ACQUISITION` stages & v2 contract mapping (ISOLATED).**
 *
 * The internal state machine for ONE Coupang WING 상품평 read started from a SellerOps screen or a conversation
 * (product-owner decision, 2026-08-28), and the only place it maps onto the v2 contract's enums. A separate
 * module from the export / reply / import / issuance / locate stage tables for the reason those are separate
 * from each other: the audited runtimes stay untouched.
 *
 * **What an acquisition run is.** The Action Window shape of the seated CLI that live-proved this read
 * (`cli/acquire-coupang-reviews.ts`): the window comes up on WING's front door, the seller brings the 상품평
 * list up and turns every page themselves, and at each page they confirm — the runtime then reads the rows in
 * front of them. When the pager shows its last page, or the seller ends the walk early, everything read is
 * handed to the backend in ONE bounded POST. The run **never turns a page**: the pager is a marketplace control
 * and `CLAUDE.md` forbids hidden or chained platform clicks.
 *
 * **Three steps.** 1 — the binding is resolved and the window is up (automatic); 2 — the per-page barrier the
 * seller lifts as many times as they have pages (`aw.user_target_action`, the same step id the export walk
 * uses for "the seller acts on the marketplace"); 3 — the handoff (automatic). Step 2 is re-entered after
 * every read, so the progress counter does not count pages — the run's `runCopyParams` do.
 *
 * **Two commands at the barrier, and what each means here.** `REQUEST_STEP_RECHECK` = "read the page I am on
 * now"; `SWITCH_TO_MANUAL` = "end the walk here — hand over what you have". The second is the closed
 * vocabulary's nearest word for the CLI's 「여기까지만 수집하고 끝내기」 button; an FE renders it under that
 * copy on this intent. `CANCEL_RUN` discards: nothing read is stored.
 *
 * Pure: no I/O, no browser, no time source.
 */
import type { CommandType, CopyParams, ExecutionMode, RunStatus, StepStatus } from "../../../../contracts/action-window/v2/index";

export type ReviewAcquisitionStage =
  /** Automatic: the binding is being resolved into the account this walk collects for; the window comes up. */
  | "opening"
  /**
   * The per-page barrier. The seller has the list up (or is getting there) and presses 「현재 화면 확인」 when
   * the page they want read is on screen. Parked here after every accepted page, too.
   */
  | "awaiting_page"
  /** Automatic: reading the page in front of the seller. */
  | "reading"
  /** Automatic: the ONE bounded handoff of everything read. */
  | "handing_off"
  /** Terminal: the handoff was accepted (or there was nothing to hand over). Counts live in the view. */
  | "completed"
  /** Terminal failure: the binding could not be resolved, so there was never an account to collect for. */
  | "binding_unresolved"
  /** Terminal failure: the handoff was refused. Nothing stored. */
  | "handoff_rejected"
  /** Terminal: the seller cancelled. Nothing stored. */
  | "operator_aborted";

export const REVIEW_ACQUISITION_TERMINAL_STAGES: readonly ReviewAcquisitionStage[] = [
  "completed",
  "binding_unresolved",
  "handoff_rejected",
  "operator_aborted",
];

export function isReviewAcquisitionTerminal(stage: ReviewAcquisitionStage): boolean {
  return REVIEW_ACQUISITION_TERMINAL_STAGES.includes(stage);
}

/* ────────────────────────────── the fixed 3-step plan ────────────────────────────── */

export interface ReviewAcquisitionStepMeta {
  stepNumber: number;
  stepId: string;
  copyKey: string;
  mode: ExecutionMode;
  copyParams?: CopyParams;
}

export const REVIEW_ACQUISITION_RUN_COPY_KEY = "actionWindow.reviewAcquisition.run";

export const REVIEW_ACQUISITION_STEP_PLAN: readonly ReviewAcquisitionStepMeta[] = Object.freeze([
  Object.freeze({
    stepNumber: 1,
    stepId: "aw.review_acquisition_open_list",
    copyKey: "actionWindow.reviewAcquisition.openList",
    mode: "ACTION_WINDOW" as ExecutionMode,
  }),
  Object.freeze({
    stepNumber: 2,
    // The export walk's own barrier id: "the seller acts on the marketplace". Here the act is bringing a page
    // up and confirming it — several presses are fine, and every one of them is the seller's.
    stepId: "aw.user_target_action",
    copyKey: "actionWindow.reviewAcquisition.confirmPage",
    mode: "ACTION_WINDOW" as ExecutionMode,
    copyParams: { targetKind: "review_list_page" },
  }),
  Object.freeze({
    stepNumber: 3,
    stepId: "aw.review_acquisition_handoff",
    copyKey: "actionWindow.reviewAcquisition.handoff",
    mode: "AUTOMATIC_OPERATION" as ExecutionMode,
  }),
]);

export const REVIEW_ACQUISITION_TOTAL_STEPS = REVIEW_ACQUISITION_STEP_PLAN.length;

export function reviewAcquisitionStepMetaAt(stepNumber: number): ReviewAcquisitionStepMeta {
  const index = Math.min(Math.max(stepNumber, 1), REVIEW_ACQUISITION_STEP_PLAN.length) - 1;
  const meta = REVIEW_ACQUISITION_STEP_PLAN[index];
  if (!meta) throw new Error("review-acquisition-stages: empty step plan");
  return meta;
}

/* ────────────────────────────── v2 enum mapping ────────────────────────────── */

export function reviewAcquisitionStageToRunStatus(stage: ReviewAcquisitionStage): RunStatus {
  switch (stage) {
    case "opening":
      return "PREPARING";
    case "awaiting_page":
      return "WAITING_FOR_HUMAN";
    case "reading":
      return "RUNNING";
    case "handing_off":
      return "PROCESSING";
    case "completed":
      return "COMPLETED";
    case "binding_unresolved":
    case "handoff_rejected":
      return "FAILED";
    case "operator_aborted":
      return "CANCELLED";
  }
}

export function reviewAcquisitionStageToStepStatus(stage: ReviewAcquisitionStage): StepStatus {
  switch (stage) {
    case "opening":
      return "PREPARING";
    case "awaiting_page":
      return "AWAITING_USER";
    case "reading":
      return "OBSERVING";
    case "handing_off":
      return "PROCESSING";
    case "completed":
      return "COMPLETED";
    case "binding_unresolved":
    case "handoff_rejected":
      return "FAILED";
    case "operator_aborted":
      return "PENDING";
  }
}

/**
 * Which commands the frontend may render, per stage.
 *
 * <p>No command turns a page, presses a control, or reads beyond the visible screen. There is no `PAUSE_RUN`:
 * a parked acquisition IS the seller taking their time, and a paused one would be the same thing with an
 * extra button.
 */
export function reviewAcquisitionAllowedCommands(stage: ReviewAcquisitionStage): readonly CommandType[] {
  if (isReviewAcquisitionTerminal(stage)) return [];
  if (stage === "awaiting_page") {
    return ["REQUEST_STEP_RECHECK", "SWITCH_TO_MANUAL", "CANCEL_RUN", "FIND_CURRENT_STEP"];
  }
  // The handoff is one POST of what customers wrote; a cancel that lands mid-flight cannot un-send it, so the
  // stage that performs it offers nothing but "find my window".
  if (stage === "handing_off") return ["FIND_CURRENT_STEP"];
  return ["CANCEL_RUN", "FIND_CURRENT_STEP"];
}
