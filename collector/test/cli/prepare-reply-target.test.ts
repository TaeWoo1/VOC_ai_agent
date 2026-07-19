/**
 * prepare-reply-target — the pure, offline-testable pieces: mapping a guided submission-run response into the
 * result bundle (guarded so a hint-less response never writes a partial bundle) and the request-bundle
 * refusal copy. `main()` is never invoked (it runs only when the module is the entrypoint), so importing this
 * file makes no backend call and launches nothing.
 */
import { describe, it, expect } from "vitest";
import {
  REQUEST_BUNDLE_REFUSAL_EXIT_CODE,
  requestBundleRefusal,
  resultBundleFrom,
} from "../../src/cli/prepare-reply-target";
import type { SubmissionRunResponse } from "../../src/upload";

const RESP: SubmissionRunResponse = {
  actionRef: "review:abc",
  submissionRef: "a1b2c3d4e5f60718",
  approvedVersion: 1,
  targetHint: { rating: 2, recencyBucket: "THIS_WEEK", bodyFingerprint: "a".repeat(64) },
  asOfDate: "2026-05-12",
};

describe("prepare-reply-target — resultBundleFrom", () => {
  it("maps a guided submission-run response into the result bundle", () => {
    expect(resultBundleFrom(RESP)).toEqual({
      submissionRef: "a1b2c3d4e5f60718",
      rating: 2,
      recencyBucket: "THIS_WEEK",
      bodyFingerprint: "a".repeat(64),
      asOfDate: "2026-05-12",
    });
  });

  it("throws when the backend returned no hint / no asOfDate (never writes a partial bundle)", () => {
    expect(() => resultBundleFrom({ ...RESP, targetHint: null })).toThrow();
    expect(() => resultBundleFrom({ ...RESP, asOfDate: null })).toThrow();
  });
});

describe("prepare-reply-target — requestBundleRefusal", () => {
  it("explains each refusal and names the path without printing a field value", () => {
    for (const code of ["PERMS", "MALFORMED", "SCHEMA"] as const) {
      expect(requestBundleRefusal(code, "/x/.reply-target/request.json")).toContain(
        "/x/.reply-target/request.json",
      );
    }
    expect(REQUEST_BUNDLE_REFUSAL_EXIT_CODE).toBe(5);
  });
});
