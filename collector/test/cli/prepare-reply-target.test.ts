/**
 * prepare-reply-target — the pure, offline-testable pieces: mapping a guided submission-run response into the
 * result bundle (guarded so a hint-less response never writes a partial bundle) and the request-bundle
 * refusal copy. `main()` is never invoked (it runs only when the module is the entrypoint), so importing this
 * file makes no backend call and launches nothing.
 */
import { describe, it, expect } from "vitest";
import {
  prepareReplyTarget,
  REQUEST_BUNDLE_REFUSAL_EXIT_CODE,
  requestBundleRefusal,
  RESULT_BUNDLE_EXISTS_EXIT_CODE,
  resultBundleFrom,
  type PrepareConfig,
  type PrepareDeps,
} from "../../src/cli/prepare-reply-target";
import { ReplyTargetBundleError } from "../../src/action-window/reply-submission/reply-target-bundle";
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

describe("prepareReplyTarget — reserve-before-mint (no-clobber orchestration)", () => {
  const CFG: PrepareConfig = {
    requestPath: "/x/.reply-target/request.json",
    resultPath: "/x/.reply-target/hint.json",
    baseUrl: "http://localhost:8080",
    email: "e",
    password: "p",
  };

  function spyDeps(over: Partial<PrepareDeps> = {}) {
    const calls = { reserve: 0, consume: 0, finalize: 0, discard: 0, login: 0, startRun: 0 };
    const deps: PrepareDeps = {
      loadRequest: () => ({ accountId: "acc", actionRef: "review:abc" }),
      reserve: () => { calls.reserve += 1; },
      consume: () => { calls.consume += 1; },
      finalize: () => { calls.finalize += 1; },
      discardReservation: () => { calls.discard += 1; },
      login: async () => { calls.login += 1; return "tok"; },
      startRun: async () => { calls.startRun += 1; return RESP; },
      onError: () => {},
      ...over,
    };
    return { deps, calls };
  }

  it("happy path: reserve → login → mint → finalize → consume, exit 0", async () => {
    const { deps, calls } = spyDeps();
    const out = await prepareReplyTarget(CFG, deps);
    expect(out).toEqual({ status: "OK", exitCode: 0 });
    expect(calls).toMatchObject({ reserve: 1, login: 1, startRun: 1, finalize: 1, consume: 1, discard: 0 });
  });

  it("an existing result bundle fails BEFORE the mint: no login, no startRun, request NOT consumed, exit 6", async () => {
    const { deps, calls } = spyDeps({ reserve: () => { throw new ReplyTargetBundleError("EXISTS"); } });
    const out = await prepareReplyTarget(CFG, deps);
    expect(out.status).toBe("RESULT_EXISTS");
    expect(out.exitCode).toBe(RESULT_BUNDLE_EXISTS_EXIT_CODE);
    expect(calls.login).toBe(0);
    expect(calls.startRun).toBe(0); // the mint NEVER happens
    expect(calls.finalize).toBe(0);
    expect(calls.consume).toBe(0); // the request bundle is preserved (untouched)
  });

  it("a mint failure after reserving releases the reservation and preserves the request for retry", async () => {
    const { deps, calls } = spyDeps({ startRun: async () => { throw new Error("network down"); } });
    const out = await prepareReplyTarget(CFG, deps);
    expect(out.status).toBe("PREPARE_FAILED");
    expect(calls.discard).toBe(1); // reservation released so a retry can re-reserve
    expect(calls.finalize).toBe(0);
    expect(calls.consume).toBe(0); // request preserved
  });
});
