// Action Window enumerations. Const-object pattern (not TS `enum`) so the sets are
// runtime-iterable for validation and safe under `isolatedModules`.

// ---------------------------------------------------------------------------
// RunStatus — the authoritative lifecycle state of one Operation Run.
// ---------------------------------------------------------------------------
export const RunStatus = {
  IDLE: "IDLE",
  PREPARING: "PREPARING",
  RUNNING: "RUNNING",
  WAITING_FOR_HUMAN: "WAITING_FOR_HUMAN",
  PAUSED: "PAUSED",
  PROCESSING: "PROCESSING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
} as const;
export type RunStatus = (typeof RunStatus)[keyof typeof RunStatus];
export const RUN_STATUS_VALUES: readonly RunStatus[] = Object.values(RunStatus);
export function isRunStatus(v: unknown): v is RunStatus {
  return typeof v === "string" && (RUN_STATUS_VALUES as readonly string[]).includes(v);
}
export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = [
  RunStatus.COMPLETED,
  RunStatus.FAILED,
  RunStatus.CANCELLED,
];
export function isTerminalRunStatus(s: RunStatus): boolean {
  return (TERMINAL_RUN_STATUSES as readonly string[]).includes(s);
}

// ---------------------------------------------------------------------------
// StepStatus — the state of the current semantic step.
// ---------------------------------------------------------------------------
export const StepStatus = {
  PENDING: "PENDING",
  PREPARING: "PREPARING",
  READY: "READY",
  AWAITING_USER: "AWAITING_USER",
  OBSERVING: "OBSERVING",
  PROCESSING: "PROCESSING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  SKIPPED: "SKIPPED",
} as const;
export type StepStatus = (typeof StepStatus)[keyof typeof StepStatus];
export const STEP_STATUS_VALUES: readonly StepStatus[] = Object.values(StepStatus);
export function isStepStatus(v: unknown): v is StepStatus {
  return typeof v === "string" && (STEP_STATUS_VALUES as readonly string[]).includes(v);
}
export const TERMINAL_STEP_STATUSES: readonly StepStatus[] = [
  StepStatus.COMPLETED,
  StepStatus.FAILED,
  StepStatus.SKIPPED,
];

// ---------------------------------------------------------------------------
// ExecutionMode — how a channel×datatype×operation is executed. Names are kept
// consistent with the canonical product documents (product-scope-v1 §1.4):
//   AUTOMATIC_OPERATION — SellerOps performs the operation automatically.
//   ACTION_WINDOW       — user directly acts on the real page; SellerOps guides + automates downstream.
//   FILE_IMPORT         — user provides an exported file; SellerOps imports it.
//   INTEGRATION_PENDING — unavailable / not yet integrated for this channel.
// ---------------------------------------------------------------------------
export const ExecutionMode = {
  AUTOMATIC_OPERATION: "AUTOMATIC_OPERATION",
  ACTION_WINDOW: "ACTION_WINDOW",
  FILE_IMPORT: "FILE_IMPORT",
  INTEGRATION_PENDING: "INTEGRATION_PENDING",
} as const;
export type ExecutionMode = (typeof ExecutionMode)[keyof typeof ExecutionMode];
export const EXECUTION_MODE_VALUES: readonly ExecutionMode[] = Object.values(ExecutionMode);
export function isExecutionMode(v: unknown): v is ExecutionMode {
  return typeof v === "string" && (EXECUTION_MODE_VALUES as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// BlockerCode — why a run cannot currently proceed without help.
// ---------------------------------------------------------------------------
export const BlockerCode = {
  LOGIN_REQUIRED: "LOGIN_REQUIRED",
  UI_DRIFT: "UI_DRIFT",
  TARGET_NOT_FOUND: "TARGET_NOT_FOUND",
  TARGET_AMBIGUOUS: "TARGET_AMBIGUOUS",
  SESSION_EXPIRED: "SESSION_EXPIRED",
  UNSUPPORTED_STATE: "UNSUPPORTED_STATE",
  DOWNLOAD_TIMEOUT: "DOWNLOAD_TIMEOUT",
  ARTIFACT_INVALID: "ARTIFACT_INVALID",
} as const;
export type BlockerCode = (typeof BlockerCode)[keyof typeof BlockerCode];
export const BLOCKER_CODE_VALUES: readonly BlockerCode[] = Object.values(BlockerCode);
export function isBlockerCode(v: unknown): v is BlockerCode {
  return typeof v === "string" && (BLOCKER_CODE_VALUES as readonly string[]).includes(v);
}
/**
 * Reference default for whether a blocker is recoverable. The authoritative value
 * always travels on `ActionWindowRunView.blocker.recoverable`, decided by Runtime;
 * this default only backs fixtures and offers a sane fallback.
 */
const NON_RECOVERABLE_BLOCKERS: readonly BlockerCode[] = [
  BlockerCode.UNSUPPORTED_STATE,
  BlockerCode.ARTIFACT_INVALID,
];
export function defaultBlockerRecoverable(code: BlockerCode): boolean {
  return !(NON_RECOVERABLE_BLOCKERS as readonly string[]).includes(code);
}

// ---------------------------------------------------------------------------
// CommandType — user/UI intents sent to Runtime. NOTE: there is deliberately no
// CONFIRM_STEP_COMPLETED. The UI can only *report* an action or *request* a
// recheck; Runtime alone verifies an observation and marks a step complete.
// ---------------------------------------------------------------------------
export const CommandType = {
  START_RUN: "START_RUN",
  PAUSE_RUN: "PAUSE_RUN",
  RESUME_RUN: "RESUME_RUN",
  CANCEL_RUN: "CANCEL_RUN",
  FIND_CURRENT_STEP: "FIND_CURRENT_STEP",
  SWITCH_TO_MANUAL: "SWITCH_TO_MANUAL",
  SET_GUIDANCE_ENABLED: "SET_GUIDANCE_ENABLED",
  REQUEST_STEP_RECHECK: "REQUEST_STEP_RECHECK",
} as const;
export type CommandType = (typeof CommandType)[keyof typeof CommandType];
export const COMMAND_TYPE_VALUES: readonly CommandType[] = Object.values(CommandType);
export function isCommandType(v: unknown): v is CommandType {
  return typeof v === "string" && (COMMAND_TYPE_VALUES as readonly string[]).includes(v);
}
/**
 * Commands that mark a step complete: NONE. Step completion is expressible only
 * through the Runtime-emitted `EventType.STEP_COMPLETED`. `REQUEST_STEP_RECHECK`
 * merely asks Runtime to observe; it never completes a step.
 */
export const COMMANDS_THAT_COMPLETE_STEPS: readonly CommandType[] = [];
export function commandMarksStepComplete(type: CommandType): boolean {
  return (COMMANDS_THAT_COMPLETE_STEPS as readonly string[]).includes(type);
}

// ---------------------------------------------------------------------------
// EventType — facts emitted by Runtime. Events describe what happened; they are
// NOT domain states (RunStatus/StepStatus carry state).
// ---------------------------------------------------------------------------
export const EventType = {
  RUN_STARTED: "RUN_STARTED",
  STEP_READY: "STEP_READY",
  HUMAN_ACTION_REQUIRED: "HUMAN_ACTION_REQUIRED",
  TARGET_HIGHLIGHTED: "TARGET_HIGHLIGHTED",
  USER_ACTION_OBSERVED: "USER_ACTION_OBSERVED",
  DOWNLOAD_DETECTED: "DOWNLOAD_DETECTED",
  STEP_COMPLETED: "STEP_COMPLETED",
  RUN_COMPLETED: "RUN_COMPLETED",
  RUN_FAILED: "RUN_FAILED",
  RUN_PAUSED: "RUN_PAUSED",
  RUN_RESUMED: "RUN_RESUMED",
  BLOCKER_CHANGED: "BLOCKER_CHANGED",
} as const;
export type EventType = (typeof EventType)[keyof typeof EventType];
export const EVENT_TYPE_VALUES: readonly EventType[] = Object.values(EventType);
export function isEventType(v: unknown): v is EventType {
  return typeof v === "string" && (EVENT_TYPE_VALUES as readonly string[]).includes(v);
}
/** The only fact that completes a step — Runtime authority, never a command. */
export const STEP_COMPLETION_EVENT: EventType = EventType.STEP_COMPLETED;
