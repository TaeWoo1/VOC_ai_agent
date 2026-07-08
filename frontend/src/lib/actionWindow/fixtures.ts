// FE-1 UI scenario fixtures for the Action Window mock flow.
//
// Names are FIXTURE / SCENARIO names (NOT protocol enums). Each non-null `run` is
// a real `ActionWindowRunView` built only from the shared contract's enums, codes,
// and copy keys — every one is asserted valid via the contract's `validateRunView`
// in the tests. `ready-to-start` has no active run (the contract has no persisted
// IDLE status — "no active run" is a UI-only scenario).

import type {
  ActionWindowRunView,
  BlockerCode,
  CommandType,
  ExecutionMode,
  RunStatus,
  StepStatus,
} from "./contract";

const CHANNEL_CODE = "esm_plus";
const RUN_COPY_KEY = "actionWindow.review.run";
const TOTAL = 4;
const RUN_ID = "run_demo_esm";

const STEP_META: Record<number, { stepId: string; copyKey: string }> = {
  1: { stepId: "esm.prepare_session", copyKey: "actionWindow.review.prepare" },
  2: { stepId: "esm.open_surface", copyKey: "actionWindow.review.openSurface" },
  3: { stepId: "esm.select_and_download", copyKey: "actionWindow.review.selectAndDownload" },
  4: { stepId: "esm.process_downstream", copyKey: "actionWindow.review.processDownstream" },
};

type Step = NonNullable<ActionWindowRunView["currentStep"]>;

function mkStep(n: number, status: StepStatus, copyParams?: Record<string, string>): Step {
  const meta = STEP_META[n]!;
  return {
    stepId: meta.stepId,
    stepNumber: n,
    totalSteps: TOTAL,
    copyKey: meta.copyKey,
    ...(copyParams ? { copyParams } : {}),
    status,
  };
}

interface RunInput {
  revision: number;
  status: RunStatus;
  executionMode: ExecutionMode;
  step?: Step;
  guidanceEnabled?: boolean;
  allowedCommands: CommandType[];
  completedSteps: number;
  blocker?: { code: BlockerCode; recoverable: boolean };
  updatedAt: string;
}

function mkRun(i: RunInput): ActionWindowRunView {
  return {
    protocolVersion: 1,
    runId: RUN_ID,
    revision: i.revision,
    channelCode: CHANNEL_CODE,
    runCopyKey: RUN_COPY_KEY,
    status: i.status,
    executionMode: i.executionMode,
    ...(i.step ? { currentStep: i.step } : {}),
    guidanceEnabled: i.guidanceEnabled ?? true,
    allowedCommands: i.allowedCommands,
    ...(i.blocker ? { blocker: i.blocker } : {}),
    progress: { completedSteps: i.completedSteps, totalSteps: TOTAL },
    updatedAt: i.updatedAt,
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

export interface UiScenario {
  name: ScenarioName;
  /** null ⇒ no active run yet (the UI-only IDLE scenario). */
  run: ActionWindowRunView | null;
}

export const UI_SCENARIOS: Record<ScenarioName, UiScenario> = {
  "ready-to-start": { name: "ready-to-start", run: null },
  "starting": {
    name: "starting",
    run: mkRun({
      revision: 1,
      status: "PREPARING",
      executionMode: "AUTOMATIC_OPERATION",
      step: mkStep(1, "PREPARING"),
      allowedCommands: ["PAUSE_RUN", "CANCEL_RUN"],
      completedSteps: 0,
      updatedAt: "2026-07-08T13:00:00Z",
    }),
  },
  "human-action-required": {
    name: "human-action-required",
    run: mkRun({
      revision: 4,
      status: "WAITING_FOR_HUMAN",
      executionMode: "ACTION_WINDOW",
      step: mkStep(3, "AWAITING_USER", { marketplace: "esm_plus" }),
      allowedCommands: ["REQUEST_STEP_RECHECK", "SWITCH_TO_MANUAL", "CANCEL_RUN", "SET_GUIDANCE_ENABLED"],
      completedSteps: 2,
      updatedAt: "2026-07-08T13:05:00Z",
    }),
  },
  "waiting-for-user": {
    name: "waiting-for-user",
    run: mkRun({
      revision: 5,
      status: "WAITING_FOR_HUMAN",
      executionMode: "ACTION_WINDOW",
      step: mkStep(3, "AWAITING_USER"),
      guidanceEnabled: false,
      allowedCommands: ["REQUEST_STEP_RECHECK", "SWITCH_TO_MANUAL", "CANCEL_RUN"],
      completedSteps: 2,
      updatedAt: "2026-07-08T13:06:00Z",
    }),
  },
  "observing": {
    name: "observing",
    run: mkRun({
      revision: 6,
      status: "RUNNING",
      executionMode: "ACTION_WINDOW",
      step: mkStep(3, "OBSERVING"),
      allowedCommands: ["CANCEL_RUN"],
      completedSteps: 2,
      updatedAt: "2026-07-08T13:07:00Z",
    }),
  },
  "download-detected": {
    name: "download-detected",
    run: mkRun({
      revision: 7,
      status: "RUNNING",
      executionMode: "ACTION_WINDOW",
      step: mkStep(4, "PROCESSING"),
      allowedCommands: ["CANCEL_RUN"],
      completedSteps: 3,
      updatedAt: "2026-07-08T13:08:00Z",
    }),
  },
  "processing": {
    name: "processing",
    run: mkRun({
      revision: 8,
      status: "PROCESSING",
      executionMode: "AUTOMATIC_OPERATION",
      step: mkStep(4, "PROCESSING"),
      allowedCommands: ["CANCEL_RUN"],
      completedSteps: 3,
      updatedAt: "2026-07-08T13:08:30Z",
    }),
  },
  "completed": {
    name: "completed",
    run: mkRun({
      revision: 10,
      status: "COMPLETED",
      executionMode: "AUTOMATIC_OPERATION",
      step: mkStep(4, "COMPLETED"),
      allowedCommands: [],
      completedSteps: 4,
      updatedAt: "2026-07-08T13:10:00Z",
    }),
  },
  "paused": {
    name: "paused",
    run: mkRun({
      revision: 3,
      status: "PAUSED",
      executionMode: "AUTOMATIC_OPERATION",
      step: mkStep(2, "READY"),
      allowedCommands: ["RESUME_RUN", "CANCEL_RUN"],
      completedSteps: 1,
      updatedAt: "2026-07-08T13:04:00Z",
    }),
  },
  "ui-drift": {
    name: "ui-drift",
    run: mkRun({
      revision: 6,
      status: "WAITING_FOR_HUMAN",
      executionMode: "ACTION_WINDOW",
      step: mkStep(3, "AWAITING_USER"),
      allowedCommands: ["REQUEST_STEP_RECHECK", "SWITCH_TO_MANUAL", "FIND_CURRENT_STEP", "CANCEL_RUN"],
      completedSteps: 2,
      blocker: { code: "UI_DRIFT", recoverable: true },
      updatedAt: "2026-07-08T13:07:30Z",
    }),
  },
  "login-required": {
    name: "login-required",
    run: mkRun({
      revision: 2,
      status: "WAITING_FOR_HUMAN",
      executionMode: "ACTION_WINDOW",
      step: mkStep(1, "AWAITING_USER"),
      allowedCommands: ["REQUEST_STEP_RECHECK", "CANCEL_RUN"],
      completedSteps: 0,
      blocker: { code: "LOGIN_REQUIRED", recoverable: true },
      updatedAt: "2026-07-08T13:02:00Z",
    }),
  },
  "failed": {
    name: "failed",
    run: mkRun({
      revision: 9,
      status: "FAILED",
      executionMode: "AUTOMATIC_OPERATION",
      step: mkStep(4, "FAILED"),
      allowedCommands: ["CANCEL_RUN"],
      completedSteps: 3,
      blocker: { code: "ARTIFACT_INVALID", recoverable: false },
      updatedAt: "2026-07-08T13:09:00Z",
    }),
  },
};
