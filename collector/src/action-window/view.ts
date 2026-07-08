/**
 * Projection of internal Runtime state → the normative `ActionWindowRunView` (R1). Pure.
 * This is the ONLY sanitized shape the FE would consume; it exposes no selector, geometry,
 * page content, URL, id, or path — only contract enums, counts, opaque refs, and concise copy.
 */
import type { ActionWindowRunView, BlockerCode } from "../../../contracts/action-window/v1/index";
import { ACTION_WINDOW_PROTOCOL_VERSION } from "../../../contracts/action-window/v1/index";
import {
  type Stage,
  allowedCommands,
  stageToRunStatus,
  stageToStepStatus,
  stepMetaByIndex,
  TOTAL_STEPS,
} from "./stages";

export interface EngineSnapshot {
  runId: string;
  channel: string;
  title: string;
  stage: Stage;
  resumeStage: Stage | null;
  activeStepIndex: number;
  revision: number;
  guidanceEnabled: boolean;
  blocker: { code: BlockerCode; recoverable: boolean } | null;
  completedSteps: number;
  updatedAt: string;
}

export function projectRunView(s: EngineSnapshot): ActionWindowRunView {
  const status = stageToRunStatus(s.stage);
  // A paused view reflects the underlying step's status, not a generic "paused" step state.
  const effectiveStage: Stage = s.stage === "PAUSED" ? s.resumeStage ?? s.stage : s.stage;
  const meta = stepMetaByIndex(s.activeStepIndex);

  const view: ActionWindowRunView = {
    protocolVersion: ACTION_WINDOW_PROTOCOL_VERSION,
    runId: s.runId,
    revision: s.revision,
    channel: s.channel,
    title: s.title,
    status,
    executionMode: meta.mode,
    currentStep: {
      stepId: meta.stepId,
      stepNumber: meta.stepNumber,
      totalSteps: TOTAL_STEPS,
      title: meta.title,
      status: stageToStepStatus(effectiveStage),
      ...(s.guidanceEnabled && meta.instruction ? { instruction: meta.instruction } : {}),
    },
    guidanceEnabled: s.guidanceEnabled,
    allowedCommands: allowedCommands(s.stage),
    progress: { completedSteps: s.completedSteps, totalSteps: TOTAL_STEPS },
    updatedAt: s.updatedAt,
  };

  // COMPLETED must never expose an active blocker (contract invariant).
  if (s.blocker && status !== "COMPLETED") {
    view.blocker = { code: s.blocker.code, recoverable: s.blocker.recoverable };
  }
  return view;
}
