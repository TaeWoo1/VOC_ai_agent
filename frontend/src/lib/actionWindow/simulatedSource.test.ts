import { describe, it, expect, beforeEach } from "vitest";
import { COMMAND_REJECTED_COPY } from "./copy";
import { UI_SCENARIOS } from "./fixtures";
import { createSimulatedSource, SIM_SCENARIO_NAMES, type SimScenarioName } from "./simulatedSource";
import {
  activateSimulation,
  dispatchOperationsCommand,
  getOperationsState,
  loadRunScenario,
  resetOperationsStateForTests,
  stepSimulation,
  stopSimulation,
} from "./operationsStore";

function startSim(name: SimScenarioName): void {
  activateSimulation(name, createSimulatedSource(name));
}

describe("Action Window FE-2.5 simulated source & store resilience", () => {
  beforeEach(() => {
    resetOperationsStateForTests();
  });

  it("covers exactly the 6 simulation scenarios", () => {
    expect(SIM_SCENARIO_NAMES).toHaveLength(6);
  });

  it("activating a simulation starts a fresh stream but keeps recent activity", () => {
    const historyBefore = getOperationsState().recentRuns;
    startSim("sim-duplicate");
    const s = getOperationsState();
    expect(s.simulation).toBe("sim-duplicate");
    expect(s.run).toBeNull();
    expect(s.recentRuns).toBe(historyBefore);
  });

  it("duplicate delivery is idempotent (same sequence dropped, even with new content)", () => {
    startSim("sim-duplicate");
    stepSimulation(); // seq 1: observing
    expect(getOperationsState().run?.currentStep?.status).toBe("OBSERVING");
    stepSimulation(); // seq 1 again, carrying 'paused' content — must be dropped
    expect(getOperationsState().run?.status).toBe("RUNNING");
    expect(getOperationsState().run?.revision).toBe(UI_SCENARIOS["observing"].run!.revision);
    stepSimulation(); // seq 2: download-detected
    expect(getOperationsState().run?.progress.completedSteps).toBe(3);
  });

  it("a stale view revision never regresses the rendered view", () => {
    startSim("sim-stale-view");
    stepSimulation(); // waiting-for-user (revision 5)
    expect(getOperationsState().run?.revision).toBe(5);
    stepSimulation(); // human-action-required (revision 4) — stale, dropped
    expect(getOperationsState().run?.revision).toBe(5);
    expect(getOperationsState().run?.guidanceEnabled).toBe(false); // still waiting-for-user
    stepSimulation(); // observing (revision 6)
    expect(getOperationsState().run?.revision).toBe(6);
  });

  it("a sequence gap drops the frame and restores via a requested snapshot", () => {
    startSim("sim-out-of-order");
    stepSimulation(); // seq 1: starting
    expect(getOperationsState().run?.status).toBe("PREPARING");
    stepSimulation(); // seq 3: gap → dropped; store requests snapshot → seq 4 applied
    expect(getOperationsState().run?.status).toBe("PROCESSING");
    stepSimulation(); // late seq 2 — out of order after the snapshot, dropped
    expect(getOperationsState().run?.status).toBe("PROCESSING");
  });

  it("a snapshot replaces the view wholesale without touching recent activity", () => {
    startSim("sim-snapshot-restore");
    const historyBefore = getOperationsState().recentRuns;
    stepSimulation(); // human-action-required
    expect(getOperationsState().run?.status).toBe("WAITING_FOR_HUMAN");
    stepSimulation(); // snapshot: completed
    expect(getOperationsState().run?.status).toBe("COMPLETED");
    expect(getOperationsState().recentRuns).toBe(historyBefore);
  });

  it("a stale command is rejected safely and never completes a step locally", () => {
    startSim("sim-stale-command");
    stepSimulation(); // human-action-required (revision 4)
    dispatchOperationsCommand("REQUEST_STEP_RECHECK"); // rejected: source moved to 5
    const s = getOperationsState();
    expect(s.note).toBe(COMMAND_REJECTED_COPY["stale-revision"]);
    expect(s.run?.revision).toBe(5); // corrected view applied
    expect(s.run?.status).not.toBe("COMPLETED");
    expect(s.run?.currentStep?.status).not.toBe("COMPLETED");
  });

  it("commands during other simulations are rejected with the safe note", () => {
    startSim("sim-duplicate");
    stepSimulation();
    const runBefore = getOperationsState().run;
    dispatchOperationsCommand("START_RUN");
    expect(getOperationsState().note).toBe(COMMAND_REJECTED_COPY["not-allowed"]);
    expect(getOperationsState().run).toBe(runBefore);
  });

  it("offline → reconnecting → snapshot restore → connected", () => {
    startSim("sim-offline-reconnect");
    stepSimulation(); // observing
    expect(getOperationsState().connection).toBe("connected");
    stepSimulation(); // offline
    expect(getOperationsState().connection).toBe("offline");
    stepSimulation(); // reconnecting
    expect(getOperationsState().connection).toBe("reconnecting");
    stepSimulation(); // snapshot restores the view
    expect(getOperationsState().run?.progress.completedSteps).toBe(3);
    stepSimulation(); // connected again
    expect(getOperationsState().connection).toBe("connected");
    expect(getOperationsState().simulationRemaining).toBe(0);
  });

  it("stopping a simulation returns to a working fixture source", () => {
    startSim("sim-duplicate");
    stepSimulation();
    stepSimulation();
    stepSimulation(); // download-detected: allowedCommands [CANCEL_RUN]
    stopSimulation();
    expect(getOperationsState().simulation).toBeNull();
    dispatchOperationsCommand("CANCEL_RUN");
    expect(getOperationsState().run).toBeNull(); // fixture transition worked
  });

  it("loading a fixture scenario ends the simulation", () => {
    startSim("sim-offline-reconnect");
    stepSimulation();
    stepSimulation(); // offline
    loadRunScenario("observing");
    const s = getOperationsState();
    expect(s.simulation).toBeNull();
    expect(s.connection).toBe("connected");
    dispatchOperationsCommand("CANCEL_RUN");
    expect(getOperationsState().run).toBeNull();
  });
});
