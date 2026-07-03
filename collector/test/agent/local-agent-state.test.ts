import { describe, expect, it } from "vitest";
import {
  isReconnectState,
  mayScheduleSync,
  reduceLocalAgent,
  stateFromInspection,
  type LocalAgentEvent,
  type LocalAgentState,
} from "../../src/agent/local-agent-state";

/** Drive a sequence of events from a start state, returning the final state. */
function run(start: LocalAgentState, events: LocalAgentEvent[]): LocalAgentState {
  let state = start;
  for (const event of events) state = reduceLocalAgent(state, event).next;
  return state;
}

describe("reduceLocalAgent — happy paths", () => {
  it("boots STOPPED → STARTING → INSPECTING_SESSION → READY on LOGGED_IN", () => {
    expect(
      run("STOPPED", [
        { kind: "START" },
        { kind: "INSPECT" },
        { kind: "SESSION_INSPECTED", verdict: "LOGGED_IN" },
      ]),
    ).toBe("READY");
  });

  it("a logged-out inspection routes into PREPARING_RECONNECT", () => {
    expect(
      run("STOPPED", [
        { kind: "START" },
        { kind: "INSPECT" },
        { kind: "SESSION_INSPECTED", verdict: "NOT_LOGGED_IN" },
      ]),
    ).toBe("PREPARING_RECONNECT");
  });

  it("walks the assisted-reconnect path to READY via a single verified submit", () => {
    expect(
      run("PREPARING_RECONNECT", [
        { kind: "RECONNECT_PREPARED" },
        { kind: "CREDENTIALS_SUBMITTED" },
        { kind: "LOGIN_VERIFIED", verdict: "LOGGED_IN" },
      ]),
    ).toBe("READY");
  });

  it("a workday sync goes READY → SYNCING → READY", () => {
    expect(run("READY", [{ kind: "SYNC_STARTED" }, { kind: "SYNC_FINISHED" }])).toBe("READY");
  });
});

describe("reduceLocalAgent — invariants", () => {
  it("a sync may begin ONLY from READY", () => {
    const nonReady: LocalAgentState[] = [
      "STOPPED",
      "STARTING",
      "INSPECTING_SESSION",
      "PREPARING_RECONNECT",
      "WAITING_FOR_CREDENTIAL_SELECTION",
      "VERIFYING_LOGIN",
      "HUMAN_RECONNECT_REQUIRED",
      "SYNCING",
      "PAUSED",
      "DEGRADED",
    ];
    for (const state of nonReady) {
      const t = reduceLocalAgent(state, { kind: "SYNC_STARTED" });
      expect(t.accepted).toBe(false);
      expect(t.next).toBe(state);
    }
    expect(reduceLocalAgent("READY", { kind: "SYNC_STARTED" }).next).toBe("SYNCING");
    expect(mayScheduleSync("READY")).toBe(true);
    expect(mayScheduleSync("SYNCING")).toBe(false);
  });

  it("RESTART always returns to STARTING and can never inherit READY", () => {
    const states: LocalAgentState[] = [
      "STARTING",
      "INSPECTING_SESSION",
      "READY",
      "PREPARING_RECONNECT",
      "WAITING_FOR_CREDENTIAL_SELECTION",
      "VERIFYING_LOGIN",
      "HUMAN_RECONNECT_REQUIRED",
      "SYNCING",
      "PAUSED",
      "DEGRADED",
    ];
    for (const state of states) {
      expect(reduceLocalAgent(state, { kind: "RESTART" }).next).toBe("STARTING");
    }
    // From STARTING, the ONLY way to READY is a fresh LOGGED_IN inspection.
    expect(reduceLocalAgent("STARTING", { kind: "SESSION_INSPECTED", verdict: "LOGGED_IN" }).accepted).toBe(false);
  });

  it("STOP is terminal from any live state; nothing but START escapes STOPPED", () => {
    for (const state of ["READY", "SYNCING", "WAITING_FOR_CREDENTIAL_SELECTION"] as LocalAgentState[]) {
      expect(reduceLocalAgent(state, { kind: "STOP" }).next).toBe("STOPPED");
    }
    expect(reduceLocalAgent("STOPPED", { kind: "STOP" }).accepted).toBe(false);
    expect(reduceLocalAgent("STOPPED", { kind: "RESTART" }).accepted).toBe(false);
    expect(reduceLocalAgent("STOPPED", { kind: "START" }).next).toBe("STARTING");
  });

  it("a failed post-submit verification goes to HUMAN_RECONNECT_REQUIRED (no retry loop back to submit)", () => {
    expect(reduceLocalAgent("VERIFYING_LOGIN", { kind: "LOGIN_VERIFIED", verdict: "NOT_LOGGED_IN" }).next).toBe(
      "HUMAN_RECONNECT_REQUIRED",
    );
    // A human reconnect re-arms ONLY through a fresh inspection.
    expect(reduceLocalAgent("HUMAN_RECONNECT_REQUIRED", { kind: "INSPECT" }).next).toBe("INSPECTING_SESSION");
    expect(reduceLocalAgent("HUMAN_RECONNECT_REQUIRED", { kind: "CREDENTIALS_SUBMITTED" }).accepted).toBe(false);
  });

  it("no CREDENTIALS_SUBMITTED is reachable from PREPARING_RECONNECT (no submit before the wait)", () => {
    expect(reduceLocalAgent("PREPARING_RECONNECT", { kind: "CREDENTIALS_SUBMITTED" }).accepted).toBe(false);
  });

  it("illegal events are safe no-ops (never throw, state unchanged)", () => {
    expect(reduceLocalAgent("READY", { kind: "RECONNECT_PREPARED" })).toEqual({ next: "READY", accepted: false });
    expect(reduceLocalAgent("PAUSED", { kind: "SYNC_STARTED" })).toEqual({ next: "PAUSED", accepted: false });
  });
});

describe("policy helpers", () => {
  it("stateFromInspection maps verdict → authorized state", () => {
    expect(stateFromInspection("LOGGED_IN")).toBe("READY");
    expect(stateFromInspection("NOT_LOGGED_IN")).toBe("PREPARING_RECONNECT");
  });

  it("isReconnectState covers exactly the reconnect states", () => {
    expect(isReconnectState("PREPARING_RECONNECT")).toBe(true);
    expect(isReconnectState("WAITING_FOR_CREDENTIAL_SELECTION")).toBe(true);
    expect(isReconnectState("VERIFYING_LOGIN")).toBe(true);
    expect(isReconnectState("HUMAN_RECONNECT_REQUIRED")).toBe(true);
    expect(isReconnectState("READY")).toBe(false);
    expect(isReconnectState("SYNCING")).toBe(false);
  });
});
