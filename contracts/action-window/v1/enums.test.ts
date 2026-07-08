import { describe, it, expect } from "vitest";
import {
  RunStatus,
  StepStatus,
  ExecutionMode,
  BlockerCode,
  CommandType,
  EventType,
  COMMAND_TYPE_VALUES,
  EVENT_TYPE_VALUES,
  TERMINAL_RUN_STATUSES,
  isTerminalRunStatus,
  COMMANDS_THAT_COMPLETE_STEPS,
  commandMarksStepComplete,
  STEP_COMPLETION_EVENT,
} from "./enums";

describe("enums", () => {
  it("defines every required run status", () => {
    for (const s of [
      "IDLE",
      "PREPARING",
      "RUNNING",
      "WAITING_FOR_HUMAN",
      "PAUSED",
      "PROCESSING",
      "COMPLETED",
      "FAILED",
      "CANCELLED",
    ]) {
      expect(Object.values(RunStatus)).toContain(s);
    }
  });

  it("defines every required step status", () => {
    for (const s of [
      "PENDING",
      "PREPARING",
      "READY",
      "AWAITING_USER",
      "OBSERVING",
      "PROCESSING",
      "COMPLETED",
      "FAILED",
      "SKIPPED",
    ]) {
      expect(Object.values(StepStatus)).toContain(s);
    }
  });

  it("uses execution-mode names consistent with the canonical product docs", () => {
    expect(Object.values(ExecutionMode)).toEqual([
      "AUTOMATIC_OPERATION",
      "ACTION_WINDOW",
      "FILE_IMPORT",
      "INTEGRATION_PENDING",
    ]);
  });

  it("defines every required blocker code", () => {
    for (const b of [
      "LOGIN_REQUIRED",
      "UI_DRIFT",
      "TARGET_NOT_FOUND",
      "TARGET_AMBIGUOUS",
      "SESSION_EXPIRED",
      "UNSUPPORTED_STATE",
      "DOWNLOAD_TIMEOUT",
      "ARTIFACT_INVALID",
    ]) {
      expect(Object.values(BlockerCode)).toContain(b);
    }
  });

  it("excludes CONFIRM_STEP_COMPLETED and includes REQUEST_STEP_RECHECK", () => {
    expect(COMMAND_TYPE_VALUES as readonly string[]).not.toContain("CONFIRM_STEP_COMPLETED");
    expect(COMMAND_TYPE_VALUES).toContain(CommandType.REQUEST_STEP_RECHECK);
  });

  it("no command marks a step complete — only the STEP_COMPLETED event does", () => {
    expect(COMMANDS_THAT_COMPLETE_STEPS).toHaveLength(0);
    for (const c of COMMAND_TYPE_VALUES) {
      expect(commandMarksStepComplete(c)).toBe(false);
    }
    expect(commandMarksStepComplete(CommandType.REQUEST_STEP_RECHECK)).toBe(false);
    expect(STEP_COMPLETION_EVENT).toBe(EventType.STEP_COMPLETED);
  });

  it("defines every required event type", () => {
    for (const e of [
      "RUN_STARTED",
      "STEP_READY",
      "HUMAN_ACTION_REQUIRED",
      "TARGET_HIGHLIGHTED",
      "USER_ACTION_OBSERVED",
      "DOWNLOAD_DETECTED",
      "STEP_COMPLETED",
      "RUN_COMPLETED",
      "RUN_FAILED",
      "RUN_PAUSED",
      "RUN_RESUMED",
      "BLOCKER_CHANGED",
    ]) {
      expect(EVENT_TYPE_VALUES).toContain(e);
    }
  });

  it("marks terminal run statuses", () => {
    expect(TERMINAL_RUN_STATUSES).toEqual([RunStatus.COMPLETED, RunStatus.FAILED, RunStatus.CANCELLED]);
    expect(isTerminalRunStatus(RunStatus.RUNNING)).toBe(false);
    expect(isTerminalRunStatus(RunStatus.COMPLETED)).toBe(true);
  });
});
