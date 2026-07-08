import { describe, it, expect } from "vitest";
import { ACTION_WINDOW_SCENARIOS, SCENARIO_NAMES } from "./fixtures";
import { validateRunView } from "./view";
import { isSanitized } from "./privacy";
import {
  RUN_STATUS_VALUES,
  STEP_STATUS_VALUES,
  BLOCKER_CODE_VALUES,
  COMMAND_TYPE_VALUES,
} from "./enums";

const REQUIRED = [
  "completed",
  "download-detected",
  "failed",
  "human-action-required",
  "login-required",
  "observing",
  "paused",
  "processing",
  "ready-to-start",
  "starting",
  "ui-drift",
  "waiting-for-user",
];

describe("scenario fixtures", () => {
  it("covers exactly the 12 required scenarios", () => {
    expect(SCENARIO_NAMES).toHaveLength(12);
    expect([...SCENARIO_NAMES].sort()).toEqual(REQUIRED);
  });

  it("each fixture validates, is sanitized, and uses only real enum values", () => {
    for (const name of SCENARIO_NAMES) {
      const v = ACTION_WINDOW_SCENARIOS[name];
      const result = validateRunView(v);
      expect(result.ok).toBe(true);
      expect(isSanitized(v)).toBe(true);
      expect(RUN_STATUS_VALUES).toContain(v.status);
      for (const c of v.allowedCommands) {
        expect(COMMAND_TYPE_VALUES).toContain(c);
      }
      if (v.currentStep) {
        expect(STEP_STATUS_VALUES).toContain(v.currentStep.status);
      }
      if (v.blocker) {
        expect(BLOCKER_CODE_VALUES).toContain(v.blocker.code);
      }
    }
  });
});
