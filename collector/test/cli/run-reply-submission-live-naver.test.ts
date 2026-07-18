/**
 * Reply-submission CLI approval gate (pure) — proves `main()` can never launch a live reply run without
 * the reply-specific approval flag, refuses ANY export approval flag, and refuses production. Importing
 * the module launches nothing (`main()` runs only when invoked directly).
 */
import { describe, it, expect } from "vitest";
import { APPROVAL_FLAG, REPLY_APPROVAL_FLAG } from "../../src/cli/live-run-approval";
import {
  EXPORT_FLAG_MISUSE_EXIT_CODE,
  loadTargetHint,
  replyLiveRunRefusal,
  replyRunModeFrom,
  submissionRefFrom,
  TargetHintError,
  watchForAbort,
  type AbortWatchDeps,
  type HintFileDeps,
} from "../../src/cli/run-reply-submission-live-naver";

const REF = "a1b2c3d4e5f60718";

/** Build an injected fs surface returning a single owner-only hint file with the given JSON body. */
function hintDeps(body: string, mode = 0o600, exists = true): HintFileDeps {
  return {
    existsSync: () => exists,
    statSync: () => ({ mode }),
    readFileSync: () => body,
  };
}

function validHintBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ submissionRef: REF, rating: 2, recencyBucket: "THIS_WEEK", bodyFingerprint: "fp_match_0001", ...overrides });
}

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

describe("replyRunModeFrom", () => {
  it("selects ABORT_REHEARSAL only with the flag; defaults to FULL_SUBMIT", () => {
    expect(replyRunModeFrom(["--abort-rehearsal"])).toBe("ABORT_REHEARSAL");
    expect(replyRunModeFrom([])).toBe("FULL_SUBMIT");
    expect(replyRunModeFrom(["--submission-ref", REF])).toBe("FULL_SUBMIT");
  });
});

describe("loadTargetHint — permission-restricted, bound, file-only intake (never argv)", () => {
  const P = "/x/.reply-target/hint.json";

  it("returns the minimal privacy-safe hint on a valid, owner-only, bound file — never the submissionRef", () => {
    const hint = loadTargetHint(P, REF, hintDeps(validHintBody()));
    expect(hint).toEqual({ rating: 2, recencyBucket: "THIS_WEEK", bodyFingerprint: "fp_match_0001" });
    // The binding submissionRef must NOT survive into the hint passed onward to engine/driver.
    expect(Object.keys(hint ?? {}).sort()).toEqual(["bodyFingerprint", "rating", "recencyBucket"]);
  });

  it("absent file → null (legacy composer-only path in FULL_SUBMIT)", () => {
    expect(loadTargetHint(P, REF, hintDeps("", 0o600, false))).toBeNull();
  });

  it("fails closed PERMS when the file is group/world-readable", () => {
    expect(() => loadTargetHint(P, REF, hintDeps(validHintBody(), 0o644))).toThrow(TargetHintError);
    try { loadTargetHint(P, REF, hintDeps(validHintBody(), 0o640)); } catch (e) { expect((e as TargetHintError).code).toBe("PERMS"); }
  });

  it("fails closed MALFORMED on non-JSON", () => {
    try { loadTargetHint(P, REF, hintDeps("{not json")); expect.fail("should throw"); }
    catch (e) { expect((e as TargetHintError).code).toBe("MALFORMED"); }
  });

  it("fails closed BIND_MISMATCH when the file's submissionRef is not this run's", () => {
    try { loadTargetHint(P, REF, hintDeps(validHintBody({ submissionRef: "ffffffffffffffff" }))); expect.fail("should throw"); }
    catch (e) { expect((e as TargetHintError).code).toBe("BIND_MISMATCH"); }
  });

  it("fails closed SCHEMA on a bad rating / bucket / fingerprint", () => {
    for (const bad of [{ rating: 9 }, { rating: 0 }, { recencyBucket: "SOON" }, { bodyFingerprint: "" }]) {
      try { loadTargetHint(P, REF, hintDeps(validHintBody(bad))); expect.fail(`should throw for ${JSON.stringify(bad)}`); }
      catch (e) { expect((e as TargetHintError).code, JSON.stringify(bad)).toBe("SCHEMA"); }
    }
  });
});

describe("watchForAbort — ABORT_REHEARSAL abort watcher (armed from process start)", () => {
  const ABORTED = "/x/.status/reply-aborted.ready";

  /**
   * Build injectable deps. `existsSyncAfter` = number of polls before the aborted sentinel "appears"
   * (0 = present on the very first check; Infinity = never). `sleep` is a no-op that counts calls, so the
   * poll loop runs deterministically without real timers.
   */
  function watchDeps(existsAfter: number): { deps: AbortWatchDeps; sleeps: () => number } {
    let checks = 0;
    let sleeps = 0;
    const deps: AbortWatchDeps = {
      existsSync: () => existsAfter <= checks++,
      sleep: () => { sleeps += 1; return Promise.resolve(); },
    };
    return { deps, sleeps: () => sleeps };
  }

  it("sends the abort and returns 'aborted' when the sentinel is present while non-terminal", async () => {
    let sent = 0;
    const { deps } = watchDeps(0); // sentinel present on the first check
    const out = await watchForAbort(ABORTED, 10_000, 750, () => { sent += 1; }, () => false, deps);
    expect(out).toBe("aborted");
    expect(sent).toBe(1);
  });

  it("returns 'terminal' and never sends an abort when the run is already terminal", async () => {
    let sent = 0;
    const { deps } = watchDeps(0); // sentinel would be present, but terminal is checked first
    const out = await watchForAbort(ABORTED, 10_000, 750, () => { sent += 1; }, () => true, deps);
    expect(out).toBe("terminal");
    expect(sent).toBe(0);
  });

  it("checks terminal BEFORE the sentinel — a run that terminated on its own gets no late abort", async () => {
    // Both signals true on the same iteration: terminal must win, so the run is never aborted post-hoc.
    let sent = 0;
    const bothPresent: AbortWatchDeps = { existsSync: () => true, sleep: () => Promise.resolve() };
    const out = await watchForAbort(ABORTED, 10_000, 750, () => { sent += 1; }, () => true, bothPresent);
    expect(out).toBe("terminal");
    expect(sent).toBe(0);
  });

  it("returns null and never aborts when the window lapses with no sentinel and no terminal", async () => {
    let sent = 0;
    const { deps, sleeps } = watchDeps(Number.POSITIVE_INFINITY); // sentinel never appears
    const out = await watchForAbort(ABORTED, 3_000, 1_000, () => { sent += 1; }, () => false, deps);
    expect(out).toBeNull();
    expect(sent).toBe(0);
    expect(sleeps()).toBe(3); // maxChecks = ceil(3000/1000) = 3 poll intervals
  });

  it("polls until the sentinel appears (armed from start), then aborts exactly once", async () => {
    let sent = 0;
    const { deps } = watchDeps(2); // absent on checks 0 and 1, present on check 2
    const out = await watchForAbort(ABORTED, 10_000, 750, () => { sent += 1; }, () => false, deps);
    expect(out).toBe("aborted");
    expect(sent).toBe(1);
  });

  it("always runs at least one check even when the window is sub-interval", async () => {
    let sent = 0;
    const { deps } = watchDeps(0); // present immediately
    const out = await watchForAbort(ABORTED, 1, 10_000, () => { sent += 1; }, () => false, deps);
    expect(out).toBe("aborted"); // maxChecks floored to 1, and that one check sees the sentinel
    expect(sent).toBe(1);
  });
});
