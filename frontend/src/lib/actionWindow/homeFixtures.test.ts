import { describe, it, expect } from "vitest";
import { validateRunView, RUN_STATUSES } from "./contract";
import { UI_SCENARIOS } from "./fixtures";
import { hasCopy } from "./copy";
import {
  HOME_SCENARIO_NAMES,
  HOME_SCENARIOS,
  TERMINAL_RUN_STATUSES,
  isTerminalRunStatus,
  toRecentRunItem,
} from "./homeFixtures";

describe("Action Window FE-2 home fixtures (UI-only projections)", () => {
  it("covers exactly the 6 home scenarios", () => {
    expect(HOME_SCENARIO_NAMES).toHaveLength(6);
    for (const name of HOME_SCENARIO_NAMES) {
      expect(HOME_SCENARIOS[name].name).toBe(name);
    }
  });

  it("every non-null activeRun is a contract-valid run view", () => {
    for (const name of HOME_SCENARIO_NAMES) {
      const run = HOME_SCENARIOS[name].view.activeRun;
      if (run === null) continue;
      expect(validateRunView(run)).toEqual({ ok: true });
    }
  });

  it("recent activity holds only terminal runs with real contract statuses", () => {
    for (const name of HOME_SCENARIO_NAMES) {
      for (const item of HOME_SCENARIOS[name].view.recentRuns) {
        expect(RUN_STATUSES).toContain(item.status);
        expect(TERMINAL_RUN_STATUSES).toContain(item.status);
        expect(item.completedSteps).toBeLessThanOrEqual(item.totalSteps);
      }
    }
  });

  it("recent items are sanitized: mapped copy keys, distinct runIds per scenario", () => {
    for (const name of HOME_SCENARIO_NAMES) {
      const items = HOME_SCENARIOS[name].view.recentRuns;
      const ids = items.map((i) => i.runId);
      expect(new Set(ids).size).toBe(ids.length);
      for (const item of items) {
        expect(hasCopy(item.runCopyKey)).toBe(true);
      }
    }
  });

  it("home-empty has no run and no history; home-with-history has history only", () => {
    expect(HOME_SCENARIOS["home-empty"].view.activeRun).toBeNull();
    expect(HOME_SCENARIOS["home-empty"].view.recentRuns).toHaveLength(0);
    expect(HOME_SCENARIOS["home-with-history"].view.activeRun).toBeNull();
    expect(HOME_SCENARIOS["home-with-history"].view.recentRuns.length).toBeGreaterThan(0);
  });

  it("home-completed-just-now keeps the completed run in the active zone", () => {
    const run = HOME_SCENARIOS["home-completed-just-now"].view.activeRun;
    expect(run?.status).toBe("COMPLETED");
  });

  it("toRecentRunItem projects a terminal run and rejects a live run", () => {
    const completed = UI_SCENARIOS["completed"].run!;
    const item = toRecentRunItem(completed);
    expect(item).not.toBeNull();
    expect(item!.runId).toBe(completed.runId);
    expect(item!.status).toBe("COMPLETED");
    expect(item!.finishedAt).toBe(completed.updatedAt);

    const live = UI_SCENARIOS["observing"].run!;
    expect(isTerminalRunStatus(live.status)).toBe(false);
    expect(toRecentRunItem(live)).toBeNull();
  });
});
