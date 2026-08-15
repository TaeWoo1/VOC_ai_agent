/**
 * **`REVIEW_LOCATE` stages & v2 contract mapping (ISOLATED).**
 *
 * The internal state machine for ONE press of `[쿠팡에서 보기]`, and the only place it maps onto the v2
 * contract's enums. A separate module from the export / reply / import / issuance stage tables, for the same
 * reason those are separate from each other: the audited runtimes stay untouched.
 *
 * **What a locate run is.** The narrowest run in this codebase. It reads the 상품평 list page the seller
 * brought up, compares every row against one stored review, and — if exactly one row matches — draws a ring
 * around it and scrolls to it. That is the whole run. It turns no page, presses nothing, types nothing,
 * downloads nothing and stores nothing.
 *
 * **Its two steps are the seller's, not the runtime's.** Step 1 is "bring the page up"; step 2 is "here it
 * is". Between them the runtime does automatic work that takes a moment, which is why `searching` exists as
 * its own stage: a frontend must never render "찾았습니다" over a page that has not been read.
 *
 * **Every honest stop is a park, and each says a different thing.** A page with no matching row
 * (`not_on_page`) means the seller should turn a page; two matching rows (`ambiguous`) means SellerOps
 * refuses to guess between two of their buyers' reviews; a screen that is not a readable 상품평 목록 at all
 * (`awaiting_page`) means they are somewhere else entirely. Collapsing those into one "not found" would tell
 * a seller to keep paging through a list that will never resolve an ambiguity.
 *
 * Pure: no I/O, no browser, no time source.
 */
import type { CommandType, CopyParams, ExecutionMode, RunStatus, StepStatus } from "../../../../contracts/action-window/v2/index";

export type ReviewLocateStage =
  /** Automatic: the window is coming up and the binding is being resolved into something to look for. */
  | "opening"
  /**
   * Recoverable park: what is on the screen is not a 상품평 목록 this run can read — the seller is on another
   * WING page, the window was closed, or a read caught the page mid-navigation. All three are one thing from
   * where the seller sits, and one repair: bring the list up and press 다시 확인.
   */
  | "awaiting_page"
  /** Automatic: reading the page in front of the seller and comparing every row against the review. */
  | "searching"
  /** Terminal: exactly one row matched, and the ring is on it. */
  | "highlighted"
  /** Recoverable park: the page read fine and no row on it is this review. The seller pages. */
  | "not_on_page"
  /**
   * Recoverable park: more than one row on this page matches on every field SellerOps has. Nothing is rung.
   * A ring around a coin-flip would be SellerOps telling the seller what a specific buyer wrote.
   */
  | "ambiguous"
  /** Terminal failure: the binding could not be resolved, so there was never anything to look for. */
  | "binding_unresolved"
  /** Terminal: the seller cancelled, or left for the manual path. */
  | "operator_aborted";

export const REVIEW_LOCATE_TERMINAL_STAGES: readonly ReviewLocateStage[] = [
  "highlighted",
  "binding_unresolved",
  "operator_aborted",
];

/**
 * The recoverable parks. Each rests on the SELLER doing something in their own window — bring the list up,
 * turn a page, go back to the 상품평 screen — and a `REQUEST_STEP_RECHECK` re-reads whatever is there now.
 */
export const REVIEW_LOCATE_PARK_STAGES: readonly ReviewLocateStage[] = ["awaiting_page", "not_on_page", "ambiguous"];

export function isReviewLocatePark(stage: ReviewLocateStage): boolean {
  return REVIEW_LOCATE_PARK_STAGES.includes(stage);
}
export function isReviewLocateTerminal(stage: ReviewLocateStage): boolean {
  return REVIEW_LOCATE_TERMINAL_STAGES.includes(stage);
}

/* ────────────────────────────── the fixed 2-step plan ────────────────────────────── */

export interface ReviewLocateStepMeta {
  stepNumber: number;
  stepId: string;
  copyKey: string;
  mode: ExecutionMode;
  copyParams?: CopyParams;
}

export const REVIEW_LOCATE_RUN_COPY_KEY = "actionWindow.reviewLocate.run";

/**
 * Two steps, always. The seller finds the screen; SellerOps finds the review on it. There is no third step
 * because there is nothing after the ring — the run is over the moment the seller can see which row it is.
 */
export const REVIEW_LOCATE_STEP_PLAN: readonly ReviewLocateStepMeta[] = Object.freeze([
  Object.freeze({
    stepNumber: 1,
    stepId: "aw.review_locate_open_list",
    copyKey: "actionWindow.reviewLocate.openList",
    mode: "ACTION_WINDOW" as ExecutionMode,
  }),
  Object.freeze({
    stepNumber: 2,
    stepId: "aw.review_locate_highlight",
    copyKey: "actionWindow.reviewLocate.highlight",
    mode: "ACTION_WINDOW" as ExecutionMode,
  }),
]);

export const REVIEW_LOCATE_TOTAL_STEPS = REVIEW_LOCATE_STEP_PLAN.length;

/** Step metadata at a 1-based index, clamped so a park/terminal view never reads past the plan. */
export function reviewLocateStepMetaAt(stepNumber: number): ReviewLocateStepMeta {
  const index = Math.min(Math.max(stepNumber, 1), REVIEW_LOCATE_STEP_PLAN.length) - 1;
  const meta = REVIEW_LOCATE_STEP_PLAN[index];
  if (!meta) throw new Error("review-locate-stages: empty step plan");
  return meta;
}

/* ────────────────────────────── v2 enum mapping ────────────────────────────── */

export function reviewLocateStageToRunStatus(stage: ReviewLocateStage): RunStatus {
  switch (stage) {
    case "opening":
      return "PREPARING";
    case "searching":
      return "RUNNING";
    case "awaiting_page":
    case "not_on_page":
    case "ambiguous":
      return "WAITING_FOR_HUMAN";
    case "highlighted":
      return "COMPLETED";
    case "binding_unresolved":
      return "FAILED";
    case "operator_aborted":
      return "CANCELLED";
  }
}

export function reviewLocateStageToStepStatus(stage: ReviewLocateStage): StepStatus {
  switch (stage) {
    case "opening":
      return "PREPARING";
    case "searching":
      return "OBSERVING";
    case "awaiting_page":
    case "not_on_page":
    case "ambiguous":
      return "AWAITING_USER";
    case "highlighted":
      return "COMPLETED";
    case "binding_unresolved":
      return "FAILED";
    case "operator_aborted":
      // A cancelled run has no meaningful step status; PENDING is contract-valid and claims no progress.
      return "PENDING";
  }
}

/**
 * Which commands the frontend may render, per stage.
 *
 * <p>There is deliberately no command that turns a page, presses a control, or searches beyond the visible
 * screen. `REQUEST_STEP_RECHECK` is the whole vocabulary of the parks — "I moved to another page, look
 * again" — and it never completes anything on the client; the runtime decides by reading.
 *
 * <p>No `PAUSE_RUN` anywhere. A pause exists so a long guided walk can be put down and picked up; this run
 * is one read, and a paused locate would be indistinguishable from a parked one with an extra button.
 */
export function reviewLocateAllowedCommands(stage: ReviewLocateStage): readonly CommandType[] {
  if (isReviewLocateTerminal(stage)) return [];
  if (isReviewLocatePark(stage)) {
    return ["REQUEST_STEP_RECHECK", "CANCEL_RUN", "FIND_CURRENT_STEP"];
  }
  // Automatic, non-terminal (opening / searching): momentary work. The seller can always cancel.
  return ["CANCEL_RUN", "FIND_CURRENT_STEP"];
}
