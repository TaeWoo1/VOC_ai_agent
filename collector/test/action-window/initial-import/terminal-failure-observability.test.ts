/**
 * <b>A run that ends must say where it died.</b> — NAVER Guided Acquisition Live Findings Closure v1 §1.
 *
 * Two live sittings on 2026-09-01 ended the same way and neither could be attributed. The run reached the
 * range-confirm barrier, the seller confirmed, the engine advanced to `LOCATE_EXPORT`, found no export
 * control and failed terminally — and the helper log's last line was the scope verdict, minutes earlier.
 * `recordFailure` covers only the eight RECOVERABLE reliability parks; nothing covered a terminal engine
 * failure, so `TARGET_NOT_FOUND`, `DOWNLOAD_TIMEOUT`, `ARTIFACT_INVALID`, `INGEST_FAILED` and
 * `RUNTIME_FAULT` all ended runs in silence.
 *
 * The seller UI was NOT the gap and is not re-tested here: `view.blocker` already carried the code, and both
 * the card and the in-page panel already had copy for it. This is about the trail an operator reads.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { ImportSegmentEngine } from "../../../src/action-window/initial-import/import-engine";
import {
  TERMINAL_EVENT,
  recordTerminalFailure,
} from "../../../src/action-window/initial-import/reliability-instrumentation";
import { clearLogSink, getLogSink } from "../../../src/log";

describe("a terminal guided-import failure is never silent", () => {
  beforeEach(() => clearLogSink());
  afterEach(() => clearLogSink());

  it("records the code AND the stage — the stage is what says WHICH control", () => {
    recordTerminalFailure("TARGET_NOT_FOUND", "LOCATE_EXPORT");
    const entry = getLogSink().find((e) => e.event === TERMINAL_EVENT);
    expect(entry, "a terminal failure emits a marker").toBeDefined();
    expect(entry!.meta).toMatchObject({
      code: "TARGET_NOT_FOUND",
      stage: "LOCATE_EXPORT",
      recoverable: false,
    });
  });

  /**
   * The distinction that makes the marker worth having. `TARGET_NOT_FOUND` alone cannot tell an operator
   * whether the seller is on the wrong page or our export locator is wrong — only the stage can, and
   * `fail()` overwrites `stage` on its way to `FAILED`, so it has to be captured before that.
   */
  it("names the stage the run was in, not the FAILED stage it moved to", () => {
    const engine = new ImportSegmentEngine({
      runId: "run_terminal01",
      channelCode: "naver",
      importRef: "0123456789abcdef",
      required: { start: "2026-09-01", end: "2026-09-01" },
    });
    engine.command({ type: "START_RUN", expectedRevision: 0 });
    engine.onSurfaceReady(true);
    engine.onFactsRead({ requiresApply: false, requiresFilters: false });
    // The first locate the run performs is the start-date control; failing it here is the cheapest way to
    // reach a terminal failure without walking the whole plan.
    engine.onTargetLocated("start_date", { count: 0 });

    const terminal = engine.terminalFailure();
    expect(terminal, "a failed engine answers with its terminal failure").not.toBeNull();
    expect(terminal!.code).toBe("TARGET_NOT_FOUND");
    expect(terminal!.stage).not.toBe("FAILED");
    expect(terminal!.stage).toContain("LOCATE");
  });

  it("answers null while the run is alive, and for a RECOVERABLE park", () => {
    const engine = new ImportSegmentEngine({
      runId: "run_terminal02",
      channelCode: "naver",
      importRef: "0123456789abcdef",
      required: { start: "2026-09-01", end: "2026-09-01" },
    });
    expect(engine.terminalFailure(), "a run that has not started has not failed").toBeNull();
    engine.command({ type: "START_RUN", expectedRevision: 0 });
    expect(engine.terminalFailure(), "a running run has not failed").toBeNull();
    // A reliability park is recoverable and already has its own `aw_acquisition_failure` marker; claiming it
    // here would double-report it AND call a recoverable stop terminal.
    engine.reliabilityPark("SURFACE_SETTLE_TIMEOUT");
    expect(engine.terminalFailure(), "a recoverable park is not a terminal failure").toBeNull();
  });
});
