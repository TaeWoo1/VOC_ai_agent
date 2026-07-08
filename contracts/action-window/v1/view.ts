// The authoritative sanitized FE View Model for one Action Window run, plus its
// validation rules and revision-apply semantics.
//
// Copy ownership: Runtime supplies semantic identifiers (channelCode /
// operationCode / stepCode / copy keys) and sanitized primitive interpolation
// params — NEVER final end-user prose. FE maps copy keys to localized product
// copy, button labels, tone, icons, and derives blocker wording from BlockerCode.

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
  fail,
  isBoolean,
  isCopyKey,
  isCopyParamValue,
  isNonEmptyString,
  isNonNegativeInteger,
  isPositiveInteger,
  isRecord,
  isSemanticCode,
  ok,
  rejectUnknownKeys,
  type ParseResult,
  type ValidationIssue,
} from "./result";

/** Primitive, interpolation-safe copy parameter value. */
export type CopyParamValue = string | number | boolean;
export type CopyParams = Record<string, CopyParamValue>;

export type ActionWindowStepView = {
  stepId: string;
  /** 1-based. */
  stepNumber: number;
  totalSteps: number;
  /** Semantic step identity (opaque code, not a title). */
  stepCode: string;
  /** Semantic copy key FE maps to localized step copy. */
  copyKey: string;
  copyParams?: CopyParams;
  status: StepStatus;
};

/** Runtime supplies only the code + recoverability; FE owns all blocker wording. */
export type ActionWindowBlockerView = {
  code: BlockerCode;
  recoverable: boolean;
};

export type ActionWindowProgress = {
  completedSteps: number;
  totalSteps: number;
};

export type ActionWindowRunView = {
  protocolVersion: string;
  runId: string;
  revision: number;

  /** Sanitized stable channel identity (e.g. `esm`), not a user-facing title. */
  channelCode: string;
  /** Sanitized stable operation identity (e.g. `review_export`). */
  operationCode: string;

  /** Semantic copy key for the run headline; FE localizes it. */
  runCopyKey: string;
  runCopyParams?: CopyParams;

  status: RunStatus;
  executionMode: ExecutionMode;

  currentStep?: ActionWindowStepView;

  guidanceEnabled: boolean;
  /** The only source of truth for which command controls the FE may render. */
  allowedCommands: CommandType[];

  blocker?: ActionWindowBlockerView;

  progress: ActionWindowProgress;
};

const RUN_VIEW_KEYS: readonly string[] = [
  "protocolVersion",
  "runId",
  "revision",
  "channelCode",
  "operationCode",
  "runCopyKey",
  "runCopyParams",
  "status",
  "executionMode",
  "currentStep",
  "guidanceEnabled",
  "allowedCommands",
  "blocker",
  "progress",
];
const STEP_KEYS: readonly string[] = [
  "stepId",
  "stepNumber",
  "totalSteps",
  "stepCode",
  "copyKey",
  "copyParams",
  "status",
];
const BLOCKER_KEYS: readonly string[] = ["code", "recoverable"];
const PROGRESS_KEYS: readonly string[] = ["completedSteps", "totalSteps"];

/** Statuses in which a blocker may legitimately be present. */
const BLOCKER_ALLOWED_STATUSES: readonly RunStatus[] = [
  RunStatus.RUNNING,
  RunStatus.WAITING_FOR_HUMAN,
  RunStatus.PAUSED,
  RunStatus.FAILED,
];

function validateCopyParams(params: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(params)) {
    issues.push({ path, message: "copy params must be an object of primitive values" });
    return;
  }
  for (const [key, value] of Object.entries(params)) {
    if (!isCopyParamValue(value)) {
      issues.push({ path: `${path}.${key}`, message: "copy param must be a primitive (string | number | boolean)" });
    }
  }
}

function validateStep(
  step: unknown,
  progressTotal: number | undefined,
  issues: ValidationIssue[],
): void {
  if (!isRecord(step)) {
    issues.push({ path: "currentStep", message: "currentStep must be an object" });
    return;
  }
  rejectUnknownKeys(step, STEP_KEYS, "currentStep", issues);
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
  if (!isSemanticCode(step["stepCode"])) {
    issues.push({ path: "currentStep.stepCode", message: "stepCode must be a sanitized semantic code, not prose" });
  }
  if (!isCopyKey(step["copyKey"])) {
    issues.push({ path: "currentStep.copyKey", message: "copyKey must be a dotted semantic key, not prose" });
  }
  if (step["copyParams"] !== undefined) {
    validateCopyParams(step["copyParams"], "currentStep.copyParams", issues);
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
  rejectUnknownKeys(blocker, BLOCKER_KEYS, "blocker", issues);
  if (!isBlockerCode(blocker["code"])) {
    issues.push({ path: "blocker.code", message: "unknown blocker code" });
  }
  if (!isBoolean(blocker["recoverable"])) {
    issues.push({ path: "blocker.recoverable", message: "recoverable must be a boolean" });
  }
  if (!(BLOCKER_ALLOWED_STATUSES as readonly string[]).includes(status)) {
    issues.push({ path: "blocker", message: `a blocker is not consistent with status ${status}` });
  }
}

/** Validate an untrusted run view. Unknown enum / version / field fail closed. */
export function validateRunView(input: unknown): ParseResult<ActionWindowRunView> {
  const issues: ValidationIssue[] = [];
  if (!isRecord(input)) {
    return fail([{ path: "(root)", message: "run view must be an object" }]);
  }

  rejectUnknownKeys(input, RUN_VIEW_KEYS, "", issues);

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
  if (!isSemanticCode(input["channelCode"])) {
    issues.push({ path: "channelCode", message: "channelCode must be a sanitized semantic code, not a title" });
  }
  if (!isSemanticCode(input["operationCode"])) {
    issues.push({ path: "operationCode", message: "operationCode must be a sanitized semantic code, not a title" });
  }
  if (!isCopyKey(input["runCopyKey"])) {
    issues.push({ path: "runCopyKey", message: "runCopyKey must be a dotted semantic key, not prose" });
  }
  if (input["runCopyParams"] !== undefined) {
    validateCopyParams(input["runCopyParams"], "runCopyParams", issues);
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
    rejectUnknownKeys(progress, PROGRESS_KEYS, "progress", issues);
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

  // privacy sweep across the whole view (URLs, HTML, paths, forbidden keys)
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
      return assertNeverStatus(status);
  }
}

function assertNeverStatus(x: never): never {
  throw new Error(`Unexpected run status: ${String(x)}`);
}
