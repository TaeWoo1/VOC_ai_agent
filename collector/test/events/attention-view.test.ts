import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { attentionView } from "../../src/events/attention-view";
import { normalizeEsmClaim } from "../../src/esmplus/claim-normalizer";
import { normalizeEsmInquiry } from "../../src/esmplus/inquiry-normalizer";
import { normalizeEsmOrder } from "../../src/esmplus/order-normalizer";
import { normalizeEsmSalesContext } from "../../src/esmplus/sales-context-normalizer";
import { normalizeReview } from "../../src/review/review-normalizer";
import type { SellerOpsEvent } from "../../src/events/types";

// Synthetic content/identity that must never surface through the view.
const REVIEW_BODY = "사진이랑 색이 너무 다릅니다";
const CLAIM_REASON = "받은 상품에 흠집이 있습니다";
const SELLER_ID = "seller_acme_123";
const MASTER_ID = "ESMMASTER_XYZ";
const GROSS = 45_000_000;

// A varied batch; sizes used to exercise limit behavior.
function makeBatch(n: number): SellerOpsEvent[] {
  const out: SellerOpsEvent[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push(normalizeReview({ platform: "NAVER", rating: 1, reviewRef: `r${i}` }));
  }
  return out;
}

describe("attentionView — empty", () => {
  it("empty input returns empty digest + empty top", () => {
    const v = attentionView([]);
    expect(v.totalEvents).toBe(0);
    expect(v.totalRankedEvents).toBe(0);
    expect(v.top).toEqual([]);
    expect(v.truncated).toBe(false);
    expect(v.digest).toEqual({
      totalEvents: 0,
      totalSignals: 0,
      bySignalCode: [],
      bySeverity: [],
      byEventKind: [],
      byPlatform: [],
      byChannel: [],
      byRecency: [],
    });
  });
});

describe("attentionView — limit normalization", () => {
  it("default limit is 10", () => {
    const v = attentionView(makeBatch(25));
    expect(v.limit).toBe(10);
    expect(v.top).toHaveLength(10);
    expect(v.truncated).toBe(true);
  });

  it("explicit limit returns only top N", () => {
    const v = attentionView(makeBatch(25), { limit: 5 });
    expect(v.limit).toBe(5);
    expect(v.top).toHaveLength(5);
  });

  it("limit 0 returns no top rows but digest still counts all events", () => {
    const v = attentionView(makeBatch(8), { limit: 0 });
    expect(v.limit).toBe(0);
    expect(v.top).toEqual([]);
    expect(v.digest.totalEvents).toBe(8);
    expect(v.truncated).toBe(true);
  });

  it("large limit clamps to max 50", () => {
    const v = attentionView(makeBatch(3), { limit: 9999 });
    expect(v.limit).toBe(50);
    expect(v.top).toHaveLength(3); // only 3 ranked rows exist
    expect(v.truncated).toBe(false);
  });

  it("decimal limit is floored", () => {
    const v = attentionView(makeBatch(10), { limit: 3.9 });
    expect(v.limit).toBe(3);
    expect(v.top).toHaveLength(3);
  });

  it("negative limit becomes 0; non-finite uses default 10", () => {
    expect(attentionView(makeBatch(5), { limit: -4 }).limit).toBe(0);
    expect(attentionView(makeBatch(5), { limit: Number.NaN }).limit).toBe(10);
    expect(attentionView(makeBatch(5), { limit: Number.POSITIVE_INFINITY }).limit).toBe(10);
  });
});

describe("attentionView — digest vs top", () => {
  const events = [
    normalizeReview({ platform: "NAVER", rating: 2, replyStatus: "미답변" }), // urgent
    normalizeEsmInquiry({ siteGubun: "GMARKET", answerYn: "N" }), // medium
    normalizeEsmOrder({ siteGubun: "GMARKET", orderStatus: "배송완료" }), // no signals
  ];

  it("digest counts all events, not just top rows", () => {
    const v = attentionView(events, { limit: 1 });
    expect(v.top).toHaveLength(1);
    expect(v.digest.totalEvents).toBe(3); // digest covers all three
    expect(v.totalRankedEvents).toBe(3);
  });

  it("top rows preserve prioritizeEvents ordering (score desc, inputIndex asc)", () => {
    const v = attentionView(events);
    expect(v.top.map((r) => r.kind)).toEqual(["review", "cs_inquiry", "order_shipping"]);
    expect(v.top[0]?.priority.band).toBe("urgent");
  });

  it("top rows are sanitized PrioritizedEvent only", () => {
    const v = attentionView(events, { limit: 1 });
    expect(Object.keys(v.top[0]!).sort()).toEqual([
      "channel",
      "inputIndex",
      "kind",
      "platform",
      "priority",
      "recencyBucket",
    ]);
  });

  it("truncated reflects ranked.length vs limit", () => {
    expect(attentionView(makeBatch(11), { limit: 10 }).truncated).toBe(true);
    expect(attentionView(makeBatch(10), { limit: 10 }).truncated).toBe(false);
    expect(attentionView(makeBatch(3), { limit: 10 }).truncated).toBe(false);
  });
});

describe("attentionView — determinism", () => {
  it("repeated calls on the same input return identical output", () => {
    const events = makeBatch(5);
    expect(attentionView(events, { limit: 3 })).toEqual(attentionView(events, { limit: 3 }));
  });
});

describe("attentionView — recency passthrough (Phase 3)", () => {
  // A fresh low-rating review (one high signal → 70). writtenAt parses to eventTimeMs = 0.
  const freshLowRating = normalizeReview({ platform: "NAVER", rating: 1, writtenAt: "1970-01-01T00:00:00Z" });

  it("forwards referenceTimeMs into scoring (recency raises the row's score)", () => {
    const v = attentionView([freshLowRating], { referenceTimeMs: 0 }); // fresh → +8
    expect(v.top[0]?.priority.score).toBe(78);
    expect(v.top[0]?.priority.explanationCodes).toContain("recency_bucket_applied");
  });

  it("without referenceTimeMs, scoring is recency-blind (identical to before)", () => {
    const v = attentionView([freshLowRating]);
    expect(v.top[0]?.priority.score).toBe(70);
    expect(v.top[0]?.priority.explanationCodes).not.toContain("recency_bucket_applied");
  });

  it("is deterministic for a fixed referenceTimeMs", () => {
    const events = makeBatch(5);
    expect(attentionView(events, { limit: 3, referenceTimeMs: 0 })).toEqual(
      attentionView(events, { limit: 3, referenceTimeMs: 0 }),
    );
  });
});

describe("attentionView — recency display (Phase 4)", () => {
  const freshLowRating = normalizeReview({ platform: "NAVER", rating: 1, writtenAt: "1970-01-01T00:00:00Z" });

  it("surfaces the coarse recencyBucket on the row (still no eventTimeMs / raw timestamp)", () => {
    const v = attentionView([freshLowRating], { referenceTimeMs: 0 }); // fresh
    expect(v.top[0]?.recencyBucket).toBe("fresh_0_2h");
    expect(JSON.stringify(v)).not.toContain("eventTimeMs");
    expect(JSON.stringify(v)).not.toContain("1970-01-01T00:00:00Z"); // no raw timestamp string
  });

  it("without referenceTimeMs the row recencyBucket is 'unknown'", () => {
    const v = attentionView([freshLowRating]);
    expect(v.top[0]?.recencyBucket).toBe("unknown");
  });

  it("forwards referenceTimeMs into the digest histogram (byRecency)", () => {
    const v = attentionView([freshLowRating], { referenceTimeMs: 0 });
    expect(v.digest.byRecency).toEqual([{ bucket: "fresh_0_2h", count: 1 }]);
  });

  it("without referenceTimeMs the digest histogram is all-unknown", () => {
    const v = attentionView([freshLowRating]);
    expect(v.digest.byRecency).toEqual([{ bucket: "unknown", count: 1 }]);
  });

  it("display fields do not change scoring or ordering", () => {
    // Same input + reference as the Phase-3 score test → identical score/codes; the row
    // simply also carries the coarse bucket now.
    const v = attentionView([freshLowRating], { referenceTimeMs: 0 });
    expect(v.top[0]?.priority.score).toBe(78);
    expect(v.top[0]?.priority.explanationCodes).toContain("recency_bucket_applied");
    expect(v.top[0]?.recencyBucket).toBe("fresh_0_2h");
  });
});

describe("attentionView — no leakage", () => {
  it("never exposes raw content, refs/ids, exact amounts/counts, identity, or raw events", () => {
    const events = [
      normalizeReview({ platform: "NAVER", rating: 1, body: REVIEW_BODY, reviewRef: 778899, productRef: 555 }),
      normalizeEsmClaim({ siteGubun: "AUCTION", claimStatus: "접수", reasonText: CLAIM_REASON, claimNo: 900800700 }),
      normalizeEsmSalesContext({ siteGubun: "GMARKET", grossSalesAmount: GROSS, orderCount: 100, sellerId: SELLER_ID, masterId: MASTER_ID, settlementNo: 50607080 }),
    ];
    // Sweep both the recency-blind path and the reference-time path (row buckets +
    // byRecency histogram) — the only recency output is a coarse bucket.
    const serialized =
      JSON.stringify(attentionView(events)) +
      JSON.stringify(attentionView(events, { referenceTimeMs: 8 * 24 * 60 * 60 * 1000 }));
    for (const leak of [
      REVIEW_BODY, CLAIM_REASON,
      "778899", "555", "900800700", "50607080",
      String(GROSS), "100",
      SELLER_ID, MASTER_ID,
    ]) {
      expect(serialized).not.toContain(leak);
    }
  });
});

describe("module boundary", () => {
  it("imports no network/fs/browser/env/AI, and uses no current time / generatedAt", () => {
    const src = readFileSync(
      join(__dirname, "..", "..", "src", "events", "attention-view.ts"),
      "utf8",
    );
    const imports = src
      .split("\n")
      .filter((l) => /^\s*import\b/.test(l) || /\bfrom\s+["']/.test(l))
      .join("\n");
    expect(/playwright/i.test(imports)).toBe(false);
    expect(/from\s+["'](node:)?fs(\/promises)?["']/.test(imports)).toBe(false);
    expect(/from\s+["'](node:)?https?["']/.test(imports)).toBe(false);
    expect(/openai|anthropic/i.test(imports)).toBe(false);
    expect(/process\.env|\bfetch\(|\baxios\b/.test(src)).toBe(false);
    // assembler-only slice: it forwards an explicit referenceTimeMs to the digest and
    // scoring (Phase 3/4) but adds NO recency math of its own, NO dedup/cluster, NO
    // wall-clock read, and NO generatedAt. Check CODE only.
    const code = src
      .split("\n")
      .filter((l) => {
        const t = l.trim();
        return !(t.startsWith("*") || t.startsWith("//") || t.startsWith("/*") || t.startsWith("*/"));
      })
      .join("\n");
    expect(/Date\.now|new Date\(|Date\.UTC/.test(code)).toBe(false);
    expect(/generatedAt/.test(code)).toBe(false);
    // `referenceTimeMs` is allowed (it's a caller input) and Phase 4 surfaces the coarse
    // bucket via the digest/rows; the view still must not introduce dedup/cluster.
    expect(/dedup|cluster/i.test(code)).toBe(false);
  });
});
