import { afterEach, describe, it, expect, beforeEach, vi } from "vitest";
import {
  adoptBridgeSource,
  beginBridgeRetry,
  canStartNewRun,
  dispatchOperationsCommand,
  endBridgeRetry,
  getOperationsState,
  loadHomeScenario,
  loadRunScenario,
  resetOperationsStateForTests,
  returnToFixtureForDev,
  subscribeOperationsState,
} from "./operationsStore";
import { UI_SCENARIOS } from "./fixtures";
import type { ActionWindowSource, SourceUpdate } from "./source";

/** Minimal inert source standing in for a live Bridge source (no wire, no emits). */
function fakeBridgeSource(): ActionWindowSource {
  return {
    subscribe: () => () => {},
    dispatch: () => {},
    requestSnapshot: () => {},
  };
}

/** A source whose single subscriber can be driven from the test — used to push
 *  `connection` frames into the store (the FE-5 diagnostics trail). */
function controllableSource(): { source: ActionWindowSource; emit: (u: SourceUpdate) => void } {
  let listener: (u: SourceUpdate) => void = () => {};
  return {
    source: {
      subscribe: (next) => {
        listener = next;
        return () => {
          listener = () => {};
        };
      },
      dispatch: () => {},
      requestSnapshot: () => {},
    },
    emit: (u) => listener(u),
  };
}

describe("Action Window FE-2 shared operations store", () => {
  beforeEach(() => {
    // The flagship checkpoint demo is the developer preview's world (A7): the product surface boots
    // empty. These store tests exercise the demo world, so opt in.
    vi.stubEnv("VITE_AW_FIXTURE_PREVIEW", "1");
    resetOperationsStateForTests();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("starts on the flagship checkpoint demo with mock history (developer preview)", () => {
    const s = getOperationsState();
    expect(s.homeScenario).toBe("home-active-checkpoint");
    expect(s.run?.status).toBe("WAITING_FOR_HUMAN");
    expect(s.recentRuns.length).toBeGreaterThan(0);
  });

  it("boots EMPTY on the product surface — no fixture run may pose as the seller's own (A7)", () => {
    vi.unstubAllEnvs();
    resetOperationsStateForTests();
    const s = getOperationsState();
    expect(s.homeScenario).toBe("home-empty");
    expect(s.run).toBeNull();
    expect(s.recentRuns).toEqual([]);
    expect(s.sourceMode).toBe("fixture");
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

  it("notes carry a monotonically increasing id (per-surface scoping)", () => {
    const before = getOperationsState().noteId;
    dispatchOperationsCommand("PAUSE_RUN"); // rejected → note set
    const afterReject = getOperationsState().noteId;
    expect(afterReject).toBeGreaterThan(before);
    dispatchOperationsCommand("REQUEST_STEP_RECHECK"); // applied → note set
    expect(getOperationsState().noteId).toBeGreaterThan(afterReject);
  });

  it("FE-4: begin/endBridgeRetry toggle the in-flight flag; failure surfaces a safe note", () => {
    expect(getOperationsState().retryPending).toBe(false);
    beginBridgeRetry();
    expect(getOperationsState().retryPending).toBe(true);

    endBridgeRetry(true); // success: pending cleared, no failure note
    expect(getOperationsState().retryPending).toBe(false);

    const noteIdBefore = getOperationsState().noteId;
    beginBridgeRetry();
    endBridgeRetry(false); // failure: pending cleared + safe note on the note channel
    const s = getOperationsState();
    expect(s.retryPending).toBe(false);
    expect(s.note.length).toBeGreaterThan(0);
    expect(s.note).not.toContain("aw_");
    expect(s.noteId).toBeGreaterThan(noteIdBefore);
  });

  it("FE-4: returnToFixtureForDev leaves a bridge world back to the fixture world", () => {
    let closed = false;
    adoptBridgeSource(fakeBridgeSource(), () => {
      closed = true;
    });
    expect(getOperationsState().sourceMode).toBe("bridge");

    returnToFixtureForDev();
    const s = getOperationsState();
    expect(closed).toBe(true); // the live source was torn down
    expect(s.sourceMode).toBe("fixture");
    expect(s.connection).toBe("connected");
    expect(s.retryPending).toBe(false);
    expect(s.run?.status).toBe("WAITING_FOR_HUMAN"); // back on the initial checkpoint demo
  });

  it("FE-5: the initial state carries a fresh, connected diagnostics trail", () => {
    const s = getOperationsState();
    expect(s.connection).toBe("connected");
    expect(s.connectionTrail).toEqual(["connected"]);
    expect(s.connectionChangeCount).toBe(0);
  });

  it("FE-5: connection changes append to the trail and bump the change counter", () => {
    const { source, emit } = controllableSource();
    adoptBridgeSource(source, () => {}); // fresh bridge world: trail ["connected"], count 0
    expect(getOperationsState().connectionTrail).toEqual(["connected"]);

    emit({ kind: "connection", connection: "reconnecting" });
    emit({ kind: "connection", connection: "offline" });
    emit({ kind: "connection", connection: "connected" });
    const s = getOperationsState();
    expect(s.connection).toBe("connected");
    expect(s.connectionTrail).toEqual(["connected", "reconnecting", "offline", "connected"]);
    expect(s.connectionChangeCount).toBe(3);
  });

  it("FE-5: a repeated same-state connection frame is not counted as a transition", () => {
    const { source, emit } = controllableSource();
    adoptBridgeSource(source, () => {});
    emit({ kind: "connection", connection: "reconnecting" });
    emit({ kind: "connection", connection: "reconnecting" }); // duplicate, no transition
    const s = getOperationsState();
    expect(s.connectionTrail).toEqual(["connected", "reconnecting"]);
    expect(s.connectionChangeCount).toBe(1);
  });

  it("FE-5: the trail is capped (holds only the most recent transitions)", () => {
    const { source, emit } = controllableSource();
    adoptBridgeSource(source, () => {});
    const cycle: Array<"reconnecting" | "connected"> = [];
    for (let i = 0; i < 10; i += 1) cycle.push(i % 2 === 0 ? "reconnecting" : "connected");
    for (const c of cycle) emit({ kind: "connection", connection: c });
    const s = getOperationsState();
    expect(s.connectionTrail.length).toBeLessThanOrEqual(6);
    expect(s.connectionChangeCount).toBe(10); // every alternation counted
    // Only ever the three known literals — no timing, no ids.
    for (const c of s.connectionTrail) {
      expect(["connected", "reconnecting", "offline"]).toContain(c);
    }
  });

  it("FE-5: switching worlds resets the diagnostics trail to a fresh session", () => {
    const { source, emit } = controllableSource();
    adoptBridgeSource(source, () => {});
    emit({ kind: "connection", connection: "reconnecting" });
    emit({ kind: "connection", connection: "offline" });
    expect(getOperationsState().connectionChangeCount).toBe(2);

    loadRunScenario("observing"); // back to the fixture world
    const s = getOperationsState();
    expect(s.connectionTrail).toEqual(["connected"]);
    expect(s.connectionChangeCount).toBe(0);
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
