// Contract-valid, sanitized scenario fixtures for the Action Window UI.
//
// The names below are FIXTURE / SCENARIO names for FE rendering — NOT protocol
// enum values. Each fixture is a real `ActionWindowRunView` built only from the
// contract's actual enums plus SEMANTIC CODES and COPY KEYS (never final prose),
// so FE-1 can render every state and localize the copy itself.

import type { ActionWindowCommand } from "./command";
import type { ActionWindowEvent } from "./event";
import {
  BlockerCode,
  CommandType,
  defaultBlockerRecoverable,
  EventType,
  ExecutionMode,
  RunStatus,
  StepStatus,
} from "./enums";
import { PROTOCOL_VERSION } from "./protocol";
import { defaultAllowedCommands, type ActionWindowRunView, type CopyParams } from "./view";

const TOTAL_STEPS = 5;
const RUN_ID = "run_esm_review_demo";
const CHANNEL_CODE = "esm";
const OPERATION_CODE = "review_export";
const RUN_COPY_KEY = "actionWindow.review.run";
const RUN_COPY_PARAMS: CopyParams = { marketplace: "gmarket" };

// Semantic step identity + copy key per semantic step (Runtime owns these; FE
// localizes the copy key). No user-facing prose lives in the contract.
const STEP_CODE: Record<number, string> = {
  1: "prepare",
  2: "open_export",
  3: "trigger_export",
  4: "await_download",
  5: "ingest",
};
const STEP_COPY_KEY: Record<number, string> = {
  1: "actionWindow.review.ready",
  2: "actionWindow.review.selectMarketplace",
  3: "actionWindow.review.triggerExport",
  4: "actionWindow.review.waitingForDownload",
  5: "actionWindow.review.processing",
};

function step(
  stepNumber: number,
  status: StepStatus,
  copyParams?: CopyParams,
): ActionWindowRunView["currentStep"] {
  return {
    stepId: `step_${stepNumber}`,
    stepNumber,
    totalSteps: TOTAL_STEPS,
    stepCode: STEP_CODE[stepNumber] ?? `step_${stepNumber}`,
    copyKey: STEP_COPY_KEY[stepNumber] ?? "actionWindow.review.processing",
    ...(copyParams !== undefined ? { copyParams } : {}),
    status,
  };
}

export type ScenarioName =
  | "ready-to-start"
  | "starting"
  | "human-action-required"
  | "waiting-for-user"
  | "observing"
  | "download-detected"
  | "processing"
  | "completed"
  | "paused"
  | "ui-drift"
  | "login-required"
  | "failed";

export const SCENARIO_NAMES: readonly ScenarioName[] = [
  "ready-to-start",
  "starting",
  "human-action-required",
  "waiting-for-user",
  "observing",
  "download-detected",
  "processing",
  "completed",
  "paused",
  "ui-drift",
  "login-required",
  "failed",
];

function base(revision: number, status: RunStatus): Pick<
  ActionWindowRunView,
  | "protocolVersion"
  | "runId"
  | "revision"
  | "channelCode"
  | "operationCode"
  | "runCopyKey"
  | "runCopyParams"
  | "status"
  | "executionMode"
  | "guidanceEnabled"
  | "allowedCommands"
> {
  return {
    protocolVersion: PROTOCOL_VERSION,
    runId: RUN_ID,
    revision,
    channelCode: CHANNEL_CODE,
    operationCode: OPERATION_CODE,
    runCopyKey: RUN_COPY_KEY,
    runCopyParams: RUN_COPY_PARAMS,
    status,
    executionMode: ExecutionMode.ACTION_WINDOW,
    guidanceEnabled: true,
    allowedCommands: defaultAllowedCommands(status),
  };
}

export const ACTION_WINDOW_SCENARIOS: Record<ScenarioName, ActionWindowRunView> = {
  "ready-to-start": {
    ...base(1, RunStatus.IDLE),
    currentStep: step(1, StepStatus.READY),
    progress: { completedSteps: 0, totalSteps: TOTAL_STEPS },
  },
  "starting": {
    ...base(2, RunStatus.PREPARING),
    currentStep: step(1, StepStatus.PREPARING),
    progress: { completedSteps: 0, totalSteps: TOTAL_STEPS },
  },
  "human-action-required": {
    ...base(3, RunStatus.WAITING_FOR_HUMAN),
    currentStep: step(3, StepStatus.AWAITING_USER, { marketplace: "gmarket" }),
    progress: { completedSteps: 2, totalSteps: TOTAL_STEPS },
  },
  "waiting-for-user": {
    ...base(4, RunStatus.WAITING_FOR_HUMAN),
    guidanceEnabled: false,
    currentStep: step(3, StepStatus.AWAITING_USER),
    progress: { completedSteps: 2, totalSteps: TOTAL_STEPS },
  },
  "observing": {
    ...base(5, RunStatus.RUNNING),
    currentStep: step(3, StepStatus.OBSERVING),
    progress: { completedSteps: 2, totalSteps: TOTAL_STEPS },
  },
  "download-detected": {
    ...base(6, RunStatus.RUNNING),
    currentStep: step(4, StepStatus.PROCESSING),
    progress: { completedSteps: 3, totalSteps: TOTAL_STEPS },
  },
  "processing": {
    ...base(7, RunStatus.PROCESSING),
    currentStep: step(5, StepStatus.PROCESSING),
    progress: { completedSteps: 4, totalSteps: TOTAL_STEPS },
  },
  "completed": {
    ...base(8, RunStatus.COMPLETED),
    progress: { completedSteps: TOTAL_STEPS, totalSteps: TOTAL_STEPS },
  },
  "paused": {
    ...base(9, RunStatus.PAUSED),
    currentStep: step(3, StepStatus.AWAITING_USER),
    progress: { completedSteps: 2, totalSteps: TOTAL_STEPS },
  },
  "ui-drift": {
    ...base(10, RunStatus.WAITING_FOR_HUMAN),
    currentStep: step(3, StepStatus.AWAITING_USER),
    blocker: {
      code: BlockerCode.UI_DRIFT,
      recoverable: defaultBlockerRecoverable(BlockerCode.UI_DRIFT),
    },
    progress: { completedSteps: 2, totalSteps: TOTAL_STEPS },
  },
  "login-required": {
    ...base(11, RunStatus.WAITING_FOR_HUMAN),
    currentStep: step(1, StepStatus.AWAITING_USER),
    blocker: {
      code: BlockerCode.LOGIN_REQUIRED,
      recoverable: defaultBlockerRecoverable(BlockerCode.LOGIN_REQUIRED),
    },
    progress: { completedSteps: 0, totalSteps: TOTAL_STEPS },
  },
  "failed": {
    ...base(12, RunStatus.FAILED),
    currentStep: step(5, StepStatus.FAILED),
    blocker: {
      code: BlockerCode.ARTIFACT_INVALID,
      recoverable: defaultBlockerRecoverable(BlockerCode.ARTIFACT_INVALID),
    },
    progress: { completedSteps: 3, totalSteps: TOTAL_STEPS },
  },
};

/** A valid example command: the user reports the export step may be done. */
export const SAMPLE_RECHECK_COMMAND: ActionWindowCommand = {
  protocolVersion: PROTOCOL_VERSION,
  commandId: "cmd_recheck_0001",
  runId: RUN_ID,
  expectedRevision: 3,
  type: CommandType.REQUEST_STEP_RECHECK,
  payload: { stepId: "step_3" },
  issuedAt: "2026-07-08T00:00:00.000Z",
};

/** A valid example event: Runtime detected the official download. */
export const SAMPLE_DOWNLOAD_EVENT: ActionWindowEvent = {
  protocolVersion: PROTOCOL_VERSION,
  eventId: "evt_download_0006",
  runId: RUN_ID,
  sequence: 6,
  revision: 6,
  type: EventType.DOWNLOAD_DETECTED,
  occurredAt: "2026-07-08T00:00:01.000Z",
};
