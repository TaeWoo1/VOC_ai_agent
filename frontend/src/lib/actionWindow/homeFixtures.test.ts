import { describe, it, expect } from "vitest";
import { validateRunView, RUN_STATUSES } from "./contract";
import { UI_SCENARIOS } from "./fixtures";
import { hasCopy } from "./copy";
import {
  HOME_SCENARIO_NAMES,
  HOME_SCENARIOS,
  RECENT_RUN_LIMIT,
  TERMINAL_RUN_STATUSES,
  appendRecentRun,
  isTerminalRunStatus,
  toRecentRunItem,
  type RecentRunItem,
} from "./homeFixtures";

function mkItem(n: number): RecentRunItem {
  return {
    runId: `run_test_${n}`,
    runCopyKey: "actionWindow.review.run",
    channelCode: "esm_plus",
    status: "COMPLETED",
    completedSteps: 4,
    totalSteps: 4,
    finishedAt: `2026-07-0${n}T00:00:00Z`,
  };
}

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

  it("appendRecentRun caps the list at RECENT_RUN_LIMIT (oldest drops off)", () => {
    let list: RecentRunItem[] = [];
    for (let n = 1; n <= RECENT_RUN_LIMIT + 2; n += 1) {
      list = appendRecentRun(mkItem(n), list);
    }
    expect(list).toHaveLength(RECENT_RUN_LIMIT);
    expect(list[0]!.runId).toBe(`run_test_${RECENT_RUN_LIMIT + 2}`); // newest first
    expect(list.some((i) => i.runId === "run_test_1")).toBe(false); // oldest dropped
  });

  it("appendRecentRun keeps one entry per runId (replace, never duplicate)", () => {
    let list = appendRecentRun(mkItem(1), [mkItem(2), mkItem(3)].map((i) => i));
    list = appendRecentRun({ ...mkItem(1), completedSteps: 3 }, list);
    expect(list).toHaveLength(3);
    expect(list[0]!.runId).toBe("run_test_1");
    expect(list[0]!.completedSteps).toBe(3); // replaced with the newer projection
    expect(list.filter((i) => i.runId === "run_test_1")).toHaveLength(1);
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
