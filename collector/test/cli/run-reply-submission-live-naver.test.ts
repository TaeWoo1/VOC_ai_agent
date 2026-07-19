/**
 * Reply-submission CLI approval gate + run mode + abort watcher (pure). Proves `main()` can never launch a
 * live reply run without the reply-specific approval flag, refuses ANY export approval flag, refuses
 * production, and that the abort watcher is armed from process start. Importing the module launches nothing
 * (`main()` runs only when invoked directly). The submissionRef/hint intake lives in the reply-target BUNDLE
 * (see `reply-target-bundle.test.ts`) — it is no longer an argv/CLI concern.
 */
import { describe, it, expect } from "vitest";
import { APPROVAL_FLAG, REPLY_APPROVAL_FLAG } from "../../src/cli/live-run-approval";
import {
  EXPORT_FLAG_MISUSE_EXIT_CODE,
  currentKstDate,
  replyLiveRunRefusal,
  replyRunModeFrom,
  watchForAbort,
  type AbortWatchDeps,
} from "../../src/cli/run-reply-submission-live-naver";

const REF = "a1b2c3d4e5f60718";

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

describe("replyRunModeFrom", () => {
  it("selects ABORT_REHEARSAL only with the flag; defaults to FULL_SUBMIT", () => {
    expect(replyRunModeFrom(["--abort-rehearsal"])).toBe("ABORT_REHEARSAL");
    expect(replyRunModeFrom([])).toBe("FULL_SUBMIT");
    expect(replyRunModeFrom([REPLY_APPROVAL_FLAG])).toBe("FULL_SUBMIT");
  });
});

describe("currentKstDate (CLI-boundary wall-clock)", () => {
  it("returns a YYYY-MM-DD KST calendar date", () => {
    expect(currentKstDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("watchForAbort — ABORT_REHEARSAL abort watcher (armed from process start)", () => {
  const ABORTED = "/x/.status/reply-aborted.ready";

  /**
   * Build injectable deps. `existsAfter` = number of polls before the aborted sentinel "appears"
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
