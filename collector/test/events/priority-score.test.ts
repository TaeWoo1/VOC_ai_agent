import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { priorityScoreFor } from "../../src/events/priority-score";
import { normalizeEsmClaim } from "../../src/esmplus/claim-normalizer";
import { normalizeEsmInquiry } from "../../src/esmplus/inquiry-normalizer";
import { normalizeEsmOrder } from "../../src/esmplus/order-normalizer";
import { normalizeEsmSalesContext } from "../../src/esmplus/sales-context-normalizer";
import { normalizeReview } from "../../src/review/review-normalizer";

// Synthetic content/identity that must never surface through a score explanation.
const REVIEW_BODY = "사진이랑 색이 너무 다릅니다";
const CLAIM_REASON = "받은 상품에 흠집이 있습니다";
const SELLER_ID = "seller_acme_123";
const MASTER_ID = "ESMMASTER_XYZ";
const GROSS = 45_000_000;

describe("priorityScoreFor — no signals", () => {
  it("order event with no signals → score 0, band low, no signals, no_attention_signals", () => {
    const e = normalizeEsmOrder({ siteGubun: "GMARKET", orderStatus: "배송완료" });
    const r = priorityScoreFor(e);
    expect(r.score).toBe(0);
    expect(r.band).toBe("low");
    expect(r.signals).toEqual([]);
    expect(r.explanationCodes).toEqual(["no_attention_signals", "band_assigned"]);
  });
});

describe("priorityScoreFor — single signal", () => {
  it("low-rating review → 70 / high (single high severity)", () => {
    const e = normalizeReview({ platform: "NAVER", rating: 1, body: REVIEW_BODY });
    const r = priorityScoreFor(e);
    expect(r.score).toBe(70);
    expect(r.band).toBe("high");
    expect(r.signals).toEqual(["low_rating_review"]);
    expect(r.explanationCodes).toEqual(["severity_weight_applied", "band_assigned"]);
  });

  it("not-replied review (rating 5) → 40 / medium", () => {
    const e = normalizeReview({ platform: "NAVER", rating: 5, replyStatus: "미답변" });
    const r = priorityScoreFor(e);
    expect(r.score).toBe(40);
    expect(r.band).toBe("medium");
    expect(r.signals).toEqual(["not_replied_review"]);
  });

  it("open inquiry → 40 / medium", () => {
    const e = normalizeEsmInquiry({ siteGubun: "GMARKET", answerYn: "N", contents: "언제 오나요" });
    expect(priorityScoreFor(e).score).toBe(40);
    expect(priorityScoreFor(e).band).toBe("medium");
  });

  it("active claim → 70 / high", () => {
    const e = normalizeEsmClaim({ siteGubun: "AUCTION", claimStatus: "접수", reasonText: CLAIM_REASON });
    const r = priorityScoreFor(e);
    expect(r.score).toBe(70);
    expect(r.band).toBe("high");
    expect(r.signals).toEqual(["active_claim"]);
  });
});

describe("priorityScoreFor — co-occurrence", () => {
  it("low-rating + not-replied review → 70+40+10 co-occurrence = 120 / urgent", () => {
    const e = normalizeReview({ platform: "NAVER", rating: 2, replyStatus: "미답변" });
    const r = priorityScoreFor(e);
    expect(r.score).toBe(120);
    expect(r.band).toBe("urgent");
    expect(r.signals).toEqual(["low_rating_review", "not_replied_review"]);
    expect(r.explanationCodes).toContain("signal_cooccurrence_bonus");
  });
});

describe("priorityScoreFor — high sales context", () => {
  it("high sales context → high_sales_context bonus, amountBucket-derived only", () => {
    const e = normalizeEsmSalesContext({
      siteGubun: "GMARKET",
      grossSalesAmount: GROSS,
      orderCount: 100,
      sellerId: SELLER_ID,
      masterId: MASTER_ID,
    });
    const r = priorityScoreFor(e);
    // signals: high_sales_context (high, 70) + sales_context_available (low, 10) = 80;
    // only one high/medium signal → no co-occurrence bonus; +15 high-sales bonus = 95.
    expect(r.score).toBe(95);
    expect(r.band).toBe("high");
    expect(r.signals).toEqual(["high_sales_context", "sales_context_available"]);
    expect(r.explanationCodes).toContain("high_sales_context_bonus");
    expect(r.explanationCodes).not.toContain("signal_cooccurrence_bonus");
  });
});

describe("priorityScoreFor — determinism", () => {
  it("repeated calls on the same event return identical results", () => {
    const e = normalizeReview({ platform: "NAVER", rating: 2, replyStatus: "미답변" });
    expect(priorityScoreFor(e)).toEqual(priorityScoreFor(e));
  });
});

describe("priorityScoreFor — no leakage", () => {
  it("explanation never includes raw content, refs/ids, exact amounts/counts, or identity", () => {
    const events = [
      normalizeReview({ platform: "NAVER", rating: 1, body: REVIEW_BODY, reviewRef: 778899, productRef: 555 }),
      normalizeEsmClaim({ siteGubun: "AUCTION", claimStatus: "접수", reasonText: CLAIM_REASON, claimNo: 900800700 }),
      normalizeEsmSalesContext({ siteGubun: "GMARKET", grossSalesAmount: GROSS, orderCount: 100, sellerId: SELLER_ID, masterId: MASTER_ID, settlementNo: 50607080 }),
    ];
    const serialized = JSON.stringify(events.map((e) => priorityScoreFor(e)));
    for (const leak of [
      REVIEW_BODY, CLAIM_REASON,
      "778899", "555", "900800700", "50607080",
      String(GROSS), "100",
      SELLER_ID, MASTER_ID,
    ]) {
      expect(serialized).not.toContain(leak);
    }
  });

  it("recency does not leak eventTimeMs, a raw timestamp, or an elapsed duration", () => {
    // A fresh low-rating review whose writtenAt parses to eventTimeMs = 0.
    const e = normalizeReview({ platform: "NAVER", rating: 1, body: REVIEW_BODY, writtenAt: "1970-01-01T00:00:00Z" });
    const REF = 5 * 60 * 60 * 1000; // 5h → same_day bucket
    const serialized = JSON.stringify(priorityScoreFor(e, { referenceTimeMs: REF }));
    expect(serialized).not.toContain("eventTimeMs");
    expect(serialized).not.toContain("1970-01-01T00:00:00Z"); // raw timestamp
    expect(serialized).not.toContain(String(REF)); // elapsed/reference duration
  });
});

describe("priorityScoreFor — recency (Phase 3)", () => {
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;
  // A low-rating review (one high signal → base 70 / high). writtenAt parses to eventTimeMs = 0.
  const lowRating = normalizeReview({ platform: "NAVER", rating: 1, writtenAt: "1970-01-01T00:00:00Z" });

  it("no referenceTimeMs → identical to pre-recency behavior (no recency code)", () => {
    const r = priorityScoreFor(lowRating);
    expect(r.score).toBe(70);
    expect(r.band).toBe("high");
    expect(r.explanationCodes).toEqual(["severity_weight_applied", "band_assigned"]);
    expect(r.explanationCodes).not.toContain("recency_bucket_applied");
  });

  it("adds exactly the per-bucket points from an explicit referenceTimeMs", () => {
    const scoreAt = (refMs: number) => priorityScoreFor(lowRating, { referenceTimeMs: refMs }).score;
    expect(scoreAt(0)).toBe(78); // fresh_0_2h  +8
    expect(scoreAt(2 * HOUR)).toBe(75); // same_day_2_24h +5
    expect(scoreAt(24 * HOUR)).toBe(72); // recent_1_3d +2
    expect(scoreAt(3 * DAY)).toBe(70); // aging_3_7d +0
    expect(scoreAt(7 * DAY)).toBe(70); // stale_over_7d +0
  });

  it("records recency_bucket_applied only when the contribution is non-zero", () => {
    const codesAt = (refMs: number) => priorityScoreFor(lowRating, { referenceTimeMs: refMs }).explanationCodes;
    expect(codesAt(0)).toContain("recency_bucket_applied"); // fresh
    expect(codesAt(24 * HOUR)).toContain("recency_bucket_applied"); // recent
    expect(codesAt(3 * DAY)).not.toContain("recency_bucket_applied"); // aging → +0
    expect(codesAt(7 * DAY)).not.toContain("recency_bucket_applied"); // stale → +0
    // code is appended before band_assigned (after the severity/bonus codes)
    expect(codesAt(0)).toEqual(["severity_weight_applied", "recency_bucket_applied", "band_assigned"]);
  });

  it("score-folded: recency adds to the raw score and band is derived from the total", () => {
    const r = priorityScoreFor(lowRating, { referenceTimeMs: 0 }); // fresh +8
    expect(r.score).toBe(78); // 70 + 8, folded into the score
    expect(r.band).toBe("high"); // band = bandFor(78); +8 cap < the 30-pt gap to urgent, so no tip
  });

  it("future event time → unknown → +0 (recency never rewards a future timestamp)", () => {
    const future = normalizeReview({ platform: "NAVER", rating: 1, writtenAt: "1970-01-01T01:00:00Z" }); // eventTimeMs = 3_600_000
    const r = priorityScoreFor(future, { referenceTimeMs: 0 });
    expect(r.score).toBe(70);
    expect(r.explanationCodes).not.toContain("recency_bucket_applied");
  });

  it("sales_context has no recencyBucket → unknown → +0 even with a referenceTimeMs", () => {
    const sales = normalizeEsmSalesContext({ siteGubun: "GMARKET", grossSalesAmount: GROSS, orderCount: 100 });
    const withRef = priorityScoreFor(sales, { referenceTimeMs: 0 });
    const noRef = priorityScoreFor(sales);
    expect(withRef.score).toBe(noRef.score); // recency makes no difference
    expect(withRef.explanationCodes).not.toContain("recency_bucket_applied");
  });

  it("a fresh no-signal event stays score 0 — recency never invents priority", () => {
    const order = normalizeEsmOrder({ siteGubun: "GMARKET", orderStatus: "배송완료", orderDt: "1970-01-01T00:00:00Z" });
    const r = priorityScoreFor(order, { referenceTimeMs: 0 }); // would be fresh, but no signals
    expect(r.score).toBe(0);
    expect(r.band).toBe("low");
    expect(r.explanationCodes).toEqual(["no_attention_signals", "band_assigned"]);
  });

  it("recency cannot overcome severity: a stale high outscores a fresh medium", () => {
    const REF = 8 * DAY;
    const staleHigh = priorityScoreFor(lowRating, { referenceTimeMs: REF }); // 70 + 0 (stale)
    const freshMedium = priorityScoreFor(
      normalizeReview({ platform: "NAVER", rating: 5, replyStatus: "미답변", writtenAt: "1970-01-09T00:00:00Z" }),
      { referenceTimeMs: REF }, // not-replied (40) + fresh (+8) = 48
    );
    expect(staleHigh.score).toBe(70);
    expect(freshMedium.score).toBe(48);
    expect(staleHigh.score).toBeGreaterThan(freshMedium.score);
  });

  it("is deterministic for a fixed referenceTimeMs", () => {
    expect(priorityScoreFor(lowRating, { referenceTimeMs: 0 })).toEqual(
      priorityScoreFor(lowRating, { referenceTimeMs: 0 }),
    );
  });
});

describe("module boundary", () => {
  it("imports no network/fs/browser/env, no AI client, and does not read current time", () => {
    const src = readFileSync(
      join(__dirname, "..", "..", "src", "events", "priority-score.ts"),
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
    // single-event slice: no ranking, no Date/now usage. Check CODE only — the doc
    // comment legitimately states that prioritizeEvents is NOT implemented here.
    const code = src
      .split("\n")
      .filter((l) => {
        const t = l.trim();
        return !(t.startsWith("*") || t.startsWith("//") || t.startsWith("/*") || t.startsWith("*/"));
      })
      .join("\n");
    expect(/prioritizeEvents/.test(code)).toBe(false);
    expect(/Date\.now|new Date\(/.test(code)).toBe(false);
  });
});
