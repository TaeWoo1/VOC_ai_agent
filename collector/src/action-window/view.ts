/**
 * Projection of internal Runtime state → the normative `ActionWindowRunView` (R1, post-#214 contract).
 * Pure. This is the ONLY sanitized shape the FE would consume; it exposes no selector, geometry,
 * page content, URL, id, path, or final user prose — only contract enums, counts, opaque refs, a
 * sanitized `channelCode`, and dotted semantic copy keys + sanitized primitive params (FE owns copy).
 */
import type { ActionWindowRunView, BlockerCode, CopyParams, ExecutionMode } from "../../../contracts/action-window/v1/index";
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
  channelCode: string;
  runCopyKey: string;
  runCopyParams?: CopyParams;
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
  // A recovery park is a human-action context on an otherwise AUTOMATIC step: the run waits on the
  // seller to restore their own session. The step's PLAN mode says how that step normally runs; the
  // run's executionMode says who must act NOW. They diverge here and nowhere else.
  //
  // This is not cosmetic. The contract requires WAITING_FOR_HUMAN ⇒ ACTION_WINDOW && AWAITING_USER,
  // and `run-store.ts` validates the projected view on WRITE and throws — inside `drive()`, where the
  // session swallows it into fatalCleanup. Getting this wrong loses the record silently.
  const executionMode: ExecutionMode =
    s.stage === "AWAIT_SESSION_RECOVERY" ? "ACTION_WINDOW" : meta.mode;

  const view: ActionWindowRunView = {
    protocolVersion: ACTION_WINDOW_PROTOCOL_VERSION,
    runId: s.runId,
    revision: s.revision,
    channelCode: s.channelCode,
    runCopyKey: s.runCopyKey,
    ...(s.runCopyParams ? { runCopyParams: s.runCopyParams } : {}),
    status,
    executionMode,
    currentStep: {
      stepId: meta.stepId,
      stepNumber: meta.stepNumber,
      totalSteps: TOTAL_STEPS,
      copyKey: meta.copyKey,
      ...(meta.copyParams ? { copyParams: meta.copyParams } : {}),
      status: stageToStepStatus(effectiveStage),
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
