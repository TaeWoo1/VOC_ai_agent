import { describe, it, expect } from "vitest";
import { validateRunView, COMMAND_TYPES, RUN_STATUSES, BLOCKER_CODES } from "./contract";
import { SCENARIO_NAMES, UI_SCENARIOS } from "./fixtures";
import { applyCommand, isCommandAllowed, getScenario, listScenarios } from "./mockAdapter";

describe("Action Window FE-1 fixtures & mock adapter", () => {
  it("covers exactly the 12 UI scenarios", () => {
    expect(SCENARIO_NAMES).toHaveLength(12);
    expect(listScenarios()).toEqual(SCENARIO_NAMES);
  });

  it("every non-null fixture is a contract-valid run view", () => {
    for (const name of SCENARIO_NAMES) {
      const run = UI_SCENARIOS[name].run;
      if (run === null) continue;
      expect(validateRunView(run)).toEqual({ ok: true });
    }
  });

  it("ready-to-start has no active run (UI-only IDLE scenario)", () => {
    expect(UI_SCENARIOS["ready-to-start"].run).toBeNull();
  });

  it("fixtures use only real contract enums", () => {
    for (const name of SCENARIO_NAMES) {
      const run = UI_SCENARIOS[name].run;
      if (!run) continue;
      expect(RUN_STATUSES).toContain(run.status);
      for (const c of run.allowedCommands) expect(COMMAND_TYPES).toContain(c);
      if (run.blocker) expect(BLOCKER_CODES).toContain(run.blocker.code);
    }
  });

  it("only honors commands present in allowedCommands", () => {
    const waiting = UI_SCENARIOS["human-action-required"].run!;
    expect(waiting.allowedCommands.includes("PAUSE_RUN")).toBe(false);
    expect(isCommandAllowed(waiting, "PAUSE_RUN")).toBe(false);
    expect(applyCommand(waiting, "PAUSE_RUN").applied).toBe(false);
    expect(applyCommand(waiting, "REQUEST_STEP_RECHECK").applied).toBe(true);
  });

  it("REQUEST_STEP_RECHECK never completes a step locally", () => {
    const waiting = UI_SCENARIOS["human-action-required"].run!;
    const res = applyCommand(waiting, "REQUEST_STEP_RECHECK");
    expect(res.run).not.toBeNull();
    expect(res.run!.status).not.toBe("COMPLETED");
    expect(res.run!.currentStep?.status).not.toBe("COMPLETED");
  });

  it("START_RUN is the only command available with no active run", () => {
    expect(isCommandAllowed(null, "START_RUN")).toBe(true);
    expect(isCommandAllowed(null, "PAUSE_RUN")).toBe(false);
    expect(applyCommand(null, "START_RUN").run).not.toBeNull();
  });

  it("recoverable vs non-recoverable blockers are represented", () => {
    expect(UI_SCENARIOS["ui-drift"].run!.blocker?.recoverable).toBe(true);
    expect(UI_SCENARIOS["login-required"].run!.blocker?.recoverable).toBe(true);
    expect(UI_SCENARIOS["failed"].run!.blocker?.recoverable).toBe(false);
  });

  it("a completed run exposes no commands", () => {
    expect(UI_SCENARIOS["completed"].run!.allowedCommands).toEqual([]);
  });

  it("getScenario returns the named scenario", () => {
    expect(getScenario("paused").name).toBe("paused");
  });
});
