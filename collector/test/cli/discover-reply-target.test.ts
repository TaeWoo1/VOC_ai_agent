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
