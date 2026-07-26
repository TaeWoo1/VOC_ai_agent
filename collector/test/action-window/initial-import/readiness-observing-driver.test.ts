/**
 * The readiness-observing decorator must be INVISIBLE to a run: every method delegates, `prepareSurface`
 * returns the inner reading unchanged, and an observation that throws must never fail the run. If any of that
 * slips, the "existing NAVER path is byte-for-byte equivalent" claim is gone.
 */
import { describe, expect, it, vi } from "vitest";
import type { SurfaceProbeResult } from "../../../src/action-window/engine";
import { ImportFixtureDriver } from "../../../src/action-window/initial-import/import-fixture-driver";
import { ReadinessObservingImportDriver } from "../../../src/action-window/initial-import/readiness-observing-driver";

describe("ReadinessObservingImportDriver — transparent observation of prepareSurface", () => {
  it("returns the inner prepareSurface reading unchanged and passes it to the observer", async () => {
    const reading: SurfaceProbeResult = { ok: false, blockerCode: "LOGIN_REQUIRED" };
    const inner = new ImportFixtureDriver({ surface: reading });
    const seen: (boolean | SurfaceProbeResult)[] = [];
    const driver = new ReadinessObservingImportDriver(inner, (r) => seen.push(r));

    const res = await driver.prepareSurface();
    expect(res).toEqual(reading); // the engine sees exactly what the inner driver returned
    expect(seen).toEqual([reading]); // and the observer saw the same reading
  });

  it("never lets an observation failure surface into the run", async () => {
    const inner = new ImportFixtureDriver({ surface: true });
    const driver = new ReadinessObservingImportDriver(inner, () => {
      throw new Error("observer blew up");
    });
    await expect(driver.prepareSurface()).resolves.toBe(true); // the run still gets its reading
  });

  it("delegates every other method verbatim to the inner driver", async () => {
    const inner = new ImportFixtureDriver();
    const driver = new ReadinessObservingImportDriver(inner, () => {});

    await driver.prepareSurface();
    await driver.readSurfaceFacts();
    await driver.locateTarget("start_date");
    await driver.highlightTarget("start_date");
    await driver.isTargetPrefilled("start_date", { start: "2026-06-01", end: "2026-06-30" });
    await driver.armTargetObserve("start_date");
    await driver.waitForTargetAction("start_date");
    await driver.readSelectedScope({ start: "2026-06-01", end: "2026-06-30" });
    await driver.detectDownload();
    await driver.validateArtifact("a1b2c3d4e5f60718");
    await driver.ingest("a1b2c3d4e5f60718", "MACHINE_MATCHED");
    await driver.clearTargetHighlight();
    await driver.renderGuidance(null);
    await driver.takeGuidanceIntent();
    await driver.cleanup();

    // The inner driver's own call log is the proof each method reached it, in order, exactly once.
    expect(inner.calls).toEqual([
      "prepareSurface",
      "readSurfaceFacts",
      "locate:start_date",
      "highlight:start_date",
      "prefilled:start_date:2026-06-01..2026-06-30",
      "observe:start_date",
      "wait:start_date",
      "scope:2026-06-01..2026-06-30",
      "detectDownload",
      "validate:a1b2c3d4e5f60718",
      "ingest:a1b2c3d4e5f60718",
      "clearHighlight",
      "cleanup",
    ]);
  });

  it("forwards the optional dev-badge capability instead of swallowing it", () => {
    const inner = new ImportFixtureDriver() as ImportFixtureDriver & { setBadgeTotalSteps?: (n: number | null) => void };
    const spy = vi.fn();
    inner.setBadgeTotalSteps = spy;
    const driver = new ReadinessObservingImportDriver(inner, () => {});
    driver.setBadgeTotalSteps(8);
    expect(spy).toHaveBeenCalledWith(8);
  });
});
