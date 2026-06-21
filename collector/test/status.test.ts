import { describe, expect, it } from "vitest";
import { decideState, type CollectorState, type RunSignals } from "../src/status";

describe("decideState", () => {
  const cases: Array<[string, RunSignals, string]> = [
    ["unpaired → DISCONNECTED", { paired: false, session: "LOGGED_IN" }, "DISCONNECTED"],
    [
      "auth challenge → ACTION_REQUIRED_FOR_2FA_OR_CAPTCHA",
      { paired: true, session: "AUTH_CHALLENGE" },
      "ACTION_REQUIRED_FOR_2FA_OR_CAPTCHA",
    ],
    ["logged out → SESSION_EXPIRED", { paired: true, session: "LOGGED_OUT" }, "SESSION_EXPIRED"],
    [
      "logged in, export not attempted → CONNECTED",
      { paired: true, session: "LOGGED_IN", exportOutcome: "NOT_ATTEMPTED" },
      "CONNECTED",
    ],
    [
      "logged in, no export field → CONNECTED",
      { paired: true, session: "LOGGED_IN" },
      "CONNECTED",
    ],
    [
      "layout unrecognized → EXPORT_LAYOUT_CHANGED",
      { paired: true, session: "LOGGED_IN", exportOutcome: "LAYOUT_UNRECOGNIZED" },
      "EXPORT_LAYOUT_CHANGED",
    ],
    [
      "export is an async job → EXPORT_ASYNC_JOB_DETECTED",
      { paired: true, session: "LOGGED_IN", exportOutcome: "ASYNC_JOB_DETECTED" },
      "EXPORT_ASYNC_JOB_DETECTED",
    ],
    [
      "export download failed → DOWNLOAD_FAILED",
      { paired: true, session: "LOGGED_IN", exportOutcome: "DOWNLOAD_FAILED" },
      "DOWNLOAD_FAILED",
    ],
    [
      "no-click sync layout detected (not triggered) → EXPORT_SYNC_DETECTED",
      { paired: true, session: "LOGGED_IN", exportOutcome: "SYNC_DOWNLOAD_DETECTED" },
      "EXPORT_SYNC_DETECTED",
    ],
    [
      "sync detected stays EXPORT_SYNC_DETECTED even if an upload field is set (no file to upload)",
      { paired: true, session: "LOGGED_IN", exportOutcome: "SYNC_DOWNLOAD_DETECTED", uploadOutcome: "OK" },
      "EXPORT_SYNC_DETECTED",
    ],
    [
      "captured, upload not attempted → COLLECTING",
      { paired: true, session: "LOGGED_IN", exportOutcome: "CAPTURED", uploadOutcome: "NOT_ATTEMPTED" },
      "COLLECTING",
    ],
    [
      "captured, upload failed → UPLOAD_FAILED",
      { paired: true, session: "LOGGED_IN", exportOutcome: "CAPTURED", uploadOutcome: "FAILED" },
      "UPLOAD_FAILED",
    ],
    [
      "captured + uploaded → LAST_SUCCESS",
      { paired: true, session: "LOGGED_IN", exportOutcome: "CAPTURED", uploadOutcome: "OK" },
      "LAST_SUCCESS",
    ],
  ];

  it.each(cases)("%s", (_label, signals, expected) => {
    expect(decideState(signals)).toBe(expected);
  });

  it("never reports LAST_SUCCESS without both capture and upload", () => {
    // No combination short of CAPTURED+OK may yield LAST_SUCCESS (no fake success).
    const noSuccess: RunSignals[] = [
      { paired: true, session: "LOGGED_IN" },
      { paired: true, session: "LOGGED_IN", exportOutcome: "CAPTURED" },
      { paired: true, session: "LOGGED_IN", exportOutcome: "CAPTURED", uploadOutcome: "FAILED" },
      { paired: false, session: "LOGGED_IN", exportOutcome: "CAPTURED", uploadOutcome: "OK" },
      { paired: true, session: "LOGGED_OUT", exportOutcome: "CAPTURED", uploadOutcome: "OK" },
      // An async export is a job, never a captured-and-uploaded success.
      { paired: true, session: "LOGGED_IN", exportOutcome: "ASYNC_JOB_DETECTED", uploadOutcome: "OK" },
      // A no-click sync DETECTION recognized the control but captured nothing — an
      // OK upload field can never promote it to success (there is no file).
      { paired: true, session: "LOGGED_IN", exportOutcome: "SYNC_DOWNLOAD_DETECTED", uploadOutcome: "OK" },
    ];
    for (const s of noSuccess) {
      expect(decideState(s)).not.toBe("LAST_SUCCESS");
    }
  });
});

describe("export-target readiness states", () => {
  // Written DIRECTLY by the pre-click readiness gate, never produced by decideState.
  const readinessStates = new Set<CollectorState>([
    "EXPORT_TARGET_EMPTY",
    "EXPORT_TARGET_UNKNOWN",
    "EXPORT_DATE_RANGE_REQUIRED",
  ]);

  it("are valid CollectorState members the readiness gate can record", () => {
    expect(readinessStates.size).toBe(3);
  });

  it("decideState never emits a readiness state (those are pre-click gate halts, not run outcomes)", () => {
    const exportOutcomes: RunSignals["exportOutcome"][] = [
      undefined,
      "CAPTURED",
      "SYNC_DOWNLOAD_DETECTED",
      "ASYNC_JOB_DETECTED",
      "LAYOUT_UNRECOGNIZED",
      "DOWNLOAD_FAILED",
      "NOT_ATTEMPTED",
    ];
    const uploadOutcomes: RunSignals["uploadOutcome"][] = [undefined, "OK", "FAILED", "NOT_ATTEMPTED"];
    for (const paired of [true, false]) {
      for (const session of ["LOGGED_IN", "LOGGED_OUT", "AUTH_CHALLENGE"] as const) {
        for (const exportOutcome of exportOutcomes) {
          for (const uploadOutcome of uploadOutcomes) {
            expect(readinessStates.has(decideState({ paired, session, exportOutcome, uploadOutcome }))).toBe(false);
          }
        }
      }
    }
  });
});
