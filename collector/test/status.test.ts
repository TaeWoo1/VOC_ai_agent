import { describe, expect, it } from "vitest";
import { decideState, type RunSignals } from "../src/status";

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
    ];
    for (const s of noSuccess) {
      expect(decideState(s)).not.toBe("LAST_SUCCESS");
    }
  });
});
