import { describe, expect, it } from "vitest";
import {
  isPostCycle,
  mayScheduleSync,
  operationalHintFor,
  reduceWorkerSession,
  stateFromInspection,
  type WorkerEvent,
  type WorkerSessionState,
} from "../../src/esm/worker-session-state";

/** Drive a sequence of events from a start state; return the final state. */
function run(start: WorkerSessionState, events: WorkerEvent[]): WorkerSessionState {
  return events.reduce((s, e) => reduceWorkerSession(s, e).next, start);
}

describe("worker-session-state — pure lifecycle reducer", () => {
  it("boots STARTING → READY only via a LOGGED_IN inspection", () => {
    expect(reduceWorkerSession("STARTING", { kind: "INSPECTED", verdict: "LOGGED_IN" })).toEqual({
      next: "READY",
      accepted: true,
    });
    expect(reduceWorkerSession("STARTING", { kind: "INSPECTED", verdict: "NOT_LOGGED_IN" })).toEqual({
      next: "RECONNECT_REQUIRED",
      accepted: true,
    });
  });

  it("a scheduled sync is reachable ONLY from READY", () => {
    expect(reduceWorkerSession("READY", { kind: "SYNC_STARTED" })).toEqual({ next: "SYNCING", accepted: true });
    // Illegal from every non-READY state → safe no-op.
    for (const s of ["STARTING", "RECONNECT_REQUIRED", "PAUSED", "SUCCESS", "DELETE_FAILED"] as WorkerSessionState[]) {
      const t = reduceWorkerSession(s, { kind: "SYNC_STARTED" });
      expect(t).toEqual({ next: s, accepted: false });
    }
  });

  it("routes each SYNCING outcome to its sanitized terminal state", () => {
    expect(run("READY", [{ kind: "SYNC_STARTED" }, { kind: "SYNC_SUCCEEDED" }])).toBe("SUCCESS");
    expect(run("READY", [{ kind: "SYNC_STARTED" }, { kind: "SYNC_UI_CHANGED" }])).toBe("UI_CHANGED");
    expect(run("READY", [{ kind: "SYNC_STARTED" }, { kind: "SYNC_DOWNLOAD_FAILED" }])).toBe("DOWNLOAD_FAILED");
    expect(run("READY", [{ kind: "SYNC_STARTED" }, { kind: "SYNC_UPLOAD_FAILED" }])).toBe("UPLOAD_FAILED");
    expect(run("READY", [{ kind: "SYNC_STARTED" }, { kind: "SYNC_DELETE_FAILED" }])).toBe("DELETE_FAILED");
    expect(run("READY", [{ kind: "SYNC_STARTED" }, { kind: "SYNC_AUTH_LOST" }])).toBe("RECONNECT_REQUIRED");
  });

  it("a completed cycle re-arms to READY ONLY through a fresh inspection (never assumes the session held)", () => {
    // After SUCCESS the worker cannot jump straight back into a sync.
    expect(reduceWorkerSession("SUCCESS", { kind: "SYNC_STARTED" })).toEqual({ next: "SUCCESS", accepted: false });
    // It must re-inspect first.
    expect(run("SUCCESS", [{ kind: "INSPECTED", verdict: "LOGGED_IN" }, { kind: "SYNC_STARTED" }])).toBe("SYNCING");
    // A failed re-inspection lands on RECONNECT_REQUIRED, not READY.
    expect(reduceWorkerSession("UPLOAD_FAILED", { kind: "INSPECTED", verdict: "NOT_LOGGED_IN" })).toEqual({
      next: "RECONNECT_REQUIRED",
      accepted: true,
    });
  });

  it("RESTART is NEVER treated as session restoration: any state → STARTING, re-arm needs a fresh inspection", () => {
    for (const s of [
      "READY",
      "SYNCING",
      "SUCCESS",
      "RECONNECT_REQUIRED",
      "DEGRADED",
      "PAUSED",
      "DELETE_FAILED",
    ] as WorkerSessionState[]) {
      expect(reduceWorkerSession(s, { kind: "RESTART" })).toEqual({ next: "STARTING", accepted: true });
    }
    // A restart from a live READY does NOT silently return to READY — it must re-inspect.
    expect(run("READY", [{ kind: "RESTART" }, { kind: "SYNC_STARTED" }])).toBe("STARTING"); // SYNC rejected from STARTING
    expect(reduceWorkerSession("STARTING", { kind: "SYNC_STARTED" }).accepted).toBe(false);
  });

  it("DELETE_FAILED is a hard stop — no INSPECTED re-arm, only STOP / RESTART escape", () => {
    expect(reduceWorkerSession("DELETE_FAILED", { kind: "INSPECTED", verdict: "LOGGED_IN" })).toEqual({
      next: "DELETE_FAILED",
      accepted: false,
    });
    expect(reduceWorkerSession("DELETE_FAILED", { kind: "STOP" })).toEqual({ next: "STOPPED", accepted: true });
    expect(reduceWorkerSession("DELETE_FAILED", { kind: "RESTART" })).toEqual({ next: "STARTING", accepted: true });
  });

  it("STOP is terminal and dominates; STOPPED rejects everything (a new process starts fresh, not from here)", () => {
    for (const s of ["READY", "SYNCING", "RECONNECT_REQUIRED"] as WorkerSessionState[]) {
      expect(reduceWorkerSession(s, { kind: "STOP" })).toEqual({ next: "STOPPED", accepted: true });
    }
    expect(reduceWorkerSession("STOPPED", { kind: "RESTART" })).toEqual({ next: "STOPPED", accepted: false });
    expect(reduceWorkerSession("STOPPED", { kind: "INSPECTED", verdict: "LOGGED_IN" }).accepted).toBe(false);
  });

  it("policy helpers gate scheduling and describe post-cycle re-inspection need", () => {
    expect(stateFromInspection("LOGGED_IN")).toBe("READY");
    expect(stateFromInspection("NOT_LOGGED_IN")).toBe("RECONNECT_REQUIRED");
    expect(mayScheduleSync("READY")).toBe(true);
    for (const s of ["STARTING", "RECONNECT_REQUIRED", "SYNCING", "SUCCESS", "PAUSED"] as WorkerSessionState[]) {
      expect(mayScheduleSync(s)).toBe(false);
    }
    expect(isPostCycle("SUCCESS")).toBe(true);
    expect(isPostCycle("DEGRADED")).toBe(true);
    expect(isPostCycle("READY")).toBe(false);
  });
});

describe("worker-session-state — operational bridge never touches capability", () => {
  it("maps finished states to a SyncOutcome kind, and in-flight/boot states to null", () => {
    expect(operationalHintFor("SUCCESS")).toEqual({ kind: "SUCCEEDED" });
    expect(operationalHintFor("UI_CHANGED")).toEqual({ kind: "FAILED", errorCategory: "EXPORT_LAYOUT_CHANGED" });
    expect(operationalHintFor("DOWNLOAD_FAILED")).toEqual({ kind: "FAILED", errorCategory: "DOWNLOAD_FAILED" });
    expect(operationalHintFor("UPLOAD_FAILED")).toEqual({ kind: "FAILED", errorCategory: "NETWORK" });
    expect(operationalHintFor("DELETE_FAILED")).toEqual({ kind: "FAILED", errorCategory: "UNKNOWN" });
    expect(operationalHintFor("RECONNECT_REQUIRED")).toEqual({ kind: "AUTH_RECONNECT_REQUIRED" });
    expect(operationalHintFor("PAUSED")).toEqual({ kind: "PAUSED" });
    for (const s of ["STARTING", "READY", "SYNCING", "STOPPED"] as WorkerSessionState[]) {
      expect(operationalHintFor(s)).toBeNull();
    }
  });

  it("DEGRADED reports PARTIAL (operational health only) and carries NO CapabilityStatus field", () => {
    const hint = operationalHintFor("DEGRADED");
    expect(hint).toEqual({ kind: "PARTIAL" });
    // The bridge must never smuggle a capability change: no key named like a capability field.
    const keys = Object.keys(hint ?? {});
    expect(keys).not.toContain("capabilityStatus");
    expect(keys).not.toContain("CapabilityStatus");
    expect(keys.every((k) => k === "kind" || k === "errorCategory")).toBe(true);
  });
});
