/**
 * **Range-discovery stages & v2 contract mapping (ISOLATED).**
 *
 * The state machine for the run that comes BEFORE the plan: it establishes how far back the marketplace
 * currently lets this seller reach, so the monthly segments are planned from what actually exists.
 *
 * Separate from `import-stages.ts` for the reason every runtime in this tree is separate from its siblings:
 * the segment machine is live-proven and is not edited to accommodate a second choreography. They share what
 * is genuinely shared — the two date targets, and the guidance-copy discipline — and nothing else.
 *
 * ## The step plan is FIVE steps, always, and two of them are usually skipped
 *
 * Discovery has two shapes and only learns which one it is mid-run:
 *
 *  - the controls declare `min`/`max` bounds → SellerOps reads the range itself (`MACHINE_DISCOVERED`) and
 *    the seller touches nothing;
 *  - they do not → the seller is guided to select the earliest and latest dates the picker offers, and their
 *    selection is the evidence (`OPERATOR_CONFIRMED`).
 *
 * Publishing four steps in the first case and six in the second would move `totalSteps` under the frontend
 * the moment the bounds read answers — a progress line that jumps from "4단계 중 2" to "6단계 중 3" for the
 * same work. So both barriers always occupy a slot and are reported `SKIPPED` when unused, exactly as
 * `CONFIRM_RANGE` is in the segment plan.
 *
 * Pure: no I/O, no browser, no time source.
 */
import type { CommandType, CopyParams, ExecutionMode, RunStatus, StepStatus } from "../../../../contracts/action-window/v2/index";

export type DiscoveryStage =
  /** Automatic: confirm the seller is on a usable review-management surface. Never navigated for them. */
  | "PREPARE_SESSION"
  /** Automatic: read what the range controls declare as reachable. */
  | "READ_BOUNDS"
  | "LOCATE_EARLIEST"
  | "HIGHLIGHT_EARLIEST"
  /** Seller barrier, reached ONLY when the bounds were unreadable: they pick the earliest offered date. */
  | "WAIT_FOR_EARLIEST"
  | "LOCATE_LATEST"
  | "HIGHLIGHT_LATEST"
  /** Seller barrier, same condition: they pick the latest offered date. */
  | "WAIT_FOR_LATEST"
  /** Automatic: read back what they selected. */
  | "READ_SELECTED"
  /** Automatic: report the range, which creates the plan server-side and spends the ticket. */
  | "REPORT_RANGE"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "PAUSED";

export const DISCOVERY_TERMINAL_STAGES: readonly DiscoveryStage[] = ["COMPLETED", "FAILED", "CANCELLED"];

export const DISCOVERY_BARRIER_STAGES: readonly DiscoveryStage[] = ["WAIT_FOR_EARLIEST", "WAIT_FOR_LATEST"];

export function isDiscoveryBarrier(stage: DiscoveryStage): boolean {
  return DISCOVERY_BARRIER_STAGES.includes(stage);
}

/* ────────────────────────────── the step plan ────────────────────────────── */

export interface DiscoveryStepMeta {
  stepNumber: number;
  stepId: string;
  copyKey: string;
  mode: ExecutionMode;
  copyParams?: CopyParams;
}

/**
 * The fixed five-step plan. Fixed at construction rather than derived from surface facts: unlike a segment
 * run — where whether an apply control exists genuinely changes what the seller must do — nothing a
 * discovery run can read changes its shape. Only whether steps 3 and 4 are performed or skipped.
 *
 * `copyKey`s are dotted semantic keys; every word the seller reads is decided by the frontend (contract §6).
 */
export const DISCOVERY_STEP_PLAN: readonly DiscoveryStepMeta[] = [
  {
    stepNumber: 1,
    stepId: "aw.import_discovery_open_review_surface",
    copyKey: "actionWindow.importDiscovery.openReviewSurface",
    mode: "AUTOMATIC_OPERATION",
  },
  {
    stepNumber: 2,
    stepId: "aw.import_discovery_read_bounds",
    copyKey: "actionWindow.importDiscovery.readBounds",
    mode: "AUTOMATIC_OPERATION",
  },
  {
    stepNumber: 3,
    stepId: "aw.import_discovery_set_earliest",
    copyKey: "actionWindow.importDiscovery.setEarliest",
    mode: "ACTION_WINDOW",
    copyParams: { targetKind: "start_date" },
  },
  {
    stepNumber: 4,
    stepId: "aw.import_discovery_set_latest",
    copyKey: "actionWindow.importDiscovery.setLatest",
    mode: "ACTION_WINDOW",
    copyParams: { targetKind: "end_date" },
  },
  {
    stepNumber: 5,
    stepId: "aw.import_discovery_report",
    copyKey: "actionWindow.importDiscovery.report",
    mode: "AUTOMATIC_OPERATION",
  },
];

export const DISCOVERY_TOTAL_STEPS = DISCOVERY_STEP_PLAN.length;

/** Step metadata at a 1-based index, clamped so a terminal view never reads past the plan. */
export function discoveryStepMetaAt(stepNumber: number): DiscoveryStepMeta {
  const index = Math.min(Math.max(stepNumber, 1), DISCOVERY_TOTAL_STEPS) - 1;
  const meta = DISCOVERY_STEP_PLAN[index];
  if (!meta) throw new Error("discovery-stages: empty step plan");
  return meta;
}

/* ────────────────────────────── v2 enum mapping ────────────────────────────── */

export function discoveryStageToRunStatus(stage: DiscoveryStage): RunStatus {
  switch (stage) {
    case "PREPARE_SESSION":
    case "READ_BOUNDS":
      return "PREPARING";
    case "LOCATE_EARLIEST":
    case "HIGHLIGHT_EARLIEST":
    case "LOCATE_LATEST":
    case "HIGHLIGHT_LATEST":
    case "READ_SELECTED":
      return "RUNNING";
    case "WAIT_FOR_EARLIEST":
    case "WAIT_FOR_LATEST":
      return "WAITING_FOR_HUMAN";
    case "REPORT_RANGE":
      return "PROCESSING";
    case "COMPLETED":
      return "COMPLETED";
    case "FAILED":
      return "FAILED";
    case "CANCELLED":
      return "CANCELLED";
    case "PAUSED":
      return "PAUSED";
  }
}

export function discoveryStageToStepStatus(stage: DiscoveryStage): StepStatus {
  switch (stage) {
    case "PREPARE_SESSION":
      return "PREPARING";
    case "READ_BOUNDS":
    case "READ_SELECTED":
      return "OBSERVING";
    case "LOCATE_EARLIEST":
    case "LOCATE_LATEST":
      return "PENDING";
    case "HIGHLIGHT_EARLIEST":
    case "HIGHLIGHT_LATEST":
      return "READY";
    case "WAIT_FOR_EARLIEST":
    case "WAIT_FOR_LATEST":
      return "AWAITING_USER";
    case "REPORT_RANGE":
      return "PROCESSING";
    case "COMPLETED":
      return "COMPLETED";
    case "FAILED":
      return "FAILED";
    case "CANCELLED":
    case "PAUSED":
      return "PENDING";
  }
}

/**
 * Which commands the frontend may render, per stage.
 *
 * Same rule as the segment run: `REQUEST_STEP_RECHECK` means "I picked it, look again" and never completes a
 * step on the client — the runtime alone decides, by observing. And there is deliberately no command that
 * sets a date, applies a range, or creates a plan without the seller having acted.
 */
export function discoveryAllowedCommands(stage: DiscoveryStage): readonly CommandType[] {
  if (DISCOVERY_TERMINAL_STAGES.includes(stage)) return [];
  if (stage === "PAUSED") return ["RESUME_RUN", "CANCEL_RUN"];
  if (isDiscoveryBarrier(stage)) {
    return [
      "REQUEST_STEP_RECHECK",
      "PAUSE_RUN",
      "CANCEL_RUN",
      // The manual path — pick the period yourself — stays available by product rule, not by convenience.
      "SWITCH_TO_MANUAL",
      "SET_GUIDANCE_ENABLED",
      "FIND_CURRENT_STEP",
    ];
  }
  return ["PAUSE_RUN", "CANCEL_RUN", "SWITCH_TO_MANUAL", "SET_GUIDANCE_ENABLED", "FIND_CURRENT_STEP"];
}
