import { describe, expect, it } from "vitest";
import { hasLiveRunApproval, APPROVAL_FLAG } from "../../src/cli/live-run-approval";
import {
  classifyOnlyStatus,
  proceedAfterConfirmation,
  SAME_SESSION_CONFIRM_PROMPT,
} from "../../src/cli/same-session";
import type { ExportOutcome, SessionState } from "../../src/status";

describe("same-session: live approval is required", () => {
  // The same-session CLI guards every live action with the shared approval flag.
  it("is false without the approval flag", () => {
    expect(hasLiveRunApproval([])).toBe(false);
    expect(hasLiveRunApproval(["--discover-same-session"])).toBe(false);
  });

  it("is true only with the explicit approval flag", () => {
    expect(hasLiveRunApproval([APPROVAL_FLAG])).toBe(true);
  });
});

describe("proceedAfterConfirmation", () => {
  it("proceeds only on explicit confirmation", () => {
    expect(proceedAfterConfirmation("confirmed")).toBe(true);
  });

  it("never proceeds on timeout", () => {
    expect(proceedAfterConfirmation("timeout")).toBe(false);
  });
});

describe("SAME_SESSION_CONFIRM_PROMPT", () => {
  it("instructs the human to keep the browser open and press Enter, with no PII", () => {
    expect(SAME_SESSION_CONFIRM_PROMPT).toMatch(/press Enter/i);
    expect(SAME_SESSION_CONFIRM_PROMPT).toMatch(/Do NOT close the browser/i);
    expect(SAME_SESSION_CONFIRM_PROMPT).toMatch(/SmartStore Center/i);
  });
});

describe("classifyOnlyStatus", () => {
  it("LOGGED_OUT after confirmation → SESSION_EXPIRED", () => {
    expect(classifyOnlyStatus("LOGGED_OUT").state).toBe("SESSION_EXPIRED");
  });

  it("AUTH_CHALLENGE after confirmation → ACTION_REQUIRED_FOR_2FA_OR_CAPTCHA", () => {
    expect(classifyOnlyStatus("AUTH_CHALLENGE").state).toBe("ACTION_REQUIRED_FOR_2FA_OR_CAPTCHA");
  });

  it("LOGGED_IN + CAPTURED → COLLECTING (capture is not success without upload)", () => {
    const { state, detail } = classifyOnlyStatus("LOGGED_IN", "CAPTURED");
    expect(state).toBe("COLLECTING");
    expect(detail).toMatch(/not captured to disk, not uploaded/);
  });

  it("LOGGED_IN + ASYNC_JOB_DETECTED → EXPORT_ASYNC_JOB_DETECTED", () => {
    expect(classifyOnlyStatus("LOGGED_IN", "ASYNC_JOB_DETECTED").state).toBe("EXPORT_ASYNC_JOB_DETECTED");
  });

  it("LOGGED_IN + LAYOUT_UNRECOGNIZED → EXPORT_LAYOUT_CHANGED", () => {
    expect(classifyOnlyStatus("LOGGED_IN", "LAYOUT_UNRECOGNIZED").state).toBe("EXPORT_LAYOUT_CHANGED");
  });

  it("LOGGED_IN + DOWNLOAD_FAILED → DOWNLOAD_FAILED", () => {
    expect(classifyOnlyStatus("LOGGED_IN", "DOWNLOAD_FAILED").state).toBe("DOWNLOAD_FAILED");
  });

  it("LOGGED_IN with no export attempted → CONNECTED", () => {
    expect(classifyOnlyStatus("LOGGED_IN").state).toBe("CONNECTED");
  });
});

describe("classify-only never reports success (LAST_SUCCESS impossible)", () => {
  const sessions: SessionState[] = ["LOGGED_IN", "LOGGED_OUT", "AUTH_CHALLENGE"];
  const outcomes: Array<ExportOutcome | undefined> = [
    undefined,
    "CAPTURED",
    "ASYNC_JOB_DETECTED",
    "LAYOUT_UNRECOGNIZED",
    "DOWNLOAD_FAILED",
    "NOT_ATTEMPTED",
  ];

  for (const session of sessions) {
    for (const outcome of outcomes) {
      it(`session=${session} export=${outcome ?? "none"} is never LAST_SUCCESS / UPLOAD_FAILED`, () => {
        const { state } = classifyOnlyStatus(session, outcome);
        expect(state).not.toBe("LAST_SUCCESS");
        expect(state).not.toBe("UPLOAD_FAILED");
      });
    }
  }
});
