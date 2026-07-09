import { describe, it, expect, beforeEach } from "vitest";
import {
  canStartNewRun,
  dispatchOperationsCommand,
  getOperationsState,
  loadHomeScenario,
  loadRunScenario,
  resetOperationsStateForTests,
  subscribeOperationsState,
} from "./operationsStore";
import { UI_SCENARIOS } from "./fixtures";

describe("Action Window FE-2 shared operations store", () => {
  beforeEach(() => {
    resetOperationsStateForTests();
  });

  it("starts on the flagship checkpoint demo with mock history", () => {
    const s = getOperationsState();
    expect(s.homeScenario).toBe("home-active-checkpoint");
    expect(s.run?.status).toBe("WAITING_FOR_HUMAN");
    expect(s.recentRuns.length).toBeGreaterThan(0);
  });

  it("a disallowed command only updates the note (no run change, no archive)", () => {
    const before = getOperationsState();
    dispatchOperationsCommand("PAUSE_RUN"); // not in the checkpoint run's allowedCommands
    const after = getOperationsState();
    expect(after.run).toBe(before.run);
    expect(after.recentRuns).toBe(before.recentRuns);
    expect(after.note.length).toBeGreaterThan(0);
  });

  it("REQUEST_STEP_RECHECK moves to observation and never completes a step", () => {
    dispatchOperationsCommand("REQUEST_STEP_RECHECK");
    const s = getOperationsState();
    expect(s.run).not.toBeNull();
    expect(s.run!.status).not.toBe("COMPLETED");
    expect(s.run!.currentStep?.status).not.toBe("COMPLETED");
  });

  it("a completed run stays in the active zone until a new run starts", () => {
    loadHomeScenario("home-completed-just-now");
    expect(getOperationsState().run?.status).toBe("COMPLETED");
  });

  it("starting a new run archives the completed run into recent activity", () => {
    loadHomeScenario("home-completed-just-now");
    const completed = getOperationsState().run!;
    const historyBefore = getOperationsState().recentRuns.length;
    dispatchOperationsCommand("START_RUN");
    const s = getOperationsState();
    expect(s.run?.status).toBe("PREPARING"); // new run in the active zone
    expect(s.recentRuns).toHaveLength(historyBefore + 1);
    expect(s.recentRuns[0]!.runId).toBe(completed.runId);
    expect(s.recentRuns[0]!.status).toBe("COMPLETED");
    expect(s.recentRuns[0]!.finishedAt).toBe(completed.updatedAt);
  });

  it("cancelling a failed run archives it; cancelling a live run does not", () => {
    loadRunScenario("failed");
    const before = getOperationsState().recentRuns.length;
    dispatchOperationsCommand("CANCEL_RUN");
    expect(getOperationsState().run).toBeNull();
    expect(getOperationsState().recentRuns).toHaveLength(before + 1);
    expect(getOperationsState().recentRuns[0]!.status).toBe("FAILED");

    loadRunScenario("observing");
    const liveBefore = getOperationsState().recentRuns.length;
    dispatchOperationsCommand("CANCEL_RUN");
    expect(getOperationsState().run).toBeNull();
    expect(getOperationsState().recentRuns).toHaveLength(liveBefore);
  });

  it("canStartNewRun: idle and terminal runs yes, a waiting run no", () => {
    expect(canStartNewRun(null)).toBe(true);
    expect(canStartNewRun(UI_SCENARIOS["completed"].run)).toBe(true);
    expect(canStartNewRun(UI_SCENARIOS["failed"].run)).toBe(true);
    expect(canStartNewRun(UI_SCENARIOS["human-action-required"].run)).toBe(false);
  });

  it("commands on a live run still honor allowedCommands (no terminal bypass)", () => {
    loadRunScenario("observing"); // allowedCommands: [CANCEL_RUN]
    dispatchOperationsCommand("START_RUN");
    const s = getOperationsState();
    expect(s.run?.status).toBe("RUNNING"); // unchanged — START ignored on a live run
  });

  it("keeps one recent entry per runId (re-archiving replaces, never duplicates)", () => {
    loadHomeScenario("home-with-history"); // 3 items with distinct runIds
    for (let i = 0; i < 4; i += 1) {
      loadRunScenario("completed"); // demo run reuses the same runId every time
      dispatchOperationsCommand("START_RUN"); // archives it on each start
    }
    const items = getOperationsState().recentRuns;
    expect(items).toHaveLength(4); // 3 history + 1 demo, not 7
    const ids = items.map((i) => i.runId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("dev scenario loads are previews: they reset the note and never archive", () => {
    loadHomeScenario("home-completed-just-now");
    const history = getOperationsState().recentRuns.length;
    loadHomeScenario("home-empty");
    expect(getOperationsState().recentRuns).toHaveLength(0);
    loadHomeScenario("home-completed-just-now");
    expect(getOperationsState().recentRuns).toHaveLength(history);
    expect(getOperationsState().note).toBe("");
  });

  it("notifies subscribers on change and stops after unsubscribe", () => {
    let calls = 0;
    const unsubscribe = subscribeOperationsState(() => {
      calls += 1;
    });
    loadHomeScenario("home-empty");
    expect(calls).toBe(1);
    unsubscribe();
    loadHomeScenario("home-with-history");
    expect(calls).toBe(1);
  });
});
