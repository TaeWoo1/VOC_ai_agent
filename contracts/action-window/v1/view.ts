// The authoritative sanitized FE View Model for one Action Window run, plus its
// validation rules and revision-apply semantics.

import {
  BlockerCode,
  CommandType,
  ExecutionMode,
  isBlockerCode,
  isCommandType,
  isExecutionMode,
  isRunStatus,
  isStepStatus,
  isTerminalRunStatus,
  RunStatus,
  StepStatus,
} from "./enums";
import { isCompatibleProtocolVersion } from "./protocol";
import { findForbiddenFields } from "./privacy";
import {
  assertNever,
  fail,
  isBoolean,
  isNonEmptyString,
  isNonNegativeInteger,
  isPositiveInteger,
  isRecord,
  ok,
  type ParseResult,
  type ValidationIssue,
} from "./result";

export type ActionWindowStepView = {
  stepId: string;
  /** 1-based. */
  stepNumber: number;
  totalSteps: number;
  title: string;
  instruction?: string;
  status: StepStatus;
};

export type ActionWindowBlockerView = {
  code: BlockerCode;
  recoverable: boolean;
  message?: string;
};

export type ActionWindowProgress = {
  completedSteps: number;
  totalSteps: number;
};

export type ActionWindowRunView = {
  protocolVersion: string;
  runId: string;
  revision: number;

  channel: string;
  title: string;

  status: RunStatus;
  executionMode: ExecutionMode;

  currentStep?: ActionWindowStepView;

  guidanceEnabled: boolean;
  /** The only source of truth for which command controls the FE may render. */
  allowedCommands: CommandType[];

  blocker?: ActionWindowBlockerView;

  progress: ActionWindowProgress;
};

/** Statuses in which a blocker may legitimately be present. */
const BLOCKER_ALLOWED_STATUSES: readonly RunStatus[] = [
  RunStatus.RUNNING,
  RunStatus.WAITING_FOR_HUMAN,
  RunStatus.PAUSED,
  RunStatus.FAILED,
];

function validateStep(
  step: unknown,
  progressTotal: number | undefined,
  issues: ValidationIssue[],
): void {
  if (!isRecord(step)) {
    issues.push({ path: "currentStep", message: "currentStep must be an object" });
    return;
  }
  if (!isNonEmptyString(step["stepId"])) {
    issues.push({ path: "currentStep.stepId", message: "stepId must be a non-empty string" });
  }
  const stepNumber = step["stepNumber"];
  if (!isPositiveInteger(stepNumber)) {
    issues.push({ path: "currentStep.stepNumber", message: "stepNumber must be a 1-based positive integer" });
  }
  const stepTotal = step["totalSteps"];
  if (!isPositiveInteger(stepTotal)) {
    issues.push({ path: "currentStep.totalSteps", message: "totalSteps must be a positive integer" });
  }
  if (isPositiveInteger(stepNumber) && isPositiveInteger(stepTotal) && stepNumber > stepTotal) {
    issues.push({ path: "currentStep.stepNumber", message: "stepNumber must not exceed totalSteps" });
  }
  if (isPositiveInteger(stepTotal) && progressTotal !== undefined && stepTotal !== progressTotal) {
    issues.push({ path: "currentStep.totalSteps", message: "currentStep.totalSteps must equal progress.totalSteps" });
  }
  if (!isNonEmptyString(step["title"])) {
    issues.push({ path: "currentStep.title", message: "title must be a non-empty string" });
  }
  if (step["instruction"] !== undefined && typeof step["instruction"] !== "string") {
    issues.push({ path: "currentStep.instruction", message: "instruction must be a string when present" });
  }
  if (!isStepStatus(step["status"])) {
    issues.push({ path: "currentStep.status", message: "unknown step status" });
  }
}

function validateBlocker(blocker: unknown, status: RunStatus, issues: ValidationIssue[]): void {
  if (!isRecord(blocker)) {
    issues.push({ path: "blocker", message: "blocker must be an object" });
    return;
  }
  if (!isBlockerCode(blocker["code"])) {
    issues.push({ path: "blocker.code", message: "unknown blocker code" });
  }
  if (!isBoolean(blocker["recoverable"])) {
    issues.push({ path: "blocker.recoverable", message: "recoverable must be a boolean" });
  }
  if (blocker["message"] !== undefined && typeof blocker["message"] !== "string") {
    issues.push({ path: "blocker.message", message: "message must be a string when present" });
  }
  if (!(BLOCKER_ALLOWED_STATUSES as readonly string[]).includes(status)) {
    issues.push({
      path: "blocker",
      message: `a blocker is not consistent with status ${status}`,
    });
  }
}

/** Validate an untrusted run view. Unknown enum / version fail closed. */
export function validateRunView(input: unknown): ParseResult<ActionWindowRunView> {
  const issues: ValidationIssue[] = [];
  if (!isRecord(input)) {
    return fail([{ path: "(root)", message: "run view must be an object" }]);
  }

  const protocolVersion = input["protocolVersion"];
  if (typeof protocolVersion !== "string" || !isCompatibleProtocolVersion(protocolVersion)) {
    issues.push({ path: "protocolVersion", message: "missing or unsupported protocol version" });
  }
  if (!isNonEmptyString(input["runId"])) {
    issues.push({ path: "runId", message: "runId must be a non-empty string" });
  }
  if (!isNonNegativeInteger(input["revision"])) {
    issues.push({ path: "revision", message: "revision must be a non-negative integer" });
  }
  if (!isNonEmptyString(input["channel"])) {
    issues.push({ path: "channel", message: "channel must be a non-empty string" });
  }
  if (!isNonEmptyString(input["title"])) {
    issues.push({ path: "title", message: "title must be a non-empty string" });
  }

  const status = input["status"];
  const statusValid = isRunStatus(status);
  if (!statusValid) {
    issues.push({ path: "status", message: "unknown run status" });
  }
  if (!isExecutionMode(input["executionMode"])) {
    issues.push({ path: "executionMode", message: "unknown execution mode" });
  }
  if (!isBoolean(input["guidanceEnabled"])) {
    issues.push({ path: "guidanceEnabled", message: "guidanceEnabled must be a boolean" });
  }

  // progress
  const progress = input["progress"];
  let progressTotal: number | undefined;
  if (!isRecord(progress)) {
    issues.push({ path: "progress", message: "progress must be an object" });
  } else {
    const completed = progress["completedSteps"];
    const total = progress["totalSteps"];
    if (!isNonNegativeInteger(completed)) {
      issues.push({ path: "progress.completedSteps", message: "completedSteps must be a non-negative integer" });
    }
    if (!isNonNegativeInteger(total)) {
      issues.push({ path: "progress.totalSteps", message: "totalSteps must be a non-negative integer" });
    }
    if (isNonNegativeInteger(completed) && isNonNegativeInteger(total)) {
      progressTotal = total;
      if (completed > total) {
        issues.push({ path: "progress.completedSteps", message: "completedSteps must not exceed totalSteps" });
      }
    }
  }

  // allowedCommands
  const allowed = input["allowedCommands"];
  if (!Array.isArray(allowed)) {
    issues.push({ path: "allowedCommands", message: "allowedCommands must be an array" });
  } else {
    for (let i = 0; i < allowed.length; i += 1) {
      if (!isCommandType(allowed[i])) {
        issues.push({ path: `allowedCommands[${i}]`, message: "unknown command type" });
      }
    }
    if (statusValid && isTerminalRunStatus(status) && allowed.length > 0) {
      issues.push({ path: "allowedCommands", message: "terminal states must expose no commands" });
    }
  }

  // currentStep (optional)
  if (input["currentStep"] !== undefined) {
    validateStep(input["currentStep"], progressTotal, issues);
  }

  // blocker (optional)
  if (input["blocker"] !== undefined) {
    if (statusValid) {
      validateBlocker(input["blocker"], status, issues);
    } else {
      issues.push({ path: "blocker", message: "blocker present with invalid status" });
    }
  }

  // privacy sweep across the whole view
  for (const p of findForbiddenFields(input)) {
    issues.push({ path: p, message: "forbidden (non-sanitized) field in run view" });
  }

  if (issues.length > 0) return fail(issues);
  return ok(input as ActionWindowRunView);
}

/**
 * Whether an incoming view should replace the current one. Never applies an
 * older revision over newer state, and never mixes run ids.
 */
export function shouldApplyRunView(
  current: ActionWindowRunView | undefined,
  incoming: ActionWindowRunView,
): boolean {
  if (current === undefined) return true;
  if (current.runId !== incoming.runId) return false;
  return incoming.revision > current.revision;
}

/**
 * Reference set of commands appropriate to a status. Runtime remains the
 * authority on `allowedCommands`; this backs fixtures and offers a default.
 */
export function defaultAllowedCommands(status: RunStatus): CommandType[] {
  switch (status) {
    case RunStatus.IDLE:
      return [CommandType.START_RUN, CommandType.SET_GUIDANCE_ENABLED];
    case RunStatus.PREPARING:
      return [CommandType.CANCEL_RUN, CommandType.SET_GUIDANCE_ENABLED];
    case RunStatus.RUNNING:
      return [
        CommandType.PAUSE_RUN,
        CommandType.CANCEL_RUN,
        CommandType.FIND_CURRENT_STEP,
        CommandType.SWITCH_TO_MANUAL,
        CommandType.SET_GUIDANCE_ENABLED,
        CommandType.REQUEST_STEP_RECHECK,
      ];
    case RunStatus.WAITING_FOR_HUMAN:
      return [
        CommandType.REQUEST_STEP_RECHECK,
        CommandType.FIND_CURRENT_STEP,
        CommandType.PAUSE_RUN,
        CommandType.CANCEL_RUN,
        CommandType.SWITCH_TO_MANUAL,
        CommandType.SET_GUIDANCE_ENABLED,
      ];
    case RunStatus.PAUSED:
      return [CommandType.RESUME_RUN, CommandType.CANCEL_RUN, CommandType.SET_GUIDANCE_ENABLED];
    case RunStatus.PROCESSING:
      return [CommandType.CANCEL_RUN, CommandType.FIND_CURRENT_STEP];
    case RunStatus.COMPLETED:
    case RunStatus.FAILED:
    case RunStatus.CANCELLED:
      return [];
    default:
      return assertNever(status);
  }
}
