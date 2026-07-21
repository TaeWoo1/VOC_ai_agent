/**
 * The exact review-row locator — the five outcomes the milestone requires (exact match, zero match, duplicate
 * match, malformed id, secondary-assertion mismatch) plus the context binding and the rung-precedence rule.
 *
 * Deterministic and offline: no browser, no fs, no clock. Candidates are constructed directly, exactly as the
 * in-page ladder would hand them over — fingerprints only, never a raw id.
 */
import { describe, it, expect } from "vitest";
import {
  ROW_MATCH_MODES,
  buildReviewIdLocatorKey,
  locateRowByReviewId,
  reviewIdLocatorKeyFromFingerprint,
  type LiveRowCandidate,
  type ReviewIdSource,
} from "../../../src/action-window/reply-submission/review-id-locator";
import { channelReviewIdFingerprint } from "../../../src/action-window/reply-submission/review-id-fingerprint";

const CHANNEL = "naver";
const ACCOUNT = "acct-0001";
const TARGET_ID = "1234567890";
const OTHER_ID = "9876543210";
const TARGET_FP = channelReviewIdFingerprint(TARGET_ID)!;
const OTHER_FP = channelReviewIdFingerprint(OTHER_ID)!;
const CONTEXT = { channel: CHANNEL, sellerAccountId: ACCOUNT };

function row(
  rowIndex: number,
  fingerprints: readonly { source: ReviewIdSource; fingerprint: string }[],
  secondary?: LiveRowCandidate["secondary"],
): LiveRowCandidate {
  return { rowIndex, idFingerprints: fingerprints, secondary };
}
const key = () => buildReviewIdLocatorKey(CHANNEL, ACCOUNT, TARGET_ID)!;

describe("locateRowByReviewId — exactly one match, or nothing", () => {
  it("EXACT MATCH: one row carries the identity, and it is reported with the rung it came from", () => {
    const outcome = locateRowByReviewId(key(), CONTEXT, [
      row(0, [{ source: "data-attribute", fingerprint: OTHER_FP }]),
      row(1, [{ source: "data-attribute", fingerprint: TARGET_FP }]),
      row(2, [{ source: "data-attribute", fingerprint: OTHER_FP }]),
    ]);
    expect(outcome).toMatchObject({ matched: true, rowIndex: 1, source: "data-attribute", matchCount: 1 });
    expect(outcome.matched && outcome.mode).toBe("channel-review-id");
  });

  it("ZERO MATCH: no row carries the identity — fails closed rather than picking the closest", () => {
    const outcome = locateRowByReviewId(key(), CONTEXT, [
      row(0, [{ source: "visible-text", fingerprint: OTHER_FP }]),
      row(1, [{ source: "anchor-href", fingerprint: OTHER_FP }]),
    ]);
    expect(outcome).toEqual({ matched: false, reason: "ZERO_MATCH", matchCount: 0 });
  });

  it("ZERO MATCH: an empty candidate set is a failure, never a vacuous success", () => {
    expect(locateRowByReviewId(key(), CONTEXT, [])).toEqual({
      matched: false,
      reason: "ZERO_MATCH",
      matchCount: 0,
    });
  });

  it("DUPLICATE MATCH: two rows carry the identity — ambiguous, so no row is claimed", () => {
    const outcome = locateRowByReviewId(key(), CONTEXT, [
      row(0, [{ source: "anchor-href", fingerprint: TARGET_FP }]),
      row(1, [{ source: "anchor-href", fingerprint: OTHER_FP }]),
      row(2, [{ source: "anchor-href", fingerprint: TARGET_FP }]),
    ]);
    expect(outcome).toEqual({ matched: false, reason: "MULTIPLE_MATCH", matchCount: 2 });
  });

  it("a duplicate at an earlier rung is NOT rescued by a unique hit at a later rung", () => {
    const outcome = locateRowByReviewId(key(), CONTEXT, [
      row(0, [{ source: "visible-text", fingerprint: TARGET_FP }]),
      row(1, [
        { source: "visible-text", fingerprint: TARGET_FP },
        { source: "data-attribute", fingerprint: TARGET_FP },
      ]),
    ]);
    expect(outcome).toEqual({ matched: false, reason: "MULTIPLE_MATCH", matchCount: 2 });
  });

  it("one row matching the identity at several rungs is still one row", () => {
    const outcome = locateRowByReviewId(key(), CONTEXT, [
      row(0, [
        { source: "anchor-href", fingerprint: TARGET_FP },
        { source: "data-attribute", fingerprint: TARGET_FP },
      ]),
    ]);
    expect(outcome).toMatchObject({ matched: true, rowIndex: 0, source: "anchor-href" });
  });

  it("TWO ROWS AT DIFFERENT RUNGS still fail closed — rung order must not narrow the candidate set", () => {
    // The live shape this guards: a summary/sticky panel prints the review number as TEXT while the real
    // list row carries it only in a data attribute. A rung-first search would happily return the panel.
    const outcome = locateRowByReviewId(key(), CONTEXT, [
      row(0, [{ source: "data-attribute", fingerprint: TARGET_FP }]),
      row(1, [{ source: "visible-text", fingerprint: TARGET_FP }]),
    ]);
    expect(outcome).toEqual({ matched: false, reason: "MULTIPLE_MATCH", matchCount: 2 });
  });

  it("rung order names the SOURCE of the one surviving row, and nothing else", () => {
    const outcome = locateRowByReviewId(key(), CONTEXT, [
      row(0, [
        { source: "data-attribute", fingerprint: TARGET_FP },
        { source: "visible-text", fingerprint: TARGET_FP },
      ]),
      row(1, [{ source: "visible-text", fingerprint: OTHER_FP }]),
    ]);
    // Both rungs belong to the SAME row, so there is one match; `visible-text` precedes `data-attribute`.
    expect(outcome).toMatchObject({ matched: true, rowIndex: 0, source: "visible-text", matchCount: 1 });
  });

  it("a row carrying the identity ONLY at a late rung is still found", () => {
    const outcome = locateRowByReviewId(key(), CONTEXT, [
      row(0, [{ source: "visible-text", fingerprint: OTHER_FP }]),
      row(1, [{ source: "data-attribute", fingerprint: TARGET_FP }]),
    ]);
    expect(outcome).toMatchObject({ matched: true, rowIndex: 1, source: "data-attribute", matchCount: 1 });
  });
});

describe("locateRowByReviewId — malformed keys and context binding", () => {
  it("MALFORMED ID: a key can never be built from an unusable identifier", () => {
    for (const bad of ["", "   ", "123 456", "9".repeat(121), null, undefined]) {
      expect(buildReviewIdLocatorKey(CHANNEL, ACCOUNT, bad)).toBeNull();
    }
  });

  it("MALFORMED KEY: a missing channel or account yields no key", () => {
    expect(buildReviewIdLocatorKey("", ACCOUNT, TARGET_ID)).toBeNull();
    expect(buildReviewIdLocatorKey(CHANNEL, "  ", TARGET_ID)).toBeNull();
    expect(reviewIdLocatorKeyFromFingerprint(CHANNEL, ACCOUNT, "not-a-digest")).toBeNull();
    expect(reviewIdLocatorKeyFromFingerprint(CHANNEL, ACCOUNT, TARGET_FP.toUpperCase())).toBeNull();
    expect(reviewIdLocatorKeyFromFingerprint(CHANNEL, ACCOUNT, null)).toBeNull();
  });

  it("MALFORMED KEY: a hand-forged key with a non-digest fingerprint fails closed at locate time", () => {
    const forged = { channel: CHANNEL, sellerAccountId: ACCOUNT, channelReviewIdFingerprint: "deadbeef" };
    expect(locateRowByReviewId(forged, CONTEXT, [row(0, [{ source: "visible-text", fingerprint: TARGET_FP }])])).toEqual(
      { matched: false, reason: "MALFORMED_KEY", matchCount: 0 },
    );
  });

  it("CONTEXT MISMATCH: a key from another account never matches, even if the row would", () => {
    const candidates = [row(0, [{ source: "visible-text", fingerprint: TARGET_FP }])];
    expect(locateRowByReviewId(key(), { channel: CHANNEL, sellerAccountId: "acct-other" }, candidates)).toEqual({
      matched: false,
      reason: "CONTEXT_MISMATCH",
      matchCount: 0,
    });
    expect(locateRowByReviewId(key(), { channel: "esm", sellerAccountId: ACCOUNT }, candidates)).toEqual({
      matched: false,
      reason: "CONTEXT_MISMATCH",
      matchCount: 0,
    });
  });

  it("the fingerprint-built key and the raw-id-built key are the same key", () => {
    expect(reviewIdLocatorKeyFromFingerprint(CHANNEL, ACCOUNT, TARGET_FP)).toEqual(key());
  });
});

describe("locateRowByReviewId — secondary assertions come AFTER the identity, never instead of it", () => {
  it("SECONDARY MISMATCH: the identity matched but the rating disagrees — the whole locate fails closed", () => {
    const outcome = locateRowByReviewId(
      key(),
      CONTEXT,
      [row(0, [{ source: "visible-text", fingerprint: TARGET_FP }], { rating: 5, recencyBucket: "OLDER" })],
      { rating: 1, recencyBucket: "OLDER" },
    );
    expect(outcome).toMatchObject({ matched: false, reason: "SECONDARY_MISMATCH", matchCount: 1 });
    expect(outcome.secondary?.mismatched).toEqual(["rating"]);
    expect(outcome.secondary?.asserted).toContain("recencyBucket");
  });

  it("agreeing secondary facts are reported as asserted", () => {
    const outcome = locateRowByReviewId(
      key(),
      CONTEXT,
      [row(0, [{ source: "visible-text", fingerprint: TARGET_FP }], { rating: 1, recencyBucket: "OLDER" })],
      { rating: 1, recencyBucket: "OLDER" },
    );
    expect(outcome.matched).toBe(true);
    expect(outcome.secondary?.asserted).toEqual(["rating", "recencyBucket"]);
    expect(outcome.secondary?.mismatched).toEqual([]);
  });

  it("a fact only one side supplies is UNAVAILABLE, which is never a mismatch", () => {
    const outcome = locateRowByReviewId(
      key(),
      CONTEXT,
      [row(0, [{ source: "visible-text", fingerprint: TARGET_FP }], { rating: null, recencyBucket: "OLDER" })],
      { rating: 1, recencyBucket: null },
    );
    expect(outcome.matched).toBe(true);
    expect(outcome.secondary?.asserted).toEqual([]);
    expect(outcome.secondary?.unavailable).toEqual(["rating", "recencyBucket", "productRefFingerprint"]);
  });

  it("secondary facts alone can never produce a match — no identity, no row", () => {
    const outcome = locateRowByReviewId(
      key(),
      CONTEXT,
      [row(0, [{ source: "visible-text", fingerprint: OTHER_FP }], { rating: 1, recencyBucket: "OLDER" })],
      { rating: 1, recencyBucket: "OLDER" },
    );
    expect(outcome).toEqual({ matched: false, reason: "ZERO_MATCH", matchCount: 0 });
  });

  it("an opaque product reference is compared when both sides have one", () => {
    const outcome = locateRowByReviewId(
      key(),
      CONTEXT,
      [row(0, [{ source: "visible-text", fingerprint: TARGET_FP }], { productRefFingerprint: "aaa" })],
      { productRefFingerprint: "bbb" },
    );
    expect(outcome).toMatchObject({ matched: false, reason: "SECONDARY_MISMATCH" });
    expect(outcome.secondary?.mismatched).toEqual(["productRefFingerprint"]);
  });
});

describe("ROW_MATCH_MODES — the fallbacks are documented as NOT equivalent to an identity match", () => {
  it("only the id mode claims identity strength", () => {
    expect(ROW_MATCH_MODES["channel-review-id"].strength).toBe("identity");
    expect(ROW_MATCH_MODES["operator-calibrated"].strength).not.toBe("identity");
    expect(ROW_MATCH_MODES["target-hint"].strength).not.toBe("identity");
  });

  it("every fallback carries a non-empty caveat, so it cannot be reported bare", () => {
    expect(ROW_MATCH_MODES["operator-calibrated"].caveat.length).toBeGreaterThan(0);
    expect(ROW_MATCH_MODES["target-hint"].caveat.length).toBeGreaterThan(0);
    expect(ROW_MATCH_MODES["channel-review-id"].caveat).toBe("");
  });

  it("the locator only ever emits the identity mode", () => {
    const outcome = locateRowByReviewId(key(), CONTEXT, [row(0, [{ source: "visible-text", fingerprint: TARGET_FP }])]);
    expect(outcome.matched && outcome.mode).toBe("channel-review-id");
  });
});
