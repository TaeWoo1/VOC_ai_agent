/**
 * Read-only reply-target discovery — pure classifier + census adapter + optional expected-hint loader.
 * Importing the module launches nothing (`main()` runs only when invoked directly). Every assertion is
 * offline/synthetic: no live NAVER, no browser, no disk. Proves the summary is counts/booleans/enums/
 * opaque-signatures only, that discovery reuses the runtime's match rule, and that the fingerprint
 * normalization gap surfaces as a stable blocker code rather than a silent pass.
 */
import { describe, it, expect } from "vitest";
import {
  censusToRows,
  classifyReviewRowStructure,
  expectedHintPathFrom,
  ExpectedHintError,
  loadExpectedHint,
  runConfirmedCensus,
  sentinelModeFrom,
  settleRowCensus,
  type DiscoveredRowSignal,
  type ExpectedHintFileDeps,
  type RowCensus,
  type RowCensusEntry,
} from "../../src/cli/discover-reply-target";
import type { ReplyTargetHint } from "../../src/action-window/reply-submission/reply-surface";

const HINT: ReplyTargetHint = { rating: 2, recencyBucket: "THIS_WEEK", bodyFingerprint: "fp_match_0001" };

function entry(o: Partial<RowCensusEntry> = {}): RowCensusEntry {
  return { hasRatingNode: true, hasDateNode: true, hasBodyNode: true, ...o };
}

/** A discovery-shaped row: structural presence known, VALUES unknown (rating/bucket/fingerprint null). */
function discovered(o: Partial<DiscoveredRowSignal> = {}): DiscoveredRowSignal {
  return {
    rating: null,
    recencyBucket: null,
    bodyFingerprint: null,
    hasRatingNode: true,
    hasDateNode: true,
    hasBodyNode: true,
    ...o,
  };
}

function hintFileDeps(body: string, mode = 0o600, exists = true): ExpectedHintFileDeps {
  return { existsSync: () => exists, statSync: () => ({ mode }), readFileSync: () => body };
}

function validBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ rating: 2, recencyBucket: "THIS_WEEK", bodyFingerprint: "fp_match_0001", ...overrides });
}

describe("censusToRows — sanitized in-page census → per-row signals (fail-closed)", () => {
  it("returns [] when no generic container group matched (selectorKind null)", () => {
    expect(censusToRows({ selectorKind: null, candidateCount: 0, perRow: [] })).toEqual([]);
  });

  it("maps structural presence through, leaving values (rating/bucket/fingerprint) null during discovery", () => {
    const census: RowCensus = {
      selectorKind: 1,
      candidateCount: 2,
      perRow: [entry(), entry({ hasRatingNode: false, hasDateNode: false, hasBodyNode: false })],
    };
    const rows = censusToRows(census);
    expect(rows).toEqual([
      { rating: null, recencyBucket: null, bodyFingerprint: null, hasRatingNode: true, hasDateNode: true, hasBodyNode: true },
      { rating: null, recencyBucket: null, bodyFingerprint: null, hasRatingNode: false, hasDateNode: false, hasBodyNode: false },
    ]);
  });
});

describe("classifyReviewRowStructure — safe summary (counts/booleans/opaque sigs only)", () => {
  it("counts structural presence and emits one opaque position sig per row", () => {
    const rows = [discovered(), discovered({ hasDateNode: false }), discovered({ hasBodyNode: false })];
    const s = classifyReviewRowStructure(rows, null, 1);
    expect(s.reviewRowCandidateCount).toBe(3);
    expect(s.selectorKind).toBe(1);
    expect(s.ratingNodePresentCount).toBe(3);
    expect(s.dateNodePresentCount).toBe(2);
    expect(s.bodyNodePresentCount).toBe(2);
    expect(s.structuralRowSigs).toHaveLength(3);
    // Opaque 16-hex, position-only — carries no content and no hint field.
    s.structuralRowSigs.forEach((sig) => expect(sig).toMatch(/^[0-9a-f]{16}$/));
    // Distinct positions → distinct signatures.
    expect(new Set(s.structuralRowSigs).size).toBe(3);
    expect(s.expectedHintProvided).toBe(false);
    expect(s.match).toBeNull();
  });

  it("emits NO_ROW_CANDIDATES + FINGERPRINT blocker on an empty page, no match without a hint", () => {
    const s = classifyReviewRowStructure([], null, null);
    expect(s.reviewRowCandidateCount).toBe(0);
    expect(s.blockers).toContain("NO_ROW_CANDIDATES");
    expect(s.blockers).toContain("FINGERPRINT_LIVE_EXTRACTION_DEFERRED");
    expect(s.match).toBeNull();
  });

  it("surfaces the deferred-value + missing-fingerprint blockers for a real discovery census (values null)", () => {
    const rows = [discovered(), discovered()];
    const s = classifyReviewRowStructure(rows, null, 0);
    expect(s.ratingValuePresentCount).toBe(0);
    expect(s.recencyBucketPresentCount).toBe(0);
    expect(s.fingerprintComputableCount).toBe(0);
    expect(s.blockers).toEqual(
      expect.arrayContaining([
        "RATING_VALUE_PARSE_DEFERRED",
        "RECENCY_BUCKET_DERIVATION_DEFERRED",
        "FINGERPRINT_LIVE_EXTRACTION_DEFERRED",
      ]),
    );
  });

  it("with a hint but only discovery-grade rows (values null): match runs but finds 0 — the blocker explains why", () => {
    const s = classifyReviewRowStructure([discovered(), discovered()], HINT, 0);
    expect(s.expectedHintProvided).toBe(true);
    expect(s.match).toEqual({ matchCount: 0, uniqueMatch: false, matchedRowSig: null });
    expect(s.blockers).toContain("FINGERPRINT_LIVE_EXTRACTION_DEFERRED");
  });

  it("reuses the runtime match rule: a uniquely-enriched matching row yields uniqueMatch + an opaque sig", () => {
    // Simulates the FUTURE state where extraction is enriched (rating/bucket/fingerprint filled). One row
    // matches the hint on all three keys; the summary reports a unique match with a position-only sig and
    // never echoes any hint value.
    const rows: DiscoveredRowSignal[] = [
      discovered({ rating: 5, recencyBucket: "OLDER", bodyFingerprint: "fp_other" }),
      discovered({ rating: 2, recencyBucket: "THIS_WEEK", bodyFingerprint: "fp_match_0001" }),
    ];
    const s = classifyReviewRowStructure(rows, HINT, 0);
    expect(s.fingerprintComputableCount).toBe(2);
    expect(s.match?.matchCount).toBe(1);
    expect(s.match?.uniqueMatch).toBe(true);
    expect(s.match?.matchedRowSig).toMatch(/^[0-9a-f]{16}$/);
    // No blocker for fingerprint or values once every row is enriched.
    expect(s.blockers).not.toContain("FINGERPRINT_LIVE_EXTRACTION_DEFERRED");
    expect(s.blockers).not.toContain("RATING_VALUE_PARSE_DEFERRED");
    const flat = JSON.stringify(s);
    expect(flat).not.toContain("fp_match_0001"); // the fingerprint value never surfaces in the summary
  });

  it("enriched but ambiguous (two rows match the hint) → matchCount 2, not unique, no sig", () => {
    const dup: DiscoveredRowSignal = discovered({ rating: 2, recencyBucket: "THIS_WEEK", bodyFingerprint: "fp_match_0001" });
    const s = classifyReviewRowStructure([dup, { ...dup }], HINT, 0);
    expect(s.match).toEqual({ matchCount: 2, uniqueMatch: false, matchedRowSig: null });
  });
});

/* ───────────────────────────── Row-census settle (bounded poll) ───────────────────────────── */

function emptyCensus(): RowCensus {
  return { selectorKind: null, candidateCount: 0, perRow: [] };
}
function populatedCensus(n: number): RowCensus {
  return { selectorKind: 1, candidateCount: n, perRow: Array.from({ length: n }, () => entry()) };
}
/** A scripted census reader: returns each element in turn, then repeats the last one forever. */
function scriptedReader(seq: readonly RowCensus[]): { read: () => Promise<RowCensus>; calls: () => number } {
  let i = 0;
  return {
    read: () => {
      const c = seq[Math.min(i, seq.length - 1)]!;
      i += 1;
      return Promise.resolve(c);
    },
    calls: () => i,
  };
}
/** A fake sleep that never actually waits but records each requested interval. */
function recordingSleep(): { sleep: (ms: number) => Promise<void>; waits: number[] } {
  const waits: number[] = [];
  return { sleep: (ms) => { waits.push(ms); return Promise.resolve(); }, waits };
}

describe("settleRowCensus — bounded read-only poll before the census (SPA hydration)", () => {
  it("captures rows that appear only after a few polls, reporting outcome 'settled'", async () => {
    const reader = scriptedReader([emptyCensus(), emptyCensus(), populatedCensus(3)]);
    const clk = recordingSleep();
    const r = await settleRowCensus({ readCensus: reader.read, sleep: clk.sleep }, { intervalMs: 500, timeoutMs: 15_000 });
    expect(r.outcome).toBe("settled");
    expect(r.census.candidateCount).toBe(3);
    expect(r.attempts).toBe(3);
    expect(clk.waits).toEqual([500, 500]); // slept between reads, and NOT after the successful read
    // Feeds the classifier to a real, non-timeout summary — no false-empty blocker.
    const s = classifyReviewRowStructure(censusToRows(r.census), null, r.census.selectorKind, r.outcome === "timeout");
    expect(s.reviewRowCandidateCount).toBe(3);
    expect(s.blockers).not.toContain("ROW_CENSUS_SETTLE_TIMEOUT");
    expect(s.blockers).not.toContain("NO_ROW_CANDIDATES");
  });

  it("returns immediately (no sleep) when rows are already present on the first read", async () => {
    const reader = scriptedReader([populatedCensus(2)]);
    const clk = recordingSleep();
    const r = await settleRowCensus({ readCensus: reader.read, sleep: clk.sleep }, { intervalMs: 500, timeoutMs: 15_000 });
    expect(r.outcome).toBe("settled");
    expect(r.attempts).toBe(1);
    expect(clk.waits).toEqual([]);
  });

  it("fails closed with outcome 'timeout' when no rows ever appear within the budget", async () => {
    const reader = scriptedReader([emptyCensus()]); // always empty
    const clk = recordingSleep();
    const r = await settleRowCensus({ readCensus: reader.read, sleep: clk.sleep }, { intervalMs: 500, timeoutMs: 1500 });
    expect(r.outcome).toBe("timeout");
    expect(r.census.candidateCount).toBe(0);
    expect(clk.waits).toEqual([500, 500, 500]); // budget 1500 / interval 500 → 3 sleeps, 4 reads
    expect(r.attempts).toBe(4);
    // Fails closed in the summary: both the settle-timeout and no-candidates blockers surface.
    const s = classifyReviewRowStructure(censusToRows(r.census), null, r.census.selectorKind, r.outcome === "timeout");
    expect(s.reviewRowCandidateCount).toBe(0);
    expect(s.blockers).toContain("ROW_CENSUS_SETTLE_TIMEOUT");
    expect(s.blockers).toContain("NO_ROW_CANDIDATES");
  });

  it("settle→classify emits sanitized keys only (counts/booleans/enums/opaque sigs) — no raw content", async () => {
    const reader = scriptedReader([emptyCensus(), populatedCensus(2)]);
    const r = await settleRowCensus({ readCensus: reader.read, sleep: () => Promise.resolve() }, { intervalMs: 10, timeoutMs: 1000 });
    const s = classifyReviewRowStructure(censusToRows(r.census), null, r.census.selectorKind, r.outcome === "timeout");
    expect(Object.keys(s).sort()).toEqual([
      "blockers", "bodyNodePresentCount", "dateNodePresentCount", "expectedHintProvided",
      "fingerprintComputableCount", "match", "ratingNodePresentCount",
      "ratingValuePresentCount", "recencyBucketPresentCount", "reviewRowCandidateCount", "selectorKind",
      "structuralRowSigs",
    ]);
    s.structuralRowSigs.forEach((sig) => expect(sig).toMatch(/^[0-9a-f]{16}$/));
  });
});

describe("classifyReviewRowStructure — settle-timeout blocker (opt-in flag, existing callers unchanged)", () => {
  it("surfaces ROW_CENSUS_SETTLE_TIMEOUT alongside NO_ROW_CANDIDATES when the settle timed out", () => {
    const s = classifyReviewRowStructure([], null, null, true);
    expect(s.blockers).toContain("ROW_CENSUS_SETTLE_TIMEOUT");
    expect(s.blockers).toContain("NO_ROW_CANDIDATES");
  });

  it("omits ROW_CENSUS_SETTLE_TIMEOUT by default — the flag defaults false, so 3-arg callers are unchanged", () => {
    const s = classifyReviewRowStructure([discovered()], null, 1);
    expect(s.blockers).not.toContain("ROW_CENSUS_SETTLE_TIMEOUT");
  });
});

describe("loadExpectedHint — owner-only, schema-validated, no submissionRef binding", () => {
  const P = "/x/.reply-target/hint.json";

  it("returns only the three privacy-safe match fields on a valid owner-only file", () => {
    expect(loadExpectedHint(P, hintFileDeps(validBody()))).toEqual({
      rating: 2,
      recencyBucket: "THIS_WEEK",
      bodyFingerprint: "fp_match_0001",
    });
  });

  it("ignores an extraneous submissionRef (discovery is not a bound run)", () => {
    const hint = loadExpectedHint(P, hintFileDeps(validBody({ submissionRef: "ffffffffffffffff" })));
    expect(Object.keys(hint ?? {}).sort()).toEqual(["bodyFingerprint", "rating", "recencyBucket"]);
  });

  it("absent file → null (structure still classifiable, just no match)", () => {
    expect(loadExpectedHint(P, hintFileDeps("", 0o600, false))).toBeNull();
  });

  it("fails closed PERMS when group/world-readable", () => {
    expect(() => loadExpectedHint(P, hintFileDeps(validBody(), 0o644))).toThrow(ExpectedHintError);
    try { loadExpectedHint(P, hintFileDeps(validBody(), 0o640)); } catch (e) { expect((e as ExpectedHintError).code).toBe("PERMS"); }
  });

  it("fails closed MALFORMED on non-JSON", () => {
    try { loadExpectedHint(P, hintFileDeps("{not json")); expect.fail("should throw"); }
    catch (e) { expect((e as ExpectedHintError).code).toBe("MALFORMED"); }
  });

  it("fails closed SCHEMA on a bad rating / bucket / fingerprint", () => {
    for (const bad of [{ rating: 9 }, { rating: 0 }, { recencyBucket: "SOON" }, { bodyFingerprint: "" }]) {
      try { loadExpectedHint(P, hintFileDeps(validBody(bad))); expect.fail(`should throw for ${JSON.stringify(bad)}`); }
      catch (e) { expect((e as ExpectedHintError).code, JSON.stringify(bad)).toBe("SCHEMA"); }
    }
  });
});

describe("expectedHintPathFrom", () => {
  it("extracts the path after the flag; null when absent or dangling", () => {
    expect(expectedHintPathFrom(["--expected-hint", ".reply-target/hint.json"])).toBe(".reply-target/hint.json");
    expect(expectedHintPathFrom([])).toBeNull();
    expect(expectedHintPathFrom(["--expected-hint", "--discover"])).toBeNull(); // next token is a flag
  });
});

/* ─────────────── Same-session sentinel gate (read-only hand-off) ─────────────── */

const SENTINEL = "/tmp/does-not-matter/.status/probe-same-session.ready";

/** A fake fs whose sentinel appears only after `appearsAfter` existence checks *following* removal. */
function fakeSentinelFs(opts: { staleAtStart?: boolean; appearsAfterChecks?: number } = {}) {
  const events: string[] = [];
  let present = opts.staleAtStart === true;
  let checks = 0;
  return {
    events,
    checks: () => checks,
    deps: {
      existsFile: (_p: string) => {
        checks += 1;
        if (opts.appearsAfterChecks !== undefined && checks > opts.appearsAfterChecks) present = true;
        events.push(`exists:${present}`);
        return present;
      },
      removeFile: (_p: string) => {
        present = false;
        events.push("remove");
      },
      sleep: () => {
        events.push("sleep");
        return Promise.resolve();
      },
    },
  };
}

describe("sentinelModeFrom — opt-in flag vocabulary", () => {
  it("is off by default, so existing non-sentinel dispatches are unchanged", () => {
    expect(sentinelModeFrom([])).toBe(false);
    expect(sentinelModeFrom(["--discover", "--classify-only", "--i-understand-this-opens-live-naver"])).toBe(false);
  });

  it("opts in via --require-sentinel or --sentinel, and --no-sentinel overrides both", () => {
    expect(sentinelModeFrom(["--require-sentinel"])).toBe(true);
    expect(sentinelModeFrom(["--sentinel"])).toBe(true);
    expect(sentinelModeFrom(["--require-sentinel", "--no-sentinel"])).toBe(false);
    expect(sentinelModeFrom(["--sentinel", "--no-sentinel"])).toBe(false);
  });
});

describe("runConfirmedCensus — the census runs ONLY after a verified press", () => {
  it("never reads the page when nobody presses", async () => {
    let censusCalls = 0;
    const r = await runConfirmedCensus(
      () => Promise.resolve("timeout" as const),
      () => {
        censusCalls += 1;
        return Promise.resolve("read");
      },
    );
    expect(r).toEqual({ outcome: "timeout" });
    expect(censusCalls).toBe(0);
  });

  it("**an ABORT reads nothing either** — only `ready` is a confirmation", async () => {
    // The gate now takes an operator confirmation, whose signal has three values. Anything that is not a
    // verified press must leave the page unread, and `!== "ready"` is what makes that true by construction.
    let censusCalls = 0;
    const r = await runConfirmedCensus(
      () => Promise.resolve("abort" as const),
      () => {
        censusCalls += 1;
        return Promise.resolve("read");
      },
    );
    expect(r).toEqual({ outcome: "timeout" });
    expect(censusCalls).toBe(0);
  });

  it("reads the page only after the gate reports ready (ordering is observable)", async () => {
    const order: string[] = [];
    const r = await runConfirmedCensus(
      async () => {
        order.push("gate");
        return "ready" as const;
      },
      async () => {
        order.push("census");
        return "summary";
      },
    );
    expect(order).toEqual(["gate", "census"]);
    expect(r).toEqual({ outcome: "ready", result: "summary" });
  });

  it("the gated result is the unchanged sanitized summary — the hand-off adds no new output", async () => {
    const summary = classifyReviewRowStructure([discovered()], null, 2, false);
    const r = await runConfirmedCensus(() => Promise.resolve("ready" as const), () => Promise.resolve(summary));
    expect(r.outcome).toBe("ready");
    expect(r.outcome === "ready" && Object.keys(r.result).sort()).toEqual([
      "blockers", "bodyNodePresentCount", "dateNodePresentCount", "expectedHintProvided",
      "fingerprintComputableCount", "match", "ratingNodePresentCount",
      "ratingValuePresentCount", "recencyBucketPresentCount", "reviewRowCandidateCount", "selectorKind",
      "structuralRowSigs",
    ]);
  });
});
