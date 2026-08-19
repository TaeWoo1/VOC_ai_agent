/**
 * The read-only review-id probe CLI's pure seams: the approval gate, the KST as-of parsing, and the
 * validation of whatever the page hands back.
 *
 * The gate matters most. This CLI holds the WEAKEST authorization in the runtime, and the rule is that a
 * stronger, MUTATING grant is a refusal rather than a permission — passing the reply flag here means the
 * operator thinks they are running the reply CLI, which is exactly when stopping is worth more than starting.
 */
import { describe, it, expect } from "vitest";
import {
  PROBE_PRODUCTION_REFUSAL,
  buildProbeRecord,
  civilDateParts,
  ladderExposure,
  parseLadderResult,
  reviewIdProbeRefusal,
} from "../../instruments/live-runs/run-review-id-reconciliation-live-naver";
import {
  APPROVAL_FLAG,
  REPLY_APPROVAL_FLAG,
  REVIEW_ID_PROBE_FLAG,
} from "../../src/cli/live-run-approval";
import { locateRowByReviewId, buildReviewIdLocatorKey } from "../../src/action-window/reply-submission/review-id-locator";

const HEX_A = "a".repeat(64);
const HEX_B = "b".repeat(64);

describe("reviewIdProbeRefusal — the gate", () => {
  it("refuses with no flag at all", () => {
    const refusal = reviewIdProbeRefusal([], {});
    expect(refusal?.exitCode).toBe(3);
    expect(refusal?.reason).toContain("READ-ONLY");
  });

  it("allows the run with exactly its own read-only flag", () => {
    expect(reviewIdProbeRefusal([REVIEW_ID_PROBE_FLAG], {})).toBeNull();
  });

  it("REFUSES the MUTATING reply flag — a stronger grant is not a superset here", () => {
    const refusal = reviewIdProbeRefusal([REPLY_APPROVAL_FLAG], {});
    expect(refusal?.exitCode).toBe(6);
    expect(refusal?.reason).toContain("MUTATING");
  });

  it("REFUSES the export flag for the same reason", () => {
    const refusal = reviewIdProbeRefusal([APPROVAL_FLAG], {});
    expect(refusal?.exitCode).toBe(6);
  });

  it("refuses a mutating flag even when its own flag is also present", () => {
    expect(reviewIdProbeRefusal([REVIEW_ID_PROBE_FLAG, REPLY_APPROVAL_FLAG], {})?.exitCode).toBe(6);
    expect(reviewIdProbeRefusal([REVIEW_ID_PROBE_FLAG, APPROVAL_FLAG], {})?.exitCode).toBe(6);
  });

  it("refuses under NODE_ENV=production even when properly approved", () => {
    const refusal = reviewIdProbeRefusal([REVIEW_ID_PROBE_FLAG], { NODE_ENV: "production" });
    expect(refusal?.exitCode).toBe(4);
    expect(refusal?.reason).toBe(PROBE_PRODUCTION_REFUSAL);
  });
});

describe("civilDateParts", () => {
  it("parses a KST calendar date", () => {
    expect(civilDateParts("2026-07-20")).toEqual({ year: 2026, month: 7, day: 20 });
  });

  it("rejects anything that is not exactly YYYY-MM-DD", () => {
    for (const bad of ["2026-7-20", "20260720", "", "2026-07-20T00:00:00Z"]) {
      expect(civilDateParts(bad)).toBeNull();
    }
  });
});

describe("parseLadderResult — the page is untrusted input", () => {
  it("accepts a well-formed result", () => {
    const parsed = parseLadderResult({
      rows: [
        {
          rowIndex: 0,
          idFingerprints: [{ source: "anchor-href", fingerprint: HEX_A }],
          secondary: { rating: 1, recencyBucket: "OLDER" },
        },
      ],
      pageStateFingerprints: [HEX_B],
      rowCount: 1,
    });
    expect(parsed.candidates).toHaveLength(1);
    expect(parsed.candidates[0]!.idFingerprints).toEqual([{ source: "anchor-href", fingerprint: HEX_A }]);
    expect(parsed.candidates[0]!.secondary).toEqual({ rating: 1, recencyBucket: "OLDER" });
    expect(parsed.pageStateFingerprints).toEqual([HEX_B]);
  });

  it("drops fingerprints that are not lowercase 64-hex", () => {
    const parsed = parseLadderResult({
      rows: [
        {
          rowIndex: 0,
          idFingerprints: [
            { source: "visible-text", fingerprint: HEX_A.toUpperCase() },
            { source: "visible-text", fingerprint: "short" },
            { source: "visible-text", fingerprint: HEX_A },
          ],
        },
      ],
    });
    expect(parsed.candidates[0]!.idFingerprints).toEqual([{ source: "visible-text", fingerprint: HEX_A }]);
  });

  it("drops an unknown rung name, so a page cannot invent a source", () => {
    const parsed = parseLadderResult({
      rows: [{ rowIndex: 0, idFingerprints: [{ source: "operator-calibrated", fingerprint: HEX_A }] }],
    });
    expect(parsed.candidates[0]!.idFingerprints).toEqual([]);
  });

  it("drops rows with a missing or nonsensical index", () => {
    const parsed = parseLadderResult({
      rows: [{ rowIndex: -1, idFingerprints: [] }, { rowIndex: "0", idFingerprints: [] }, { idFingerprints: [] }],
    });
    expect(parsed.candidates).toHaveLength(0);
  });

  it("REJECTS a row whose claimed index is not its own position — the page cannot redirect the highlight", () => {
    // The outline step addresses rowIndex. A page that says "I am row 7" while sitting at position 0 would
    // otherwise get an arbitrary row outlined and visually confirmed by the operator.
    const parsed = parseLadderResult({
      rows: [
        { rowIndex: 7, idFingerprints: [{ source: "visible-text", fingerprint: HEX_A }] },
        { rowIndex: 1, idFingerprints: [{ source: "visible-text", fingerprint: HEX_B }] },
      ],
    });
    expect(parsed.candidates.map((c) => c.rowIndex)).toEqual([1]);
  });

  it("REJECTS duplicated indices for the same reason", () => {
    const parsed = parseLadderResult({
      rows: [
        { rowIndex: 0, idFingerprints: [] },
        { rowIndex: 0, idFingerprints: [] },
      ],
    });
    expect(parsed.candidates.map((c) => c.rowIndex)).toEqual([0]);
  });

  it("a dropped row marks the scan truncated, so the result can never read as a complete sweep", () => {
    const parsed = parseLadderResult({
      rows: [{ rowIndex: 99, idFingerprints: [] }],
      rowsTruncated: false,
      tokensTruncated: false,
    });
    expect(parsed.candidates).toHaveLength(0);
    expect(parsed.rowsTruncated).toBe(true);
  });

  it("truncation defaults to TRUE for anything that is not an explicit false", () => {
    for (const raw of [{}, { rowsTruncated: "no", tokensTruncated: 0 }, { rowsTruncated: null }]) {
      const parsed = parseLadderResult(raw);
      expect(parsed.rowsTruncated).toBe(true);
      expect(parsed.tokensTruncated).toBe(true);
    }
    const clean = parseLadderResult({ rows: [], rowsTruncated: false, tokensTruncated: false });
    expect(clean.rowsTruncated).toBe(false);
    expect(clean.tokensTruncated).toBe(false);
  });

  it("coerces an out-of-range rating to null rather than trusting it", () => {
    const parsed = parseLadderResult({
      rows: [
        { rowIndex: 0, idFingerprints: [], secondary: { rating: 9 } },
        { rowIndex: 1, idFingerprints: [], secondary: { rating: 2.5 } },
        { rowIndex: 2, idFingerprints: [], secondary: { rating: 3 } },
      ],
    });
    expect(parsed.candidates.map((c) => c.secondary?.rating)).toEqual([null, null, 3]);
  });

  it("survives junk, null and non-object shapes without throwing", () => {
    for (const junk of [null, undefined, 42, "nope", [], { rows: "nope" }, { rows: [null, 1, "x"] }]) {
      expect(() => parseLadderResult(junk)).not.toThrow();
    }
    expect(parseLadderResult(null).candidates).toEqual([]);
  });

  it("a page returning junk can never produce a match", () => {
    const key = buildReviewIdLocatorKey("naver", "acct", "1234567890")!;
    const parsed = parseLadderResult({ rows: [{ rowIndex: 0, idFingerprints: [{ source: "x", fingerprint: "y" }] }] });
    expect(
      locateRowByReviewId(key, { channel: "naver", sellerAccountId: "acct" }, parsed.candidates),
    ).toMatchObject({ matched: false, reason: "ZERO_MATCH" });
  });
});

describe("buildProbeRecord — the reported result can structurally not carry an identifier", () => {
  const base = {
    runId: "idrun_abc123abc123",
    exposure: null,
    rowCount: 3,
    rowsTruncated: false,
    tokensTruncated: false,
    scopeExpandedRows: 0,
    scanCount: 1,
    pageStatePresence: false,
    networkPresence: false,
    networkTruncated: false,
    outline: null,
    operatorConfirmed: null,
  };

  it("a matched run records the mode, the rung, and the count", () => {
    const record = buildProbeRecord({
      ...base,
      outcome: {
        matched: true,
        mode: "channel-review-id",
        rowIndex: 2,
        source: "anchor-href",
        matchCount: 1,
        secondary: { asserted: ["rating"], unavailable: [], mismatched: [] },
      },
      outline: "outlined",
      operatorConfirmed: true,
    });
    expect(record).toMatchObject({
      matched: true,
      matchMode: "channel-review-id",
      matchedSource: "anchor-href",
      matchCount: 1,
      highlighted: true,
      operatorConfirmed: true,
    });
  });

  it("`highlighted` is true ONLY when the row was actually outlined", () => {
    const matched = {
      matched: true,
      mode: "channel-review-id",
      rowIndex: 0,
      source: "visible-text",
      matchCount: 1,
      secondary: { asserted: [], unavailable: [], mismatched: [] },
    } as const;
    expect(buildProbeRecord({ ...base, outcome: matched, outline: "row-changed" }).highlighted).toBe(false);
    expect(buildProbeRecord({ ...base, outcome: matched, outline: "absent" }).highlighted).toBe(false);
    expect(buildProbeRecord({ ...base, outcome: matched, outline: null }).highlighted).toBe(false);
  });

  it("states plainly that the seller-account binding is asserted, not verified", () => {
    expect(buildProbeRecord({ ...base, outcome: null }).sellerAccountBinding).toBe(
      "asserted-by-request-bundle-not-verified-against-session",
    );
  });

  it("every value is a count, enum, boolean, or the run id — nothing that could be an identifier", () => {
    const record = buildProbeRecord({
      ...base,
      outcome: { matched: false, reason: "ZERO_MATCH", matchCount: 0 },
      exposure: {
        "visible-text": 3,
        "anchor-href": 3,
        "input-value": 0,
        "data-attribute": 3,
        "page-state": 0,
        "network-response": 0,
      },
    });
    const serialized = JSON.stringify(record);
    // No 64-hex digest, no UUID, no URL, no long digit run can appear in the record.
    expect(serialized).not.toMatch(/[0-9a-f]{64}/);
    expect(serialized).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    expect(serialized).not.toMatch(/https?:\/\//);
    expect(serialized).not.toMatch(/\d{6,}/);
  });

  it("a failed run records the reason and never claims a match", () => {
    const record = buildProbeRecord({
      ...base,
      outcome: { matched: false, reason: "MULTIPLE_MATCH", matchCount: 2 },
    });
    expect(record).toMatchObject({
      matched: false,
      matchMode: null,
      matchedSource: null,
      failureReason: "MULTIPLE_MATCH",
      matchCount: 2,
      highlighted: false,
    });
  });

  it("truncation travels into the record, so a miss is auditable after the fact", () => {
    const record = buildProbeRecord({
      ...base,
      outcome: { matched: false, reason: "ZERO_MATCH", matchCount: 0 },
      rowsTruncated: true,
      tokensTruncated: true,
      networkTruncated: true,
    });
    expect(record.rowsTruncated).toBe(true);
    expect(record.tokensTruncated).toBe(true);
    expect(record.networkScanTruncated).toBe(true);
  });
});

describe("ladderExposure — evidence reported when the identity is NOT found", () => {
  it("counts rows exposing any token per rung, and reports every rung including the empty ones", () => {
    const parsed = parseLadderResult({
      rows: [
        { rowIndex: 0, idFingerprints: [{ source: "visible-text", fingerprint: HEX_A }] },
        {
          rowIndex: 1,
          idFingerprints: [
            { source: "visible-text", fingerprint: HEX_B },
            { source: "data-attribute", fingerprint: HEX_B },
          ],
        },
      ],
    });
    const exposure = ladderExposure(parsed.candidates);
    expect(exposure["visible-text"]).toBe(2);
    expect(exposure["data-attribute"]).toBe(1);
    expect(exposure["anchor-href"]).toBe(0);
    expect(exposure["input-value"]).toBe(0);
    expect(exposure["page-state"]).toBe(0);
    expect(exposure["network-response"]).toBe(0);
  });
});
