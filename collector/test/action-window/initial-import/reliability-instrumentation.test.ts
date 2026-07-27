import { describe, expect, it } from "vitest";
import {
  FAILURE_EVENT,
  STAGE_EVENT,
  furthestStage,
  outcomeFromLog,
  recordFailure,
  recordStage,
} from "../../../src/action-window/initial-import/reliability-instrumentation";
import type { LogEntry } from "../../../src/log";

/** A capturing emit + a matching LogEntry projector, so tests read markers without the global sink. */
function capture() {
  const entries: LogEntry[] = [];
  const emit = (event: string, meta: Record<string, unknown>) =>
    entries.push({ ts: "", level: "info", event, meta });
  return { entries, emit };
}

describe("reliability instrumentation — markers", () => {
  it("records a stage marker carrying only the stage enum", () => {
    const { entries, emit } = capture();
    recordStage("PREPARE", emit);
    expect(entries).toEqual([{ ts: "", level: "info", event: STAGE_EVENT, meta: { stage: "PREPARE" } }]);
  });

  it("records a failure with its stage, projected blocker, and recoverable=true — sanitized enums only", () => {
    const { entries, emit } = capture();
    recordFailure("OVERLAY_NOT_VISIBLE", emit);
    expect(entries[0]).toEqual({
      ts: "",
      level: "info",
      event: FAILURE_EVENT,
      meta: { state: "OVERLAY_NOT_VISIBLE", stage: "OVERLAY_VISIBLE", blocker: "OVERLAY_NOT_VISIBLE", recoverable: true },
    });
  });

  it("carries no un-sanitized keys for any failure state", () => {
    const { entries, emit } = capture();
    recordFailure("SESSION_NOT_READY", emit);
    const keys = Object.keys(entries[0]!.meta).sort();
    expect(keys).toEqual(["blocker", "recoverable", "stage", "state"]);
  });
});

describe("reliability instrumentation — terminal outcome", () => {
  it("returns OK when the run reaches READY with no later failure", () => {
    const { entries, emit } = capture();
    (["SURFACE_OPEN", "SESSION_PROBE", "PREPARE", "OVERLAY_VISIBLE", "READY"] as const).forEach((s) =>
      recordStage(s, emit),
    );
    expect(outcomeFromLog(entries)).toBe("OK");
    expect(furthestStage(entries)).toBe("READY");
  });

  it("returns the single failure state when the run stalls", () => {
    const { entries, emit } = capture();
    recordStage("PREPARE", emit);
    recordFailure("SURFACE_SETTLE_TIMEOUT", emit);
    expect(outcomeFromLog(entries)).toBe("SURFACE_SETTLE_TIMEOUT");
  });

  it("lets the LAST failure win — a run may recover past one stall and hit another", () => {
    const { entries, emit } = capture();
    recordFailure("SURFACE_CLOSED", emit);
    recordStage("PREPARE", emit);
    recordFailure("OVERLAY_MOUNT_FAILED", emit);
    expect(outcomeFromLog(entries)).toBe("OVERLAY_MOUNT_FAILED");
  });

  it("counts a failure recorded AFTER READY as the terminal outcome (a late window close)", () => {
    const { entries, emit } = capture();
    recordStage("READY", emit);
    recordFailure("SURFACE_CLOSED", emit);
    expect(outcomeFromLog(entries)).toBe("SURFACE_CLOSED");
  });

  it("returns null for an un-attributable run that emitted nothing terminal", () => {
    const { entries, emit } = capture();
    recordStage("SURFACE_OPEN", emit);
    recordStage("SESSION_PROBE", emit);
    expect(outcomeFromLog(entries)).toBeNull();
    expect(furthestStage(entries)).toBe("SESSION_PROBE");
  });
});
