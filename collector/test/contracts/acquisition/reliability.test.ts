import { describe, expect, it } from "vitest";
import {
  ACQUISITION_FAILURE_STATES,
  ACQUISITION_STAGES,
  ADVERSARIAL_VARIABLES,
  failureStateToBlocker,
  isRecoverable,
  stageForFailure,
  type AcquisitionFailureState,
  type AcquisitionOutcome,
} from "../../../../contracts/acquisition/v1/index";
import { BLOCKER_CODES } from "../../../../contracts/action-window/v2/index";

describe("Guided Acquisition Reliability — failure-state contract", () => {
  it("names exactly the eight required failure states", () => {
    expect([...ACQUISITION_FAILURE_STATES]).toEqual([
      "SURFACE_OPEN_FAILED",
      "SESSION_NOT_READY",
      "PREPARE_NOT_STARTED",
      "SURFACE_SETTLE_TIMEOUT",
      "GUIDANCE_PACK_REJECTED",
      "OVERLAY_MOUNT_FAILED",
      "OVERLAY_NOT_VISIBLE",
      "SURFACE_CLOSED",
    ]);
  });

  it("has no duplicate states or stages", () => {
    expect(new Set(ACQUISITION_FAILURE_STATES).size).toBe(ACQUISITION_FAILURE_STATES.length);
    expect(new Set(ACQUISITION_STAGES).size).toBe(ACQUISITION_STAGES.length);
  });

  it("walks the pipeline in press → visible order", () => {
    expect([...ACQUISITION_STAGES]).toEqual([
      "SELF_CHECK",
      "SURFACE_OPEN",
      "SESSION_PROBE",
      "PREPARE",
      "SURFACE_SETTLE",
      "GUIDANCE_PACK",
      "OVERLAY_MOUNT",
      "OVERLAY_VISIBLE",
      "READY",
    ]);
  });

  it("anchors every failure to a real pipeline stage", () => {
    for (const state of ACQUISITION_FAILURE_STATES) {
      expect(ACQUISITION_STAGES).toContain(stageForFailure(state));
    }
  });

  it("projects every failure to a real Action Window blocker code", () => {
    for (const state of ACQUISITION_FAILURE_STATES) {
      expect(BLOCKER_CODES as readonly string[]).toContain(failureStateToBlocker(state));
    }
  });

  it("maps SESSION_NOT_READY back to an existing session blocker, not a new one", () => {
    // A login/expired session already has a repair; reusing it keeps the seller copy from splitting.
    expect(failureStateToBlocker("SESSION_NOT_READY")).toBe("SESSION_EXPIRED");
  });

  it("maps the other seven failures to their own same-named blocker", () => {
    const own: AcquisitionFailureState[] = [
      "SURFACE_OPEN_FAILED",
      "PREPARE_NOT_STARTED",
      "SURFACE_SETTLE_TIMEOUT",
      "GUIDANCE_PACK_REJECTED",
      "OVERLAY_MOUNT_FAILED",
      "OVERLAY_NOT_VISIBLE",
      "SURFACE_CLOSED",
    ];
    for (const state of own) {
      expect(failureStateToBlocker(state)).toBe(state);
    }
  });

  it("treats every reliability failure as recoverable — the seller never meets a dead end", () => {
    for (const state of ACQUISITION_FAILURE_STATES) {
      expect(isRecoverable(state)).toBe(true);
    }
  });

  it("offers exactly the five single-variable adversarial axes", () => {
    expect([...ADVERSARIAL_VARIABLES]).toEqual([
      "TIMING",
      "SESSION_FRESHNESS",
      "OVERLAY_TIMING",
      "NAVIGATION",
      "RECHECK",
    ]);
  });

  it("models an outcome as OK or exactly one failure state", () => {
    const ok: AcquisitionOutcome = "OK";
    const bad: AcquisitionOutcome = "OVERLAY_NOT_VISIBLE";
    expect(ok).toBe("OK");
    expect(ACQUISITION_FAILURE_STATES).toContain(bad);
  });
});
