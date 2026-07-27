/**
 * The engine's reliability park itself — the recoverable `SURFACE_BLOCKED` stop and the re-check that leaves it.
 */
import { describe, expect, it } from "vitest";
import {
  ImportSegmentEngine,
  makeImportClock,
  RELIABILITY_BLOCKER_CODES,
} from "../../../src/action-window/initial-import/import-engine";

function engine() {
  return new ImportSegmentEngine(
    { runId: "run_r", channelCode: "naver", importRef: "9f2a1c7b4e6d0835", required: { start: "2026-01-01", end: "2026-01-31" } },
    { clock: makeImportClock() },
  );
}

describe("engine reliability park", () => {
  it("parks recoverably at SURFACE_BLOCKED and exposes the blocker in the view", () => {
    const e = engine();
    e.reliabilityPark("OVERLAY_NOT_VISIBLE");
    const v = e.view();
    expect(e.currentStage()).toBe("SURFACE_BLOCKED");
    expect(v.status).toBe("WAITING_FOR_HUMAN");
    expect(v.blocker).toEqual({ code: "OVERLAY_NOT_VISIBLE", recoverable: true });
    expect(v.allowedCommands).toContain("REQUEST_STEP_RECHECK");
  });

  it("is idempotent for the same cause but replaces a different one", () => {
    const e = engine();
    const first = e.reliabilityPark("SURFACE_CLOSED");
    expect(first).toBe("NONE");
    const seqAfterFirst = e.events().length;
    // Same cause again → no new RUN_BLOCKED.
    e.reliabilityPark("SURFACE_CLOSED");
    expect(e.events().length).toBe(seqAfterFirst);
    // A different cause replaces it and is shown to the seller.
    e.reliabilityPark("SURFACE_SETTLE_TIMEOUT");
    expect(e.view().blocker?.code).toBe("SURFACE_SETTLE_TIMEOUT");
  });

  it("a re-check leaves the park by re-running PREPARE on the same ticket", () => {
    const e = engine();
    e.command({ type: "START_RUN", expectedRevision: 0 });
    e.reliabilityPark("SURFACE_OPEN_FAILED");
    const effect = e.command({ type: "REQUEST_STEP_RECHECK", expectedRevision: e.view().revision });
    expect(effect.ok).toBe(true);
    expect(e.currentStage()).toBe("PREPARE_SESSION");
    expect(e.view().blocker).toBeUndefined();
  });

  it("never parks a terminal run", () => {
    const e = engine();
    // Drive to a terminal FAILED via an unsupported surface.
    e.command({ type: "START_RUN", expectedRevision: 0 });
    e.onSurfaceReady({ ok: false, blockerCode: "UNSUPPORTED_STATE" });
    expect(e.currentStage()).toBe("FAILED");
    const before = e.events().length;
    expect(e.reliabilityPark("SURFACE_CLOSED")).toBe("NONE");
    expect(e.events().length).toBe(before);
    expect(e.currentStage()).toBe("FAILED");
  });

  it("names exactly the seven recoverable reliability codes (SESSION_NOT_READY reuses the session blockers)", () => {
    expect([...RELIABILITY_BLOCKER_CODES]).toEqual([
      "SURFACE_OPEN_FAILED",
      "PREPARE_NOT_STARTED",
      "SURFACE_SETTLE_TIMEOUT",
      "GUIDANCE_PACK_REJECTED",
      "OVERLAY_MOUNT_FAILED",
      "OVERLAY_NOT_VISIBLE",
      "SURFACE_CLOSED",
    ]);
  });
});
