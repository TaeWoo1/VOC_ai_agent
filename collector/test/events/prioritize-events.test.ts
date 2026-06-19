import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { prioritizeEvents } from "../../src/events/prioritize-events";
import { normalizeEsmClaim } from "../../src/esmplus/claim-normalizer";
import { normalizeEsmInquiry } from "../../src/esmplus/inquiry-normalizer";
import { normalizeEsmOrder } from "../../src/esmplus/order-normalizer";
import { normalizeEsmSalesContext } from "../../src/esmplus/sales-context-normalizer";
import { normalizeReview } from "../../src/review/review-normalizer";

// Synthetic content/identity that must never surface through a ranked row.
const REVIEW_BODY = "사진이랑 색이 너무 다릅니다";
const CLAIM_REASON = "받은 상품에 흠집이 있습니다";
const SELLER_ID = "seller_acme_123";
const MASTER_ID = "ESMMASTER_XYZ";
const GROSS = 45_000_000;

describe("prioritizeEvents — basics", () => {
  it("empty input returns []", () => {
    expect(prioritizeEvents([])).toEqual([]);
  });

  it("maps each event to a sanitized PrioritizedEvent (no raw event object)", () => {
    const e = normalizeReview({ platform: "NAVER", channel: "smartstore_acme", rating: 1, body: REVIEW_BODY });
    const ranked = prioritizeEvents([e]);
    expect(ranked).toHaveLength(1);
    const row = ranked[0]!;
    expect(row).toEqual({
      inputIndex: 0,
      kind: "review",
      platform: "NAVER",
      channel: "smartstore_acme",
      priority: {
        score: 70,
        band: "high",
        signals: ["low_rating_review"],
        explanationCodes: ["severity_weight_applied", "band_assigned"],
      },
    });
    // exactly the sanitized fields — no raw event leaked in
    expect(Object.keys(row).sort()).toEqual(["channel", "inputIndex", "kind", "platform", "priority"]);
  });
});

describe("prioritizeEvents — ordering", () => {
  it("sorts by score descending; high-priority review before medium inquiry", () => {
    const review = normalizeReview({ platform: "NAVER", rating: 1 }); // 70 / high
    const inquiry = normalizeEsmInquiry({ siteGubun: "GMARKET", answerYn: "N" }); // 40 / medium
    const ranked = prioritizeEvents([inquiry, review]); // deliberately worst-first input
    expect(ranked.map((r) => r.kind)).toEqual(["review", "cs_inquiry"]);
    expect(ranked[0]?.priority.score).toBeGreaterThan(ranked[1]?.priority.score ?? Infinity);
  });

  it("active claim ranks before a no-signal order", () => {
    const order = normalizeEsmOrder({ siteGubun: "GMARKET", orderStatus: "배송완료" }); // 0 / low
    const claim = normalizeEsmClaim({ siteGubun: "AUCTION", claimStatus: "접수" }); // 70 / high
    const ranked = prioritizeEvents([order, claim]);
    expect(ranked.map((r) => r.kind)).toEqual(["claim", "order_shipping"]);
    expect(ranked[1]?.priority.score).toBe(0);
    expect(ranked[1]?.priority.band).toBe("low");
  });

  it("preserves inputIndex ascending for equal scores (stable tie-breaker)", () => {
    // three not-replied reviews → all score 40; original order must be preserved.
    const a = normalizeReview({ platform: "NAVER", rating: 5, replyStatus: "미답변", reviewRef: "a" });
    const b = normalizeReview({ platform: "NAVER", rating: 5, replyStatus: "미답변", reviewRef: "b" });
    const c = normalizeReview({ platform: "NAVER", rating: 5, replyStatus: "미답변", reviewRef: "c" });
    const ranked = prioritizeEvents([a, b, c]);
    expect(ranked.every((r) => r.priority.score === 40)).toBe(true);
    expect(ranked.map((r) => r.inputIndex)).toEqual([0, 1, 2]);
  });
});

describe("prioritizeEvents — determinism", () => {
  it("repeated calls on the same input return identical output", () => {
    const events = [
      normalizeReview({ platform: "NAVER", rating: 2, replyStatus: "미답변" }),
      normalizeEsmInquiry({ siteGubun: "GMARKET", answerYn: "N" }),
      normalizeEsmOrder({ siteGubun: "GMARKET", orderStatus: "배송완료" }),
    ];
    expect(prioritizeEvents(events)).toEqual(prioritizeEvents(events));
  });
});

describe("prioritizeEvents — recency (Phase 3)", () => {
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  it("without referenceTimeMs, ordering is identical to the pre-recency behavior", () => {
    // Two not-replied reviews (both score 40); fresh writtenAt must NOT reorder them.
    const a = normalizeReview({ platform: "NAVER", rating: 5, replyStatus: "미답변", reviewRef: "a", writtenAt: "1970-01-09T00:00:00Z" });
    const b = normalizeReview({ platform: "NAVER", rating: 5, replyStatus: "미답변", reviewRef: "b", writtenAt: "1970-01-01T00:00:00Z" });
    const ranked = prioritizeEvents([a, b]); // no referenceTimeMs
    expect(ranked.every((r) => r.priority.score === 40)).toBe(true);
    expect(ranked.map((r) => r.inputIndex)).toEqual([0, 1]); // stable, recency-blind
  });

  it("a batch-wide referenceTimeMs reorders equal-severity events by recency", () => {
    const REF = 8 * DAY;
    // Both not-replied reviews (medium 40). `fresh` is recent vs REF; `stale` is old.
    const stale = normalizeReview({ platform: "NAVER", rating: 5, replyStatus: "미답변", reviewRef: "stale", writtenAt: "1970-01-01T00:00:00Z" });
    const fresh = normalizeReview({ platform: "NAVER", rating: 5, replyStatus: "미답변", reviewRef: "fresh", writtenAt: "1970-01-09T00:00:00Z" });
    const ranked = prioritizeEvents([stale, fresh], { referenceTimeMs: REF });
    // fresh (40 + 8 = 48) now outranks stale (40 + 0), so input index 1 comes first.
    expect(ranked.map((r) => r.inputIndex)).toEqual([1, 0]);
    expect(ranked[0]?.priority.score).toBe(48);
    expect(ranked[1]?.priority.score).toBe(40);
  });

  it("recency does not dominate severity: a stale high outranks a fresh medium", () => {
    const REF = 8 * DAY;
    const freshMedium = normalizeReview({ platform: "NAVER", rating: 5, replyStatus: "미답변", writtenAt: "1970-01-09T00:00:00Z" }); // 48
    const staleHigh = normalizeReview({ platform: "NAVER", rating: 1, writtenAt: "1970-01-01T00:00:00Z" }); // 70
    const ranked = prioritizeEvents([freshMedium, staleHigh], { referenceTimeMs: REF });
    expect(ranked.map((r) => r.inputIndex)).toEqual([1, 0]); // staleHigh first despite freshMedium being fresher
    expect(ranked[0]?.priority.score).toBe(70);
    expect(ranked[1]?.priority.score).toBe(48);
  });

  it("is deterministic for a fixed batch-wide referenceTimeMs", () => {
    const REF = 5 * HOUR;
    const events = [
      normalizeReview({ platform: "NAVER", rating: 2, replyStatus: "미답변", writtenAt: "1970-01-01T00:00:00Z" }),
      normalizeEsmInquiry({ siteGubun: "GMARKET", answerYn: "N" }),
      normalizeEsmOrder({ siteGubun: "GMARKET", orderStatus: "배송완료" }),
    ];
    expect(prioritizeEvents(events, { referenceTimeMs: REF })).toEqual(
      prioritizeEvents(events, { referenceTimeMs: REF }),
    );
  });
});

describe("prioritizeEvents — no leakage", () => {
  it("ranked rows never expose raw content, refs/ids, exact amounts/counts, or identity", () => {
    const events = [
      normalizeReview({ platform: "NAVER", rating: 1, body: REVIEW_BODY, reviewRef: 778899, productRef: 555 }),
      normalizeEsmClaim({ siteGubun: "AUCTION", claimStatus: "접수", reasonText: CLAIM_REASON, claimNo: 900800700 }),
      normalizeEsmSalesContext({ siteGubun: "GMARKET", grossSalesAmount: GROSS, orderCount: 100, sellerId: SELLER_ID, masterId: MASTER_ID, settlementNo: 50607080 }),
    ];
    const serialized = JSON.stringify(prioritizeEvents(events));
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
  it("imports no network/fs/browser/env, no AI client, and does not read current time", () => {
    const src = readFileSync(
      join(__dirname, "..", "..", "src", "events", "prioritize-events.ts"),
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
    // ranking slice: recency is applied via priorityScoreFor from an explicit
    // referenceTimeMs (the `./recency-bucket` import is legitimate); still NO dedup/
    // cluster and NO wall-clock read. Check CODE only.
    const code = src
      .split("\n")
      .filter((l) => {
        const t = l.trim();
        return !(t.startsWith("*") || t.startsWith("//") || t.startsWith("/*") || t.startsWith("*/"));
      })
      .join("\n");
    expect(/Date\.now|new Date\(|Date\.UTC|generatedAt/.test(code)).toBe(false);
    expect(/dedup|cluster/i.test(code)).toBe(false);
  });
});
