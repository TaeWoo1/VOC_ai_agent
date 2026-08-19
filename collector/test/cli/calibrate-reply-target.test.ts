/**
 * calibrate-reply-target — the pure offline piece: assembling the persisted mapping from the sanitized
 * calibration read state (guarded so a partial calibration never writes an artifact). `main()` is never invoked
 * (it runs only as the entrypoint), so importing this file launches no browser and opens no live NAVER.
 */
import { describe, it, expect } from "vitest";
import {
  mappingFromCalibration,
  CALIBRATION_INCOMPLETE_EXIT_CODE,
} from "../../instruments/calibration/calibrate-reply-target";
import { ROW_MAPPING_SCHEMA_VERSION } from "../../src/action-window/reply-submission/reply-row-mapping-artifact";
import type { CalibrationReadState } from "../../src/action-window/reply-submission/reply-calibrate-inpage";

const NOW = 5_000_000;
// One-click calibration: only the row identity + the clicked body path are captured; date/rating/reply are unset.
const DONE: CalibrationReadState = {
  step: "DONE",
  done: true,
  lastError: null,
  rowDiag: null,
  parentPath: [0, 2],
  rowTag: "DIV",
  rowIndex: 4,
  body: [2, 0],
  date: null,
  rating: null,
  reply: null,
};

describe("mappingFromCalibration", () => {
  it("assembles a bound, expiring mapping (date/rating/reply paths default to the body path)", () => {
    const m = mappingFromCalibration(DONE, "sig_live", NOW);
    expect(m).toEqual({
      schemaVersion: ROW_MAPPING_SCHEMA_VERSION,
      structuralPageSignature: "sig_live",
      expiresAtEpochMs: NOW + 30 * 60_000,
      parentPath: [0, 2],
      rowTag: "DIV",
      rowIndex: 4,
      ratingPath: [2, 0],
      datePath: [2, 0],
      bodyPath: [2, 0],
      replyControlPath: [2, 0],
    });
  });

  it("returns null (no artifact) when calibration is not done", () => {
    expect(mappingFromCalibration({ ...DONE, done: false }, "sig_live", NOW)).toBeNull();
  });

  it("returns null when the row identity or body was not captured", () => {
    for (const partial of [{ parentPath: null }, { rowTag: null }, { rowIndex: null }, { body: null }]) {
      expect(mappingFromCalibration({ ...DONE, ...partial }, "sig_live", NOW)).toBeNull();
    }
  });

  it("exposes the incomplete exit code", () => {
    expect(CALIBRATION_INCOMPLETE_EXIT_CODE).toBe(5);
  });
});
