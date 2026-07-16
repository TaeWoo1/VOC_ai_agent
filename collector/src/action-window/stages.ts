/**
 * **Action Window Runtime — internal stages & contract mapping (R1, channel-neutral).**
 *
 * These stages are the Runtime's *internal* state machine. They are NOT part of the normative
 * Action Window contract (`contracts/action-window/v1`). This module is the ONLY place that maps
 * internal stages onto the contract's `RunStatus` / `StepStatus` / step plan, so the rest of the
 * engine never re-derives contract enums ad hoc.
 *
 * Pure: no I/O, no browser, no time source.
 */
import type {
  RunStatus,
  StepStatus,
  ExecutionMode,
  CommandType,
  CopyParams,
} from "../../../contracts/action-window/v1/index";

export type Stage =
  | "PREPARE_SESSION"
  | "OPEN_TARGET_SURFACE"
  | "LOCATE_TARGET"
  | "HIGHLIGHT_TARGET"
  | "WAIT_FOR_USER_ACTION"
  | "VERIFY_TRANSITION"
  | "DETECT_DOWNLOAD"
  | "VALIDATE_ARTIFACT"
  | "INGEST_HANDOFF"
  | "AWAIT_SESSION_RECOVERY"
  | "COMPLETE"
  | "FAILED"
  | "CANCELLED"
  | "PAUSED";

export const TERMINAL_STAGES: readonly Stage[] = ["COMPLETE", "FAILED", "CANCELLED"];

/**
 * The fixed step plan. Step 2 is the single human-action (ACTION_WINDOW) step. Step 3 is the
 * automatic downstream chain (detect download → validate artifact → ingest handoff) — one
 * seller-visible step spanning three internal stages, mirroring how steps 1–2 span their stages.
 * Copy ownership: Runtime carries dotted semantic `copyKey`s + sanitized primitive `copyParams`
 * ONLY — never final user prose. FE maps these keys to localized copy.
 */
export interface StepMeta {
  stepNumber: number;
  stepId: string;
  copyKey: string;
  mode: ExecutionMode;
  copyParams?: CopyParams;
}
export const STEP_PLAN: readonly StepMeta[] = [
  { stepNumber: 1, stepId: "aw.prepare_surface", copyKey: "actionWindow.step.prepareSurface", mode: "AUTOMATIC_OPERATION" },
  { stepNumber: 2, stepId: "aw.user_target_action", copyKey: "actionWindow.step.userTargetAction", mode: "ACTION_WINDOW", copyParams: { targetKind: "primary_action" } },
  { stepNumber: 3, stepId: "aw.downstream", copyKey: "actionWindow.step.downstream", mode: "AUTOMATIC_OPERATION" },
];
export const TOTAL_STEPS = STEP_PLAN.length;

export function stepMetaByIndex(stepIndex: number): StepMeta {
  const meta = STEP_PLAN[stepIndex - 1];
  if (!meta) throw new Error(`invalid stepIndex ${stepIndex}`);
  return meta;
}

/**
 * Which 1-based step a stage belongs to.
 *
 * ⚠ This switch has a `default`, so a new stage does NOT break the build here — unlike
 * `stageToRunStatus` / `stageToStepStatus` / `allowedCommands`, which are exhaustive. Add new stages
 * explicitly. The view does not read this (it uses the engine's `activeStepIndex`); it exists for
 * coherence checks, so a wrong answer here is silent.
 */
export function stageStepIndex(stage: Stage): number {
  switch (stage) {
    case "PREPARE_SESSION":
    case "OPEN_TARGET_SURFACE":
    case "AWAIT_SESSION_RECOVERY":
      return 1;
    case "LOCATE_TARGET":
    case "HIGHLIGHT_TARGET":
    case "WAIT_FOR_USER_ACTION":
    case "VERIFY_TRANSITION":
      return 2;
    case "DETECT_DOWNLOAD":
    case "VALIDATE_ARTIFACT":
    case "INGEST_HANDOFF":
    case "COMPLETE":
      return 3;
    default:
      return 2; // FAILED / CANCELLED / PAUSED resolve against the stored active step
  }
}

export function stageToRunStatus(stage: Stage): RunStatus {
  switch (stage) {
    case "PREPARE_SESSION":
      return "PREPARING";
    case "OPEN_TARGET_SURFACE":
    case "LOCATE_TARGET":
    case "HIGHLIGHT_TARGET":
    case "VERIFY_TRANSITION":
      return "RUNNING";
    case "WAIT_FOR_USER_ACTION":
    // A recovery park waits on the same person, for a different reason: the seller must restore their
    // own session before the run can continue. Non-terminal — the run is alive, nothing failed.
    case "AWAIT_SESSION_RECOVERY":
      return "WAITING_FOR_HUMAN";
    case "DETECT_DOWNLOAD":
    case "VALIDATE_ARTIFACT":
    case "INGEST_HANDOFF":
      return "PROCESSING";
    case "COMPLETE":
      return "COMPLETED";
    case "FAILED":
      return "FAILED";
    case "CANCELLED":
      return "CANCELLED";
    case "PAUSED":
      return "PAUSED";
  }
}

export function stageToStepStatus(stage: Stage): StepStatus {
  switch (stage) {
    case "PREPARE_SESSION":
      return "PREPARING";
    case "OPEN_TARGET_SURFACE":
      return "PROCESSING";
    case "LOCATE_TARGET":
      return "PREPARING";
    case "HIGHLIGHT_TARGET":
      return "READY";
    case "WAIT_FOR_USER_ACTION":
    case "AWAIT_SESSION_RECOVERY":
      return "AWAITING_USER";
    case "VERIFY_TRANSITION":
      return "OBSERVING";
    case "DETECT_DOWNLOAD":
    case "VALIDATE_ARTIFACT":
    case "INGEST_HANDOFF":
      return "PROCESSING";
    case "COMPLETE":
      return "COMPLETED";
    case "FAILED":
      return "FAILED";
    case "CANCELLED":
      return "SKIPPED";
    case "PAUSED":
      return "PENDING"; // overridden by the resume stage when projecting a paused view
  }
}

/** Commands accepted in a given stage. Terminal stages accept nothing. */
export function allowedCommands(stage: Stage): CommandType[] {
  switch (stage) {
    case "PREPARE_SESSION":
    case "OPEN_TARGET_SURFACE":
    case "LOCATE_TARGET":
    case "HIGHLIGHT_TARGET":
      return ["PAUSE_RUN", "CANCEL_RUN", "FIND_CURRENT_STEP", "SET_GUIDANCE_ENABLED"];
    case "WAIT_FOR_USER_ACTION":
      return ["REQUEST_STEP_RECHECK", "SET_GUIDANCE_ENABLED", "SWITCH_TO_MANUAL", "PAUSE_RUN", "CANCEL_RUN", "FIND_CURRENT_STEP"];
    case "VERIFY_TRANSITION":
    case "DETECT_DOWNLOAD":
    case "VALIDATE_ARTIFACT":
    case "INGEST_HANDOFF":
      return ["CANCEL_RUN", "FIND_CURRENT_STEP"];
    // Recovery park. Deliberately minimal, and the omissions are load-bearing:
    //  - No PAUSE_RUN. It sets `resumeStage = this.stage` (engine `PAUSE_RUN`), and this stage is
    //    handled by neither `resume()` (whose default returns NONE → the run strands) nor `view.ts`'s
    //    `effectiveStage` unwrap (which would render a PAUSED run as AWAITING_USER). Nothing else
    //    enforces that exclusion — this list IS the enforcement.
    //  - No SWITCH_TO_MANUAL: unconditionally rejected as UNSUPPORTED_MANUAL anyway.
    // REQUEST_STEP_RECHECK here means "I fixed my session, go look" → a fresh prepareSurface probe.
    case "AWAIT_SESSION_RECOVERY":
      return ["REQUEST_STEP_RECHECK", "CANCEL_RUN", "FIND_CURRENT_STEP"];
    case "PAUSED":
      return ["RESUME_RUN", "CANCEL_RUN", "FIND_CURRENT_STEP"];
    case "COMPLETE":
    case "FAILED":
    case "CANCELLED":
      return [];
  }
}
