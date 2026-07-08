// Contract-valid, sanitized scenario fixtures for the Action Window UI.
//
// The names below are FIXTURE / SCENARIO names for FE rendering — NOT protocol
// enum values. Each fixture is a real `ActionWindowRunView` built only from the
// contract's actual RunStatus / StepStatus / ExecutionMode / BlockerCode /
// CommandType values, so FE-1 can render every state without inventing semantics.

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
import { defaultAllowedCommands, type ActionWindowRunView } from "./view";

const TOTAL_STEPS = 5;
const RUN_ID = "run_esm_review_demo";
const CHANNEL = "esm";
const TITLE = "리뷰 내려받기 · ESM(지마켓)";

const STEP_TITLES: Record<number, string> = {
  1: "준비 — 로그인·기간 확인",
  2: "판매자센터 리뷰 내려받기 화면 열기",
  3: "기간·범위 지정 후 내려받기",
  4: "다운로드 감지",
  5: "가져오기·정리·리포트",
};

function step(
  stepNumber: number,
  status: StepStatus,
  instruction?: string,
): ActionWindowRunView["currentStep"] {
  return {
    stepId: `step_${stepNumber}`,
    stepNumber,
    totalSteps: TOTAL_STEPS,
    title: STEP_TITLES[stepNumber] ?? `단계 ${stepNumber}`,
    ...(instruction !== undefined ? { instruction } : {}),
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
  "protocolVersion" | "runId" | "revision" | "channel" | "title" | "status" | "executionMode" | "guidanceEnabled" | "allowedCommands"
> {
  return {
    protocolVersion: PROTOCOL_VERSION,
    runId: RUN_ID,
    revision,
    channel: CHANNEL,
    title: TITLE,
    status,
    executionMode: ExecutionMode.ACTION_WINDOW,
    guidanceEnabled: true,
    allowedCommands: defaultAllowedCommands(status),
  };
}

export const ACTION_WINDOW_SCENARIOS: Record<ScenarioName, ActionWindowRunView> = {
  "ready-to-start": {
    ...base(1, RunStatus.IDLE),
    currentStep: step(1, StepStatus.READY, "‘시작’을 누르면 판매자센터 안내를 시작해요."),
    progress: { completedSteps: 0, totalSteps: TOTAL_STEPS },
  },
  "starting": {
    ...base(2, RunStatus.PREPARING),
    currentStep: step(1, StepStatus.PREPARING),
    progress: { completedSteps: 0, totalSteps: TOTAL_STEPS },
  },
  "human-action-required": {
    ...base(3, RunStatus.WAITING_FOR_HUMAN),
    currentStep: step(3, StepStatus.AWAITING_USER, "기간을 고른 뒤 ‘내려받기’를 눌러 주세요."),
    progress: { completedSteps: 2, totalSteps: TOTAL_STEPS },
  },
  "waiting-for-user": {
    ...base(4, RunStatus.WAITING_FOR_HUMAN),
    guidanceEnabled: false,
    currentStep: step(3, StepStatus.AWAITING_USER, "직접 진행 중이에요. 끝나면 ‘다 했어요’를 눌러 주세요."),
    progress: { completedSteps: 2, totalSteps: TOTAL_STEPS },
  },
  "observing": {
    ...base(5, RunStatus.RUNNING),
    currentStep: step(3, StepStatus.OBSERVING, "내려받기 버튼을 눌렀는지 확인하고 있어요."),
    progress: { completedSteps: 2, totalSteps: TOTAL_STEPS },
  },
  "download-detected": {
    ...base(6, RunStatus.RUNNING),
    currentStep: step(4, StepStatus.PROCESSING, "다운로드를 감지했어요. 파일을 확인하는 중이에요."),
    progress: { completedSteps: 3, totalSteps: TOTAL_STEPS },
  },
  "processing": {
    ...base(7, RunStatus.PROCESSING),
    currentStep: step(5, StepStatus.PROCESSING, "리뷰를 가져와 정리·분석하고 있어요."),
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
      message: "화면이 바뀐 것 같아요. 지금 화면을 확인해 주세요.",
    },
    progress: { completedSteps: 2, totalSteps: TOTAL_STEPS },
  },
  "login-required": {
    ...base(11, RunStatus.WAITING_FOR_HUMAN),
    currentStep: step(1, StepStatus.AWAITING_USER),
    blocker: {
      code: BlockerCode.LOGIN_REQUIRED,
      recoverable: defaultBlockerRecoverable(BlockerCode.LOGIN_REQUIRED),
      message: "판매자센터에 다시 로그인해 주세요.",
    },
    progress: { completedSteps: 0, totalSteps: TOTAL_STEPS },
  },
  "failed": {
    ...base(12, RunStatus.FAILED),
    currentStep: step(5, StepStatus.FAILED),
    blocker: {
      code: BlockerCode.ARTIFACT_INVALID,
      recoverable: defaultBlockerRecoverable(BlockerCode.ARTIFACT_INVALID),
      message: "받은 파일을 확인할 수 없어요. 다시 시도해 주세요.",
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
