/**
 * Reply-submission CLI approval gate (pure) — proves `main()` can never launch a live reply run without
 * the reply-specific approval flag, refuses ANY export approval flag, and refuses production. Importing
 * the module launches nothing (`main()` runs only when invoked directly).
 */
import { describe, it, expect } from "vitest";
import { APPROVAL_FLAG, REPLY_APPROVAL_FLAG } from "../../src/cli/live-run-approval";
import {
  EXPORT_FLAG_MISUSE_EXIT_CODE,
  replyLiveRunRefusal,
  submissionRefFrom,
} from "../../src/cli/run-reply-submission-live-naver";

describe("replyLiveRunRefusal (pure gate)", () => {
  it("refuses with exit 3 when no approval flag is present", () => {
    expect(replyLiveRunRefusal([], {})).toEqual({ reason: expect.any(String), exitCode: 3 });
  });

  it("refuses the EXPORT approval flag with a corrected-model message (exit 6)", () => {
    const refusal = replyLiveRunRefusal([APPROVAL_FLAG], {});
    expect(refusal?.exitCode).toBe(EXPORT_FLAG_MISUSE_EXIT_CODE);
    expect(refusal?.reason).toContain(REPLY_APPROVAL_FLAG);
  });

  it("refuses the export flag even alongside the reply flag (a confused invocation)", () => {
    expect(replyLiveRunRefusal([APPROVAL_FLAG, REPLY_APPROVAL_FLAG], {})?.exitCode).toBe(EXPORT_FLAG_MISUSE_EXIT_CODE);
  });

  it("refuses under NODE_ENV=production even with the reply flag (exit 4)", () => {
    expect(replyLiveRunRefusal([REPLY_APPROVAL_FLAG], { NODE_ENV: "production" })?.exitCode).toBe(4);
  });

  it("permits (null) with only the reply approval flag in a non-production env", () => {
    expect(replyLiveRunRefusal([REPLY_APPROVAL_FLAG], {})).toBeNull();
  });
});

describe("submissionRefFrom", () => {
  it("extracts a valid 16-hex binding", () => {
    expect(submissionRefFrom(["--submission-ref", "a1b2c3d4e5f60718"])).toBe("a1b2c3d4e5f60718");
  });
  it("rejects a malformed or absent binding", () => {
    expect(submissionRefFrom(["--submission-ref", "NOPE"])).toBeNull();
    expect(submissionRefFrom(["--submission-ref", "a1b2c3d4e5f6071"])).toBeNull(); // 15 chars
    expect(submissionRefFrom([])).toBeNull();
  });
});
