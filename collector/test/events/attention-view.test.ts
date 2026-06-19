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

  it("row shape is unchanged — recency is NOT surfaced as a row field (Phase 4 deferred)", () => {
    const v = attentionView([freshLowRating], { referenceTimeMs: 0 });
    expect(Object.keys(v.top[0]!).sort()).toEqual(["channel", "inputIndex", "kind", "platform", "priority"]);
    expect(JSON.stringify(v)).not.toContain("recencyBucket");
    expect(JSON.stringify(v)).not.toContain("eventTimeMs");
  });

  it("is deterministic for a fixed referenceTimeMs", () => {
    const events = makeBatch(5);
    expect(attentionView(events, { limit: 3, referenceTimeMs: 0 })).toEqual(
      attentionView(events, { limit: 3, referenceTimeMs: 0 }),
    );
  });
});

describe("attentionView — no leakage", () => {
  it("never exposes raw content, refs/ids, exact amounts/counts, identity, or raw events", () => {
    const events = [
      normalizeReview({ platform: "NAVER", rating: 1, body: REVIEW_BODY, reviewRef: 778899, productRef: 555 }),
      normalizeEsmClaim({ siteGubun: "AUCTION", claimStatus: "접수", reasonText: CLAIM_REASON, claimNo: 900800700 }),
      normalizeEsmSalesContext({ siteGubun: "GMARKET", grossSalesAmount: GROSS, orderCount: 100, sellerId: SELLER_ID, masterId: MASTER_ID, settlementNo: 50607080 }),
    ];
    const serialized = JSON.stringify(attentionView(events));
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
    // assembler-only slice: it forwards an explicit referenceTimeMs to scoring but
    // contains NO recency LOGIC of its own (Phase 3), NO dedup/cluster, NO wall-clock
    // read, and NO generatedAt. Check CODE only.
    const code = src
      .split("\n")
      .filter((l) => {
        const t = l.trim();
        return !(t.startsWith("*") || t.startsWith("//") || t.startsWith("/*") || t.startsWith("*/"));
      })
      .join("\n");
    expect(/Date\.now|new Date\(|Date\.UTC/.test(code)).toBe(false);
    expect(/generatedAt/.test(code)).toBe(false);
    // `referenceTimeMs` is allowed (it's a caller input); `recency`/`recencyBucket` logic
    // must NOT appear in the view's own code (that stays Phase 4).
    expect(/recencyBucket|dedup|cluster/i.test(code)).toBe(false);
  });
});
