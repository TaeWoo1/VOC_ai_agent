import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  normalizeReview,
  sanitizedReviewSummary,
  type RawReview,
} from "../../src/review/review-normalizer";
import { sanitizedSummaryFor } from "../../src/events/sanitized-summary";
import { attentionView } from "../../src/events/attention-view";

// Synthetic only — reviewer/buyer/seller identity here must never reach output.
const REVIEWER_NAME = "리뷰어홍길동";
const BUYER_ID = "buyer_hong";
const BUYER_PHONE = "010-1111-2222";
const BUYER_EMAIL = "hong@example.com";
const BUYER_ADDRESS = "서울시 어딘가 123-45";
const ACCOUNT_ID = "acct_999";
const SELLER_ID = "seller_acme_123";
const MASTER_ID = "ESMMASTER_XYZ";

function rawReview(over: Partial<RawReview> = {}): RawReview {
  return {
    reviewRef: 778899,
    platform: "NAVER",
    channel: "smartstore_acme",
    productRef: 555,
    orderRef: 100200300,
    rating: 2,
    title: "색이 달라요",
    body: "사진이랑 색이 너무 다릅니다",
    optionText: "레드 / L",
    writtenAt: "2026-06-18T09:00:00.000Z",
    updatedAt: "2026-06-18T10:00:00.000Z",
    replyStatus: "미답변",
    collectionMethod: "browser_export",
    reviewerName: REVIEWER_NAME,
    buyerId: BUYER_ID,
    buyerPhone: BUYER_PHONE,
    buyerEmail: BUYER_EMAIL,
    buyerAddress: BUYER_ADDRESS,
    accountId: ACCOUNT_ID,
    sellerId: SELLER_ID,
    masterId: MASTER_ID,
    ...over,
  };
}

describe("normalizeReview", () => {
  it("maps a synthetic review to the normalized SellerOps event", () => {
    expect(normalizeReview(rawReview())).toEqual({
      eventId: "review:NAVER:smartstore_acme:778899",
      platform: "NAVER",
      kind: "review",
      channel: "smartstore_acme",
      productRef: "555",
      orderRef: "100200300",
      reviewRef: "778899",
      rating: 2,
      title: "색이 달라요",
      body: "사진이랑 색이 너무 다릅니다",
      optionText: "레드 / L",
      writtenAt: "2026-06-18T09:00:00.000Z",
      updatedAt: "2026-06-18T10:00:00.000Z",
      replyStatus: "not_replied",
      collectionMethod: "browser_export",
      // internal parsed epoch ms from the offset-bearing writtenAt
      eventTimeMs: 1_781_773_200_000,
    });
  });

  it("maps platform variants", () => {
    expect(normalizeReview(rawReview({ platform: "gmarket" })).platform).toBe("ESM_PLUS");
    expect(normalizeReview(rawReview({ platform: "cafe24" })).platform).toBe("CAFE24");
    expect(normalizeReview(rawReview({ platform: "coupang" })).platform).toBe("COUPANG");
    expect(normalizeReview(rawReview({ platform: "???" })).platform).toBe("UNKNOWN");
  });

  it("buckets ratings (1~2 low, 3 mid, 4~5 high, else unknown)", () => {
    const bucket = (r: RawReview["rating"]) =>
      sanitizedReviewSummary(normalizeReview(rawReview({ rating: r }))).ratingBucket;
    expect(bucket(1)).toBe("low");
    expect(bucket(2)).toBe("low");
    expect(bucket(3)).toBe("mid");
    expect(bucket(4)).toBe("high");
    expect(bucket(5)).toBe("high");
    expect(bucket("5")).toBe("high");
    expect(bucket(0)).toBe("unknown");
    expect(bucket(6)).toBe("unknown");
    expect(bucket(null)).toBe("unknown");
    expect(bucket("abc")).toBe("unknown");
  });

  it("maps reply-status variants (string + boolean)", () => {
    expect(normalizeReview(rawReview({ replyStatus: true })).replyStatus).toBe("replied");
    expect(normalizeReview(rawReview({ replyStatus: false })).replyStatus).toBe("not_replied");
    expect(normalizeReview(rawReview({ replyStatus: "답변완료" })).replyStatus).toBe("replied");
    expect(normalizeReview(rawReview({ replyStatus: "???" })).replyStatus).toBe("unknown");
    expect(normalizeReview(rawReview({ replyStatus: null })).replyStatus).toBe("unknown");
  });

  it("preserves a valid collectionMethod; unmapped → unknown", () => {
    expect(normalizeReview(rawReview({ collectionMethod: "official_api" })).collectionMethod).toBe("official_api");
    expect(normalizeReview(rawReview({ collectionMethod: "manual_upload" })).collectionMethod).toBe("manual_upload");
    expect(normalizeReview(rawReview({ collectionMethod: "scrape" })).collectionMethod).toBe("unknown");
    expect(normalizeReview(rawReview({ collectionMethod: null })).collectionMethod).toBe("unknown");
  });

  it("handles missing/optional fields safely", () => {
    const e = normalizeReview({});
    expect(e.platform).toBe("UNKNOWN");
    expect(e.channel).toBe("unknown");
    expect(e.productRef).toBeNull();
    expect(e.orderRef).toBeNull();
    expect(e.reviewRef).toBeNull();
    expect(e.rating).toBeNull();
    expect(e.title).toBeNull();
    expect(e.body).toBeNull();
    expect(e.optionText).toBeNull();
    expect(e.writtenAt).toBeNull();
    expect(e.updatedAt).toBeNull();
    expect(e.replyStatus).toBe("unknown");
    expect(e.collectionMethod).toBe("unknown");
    expect(e.eventId).toMatch(/^review:UNKNOWN:unknown:h:[0-9a-f]{16}$/);
  });

  it("builds a deterministic eventId from reviewRef when present", () => {
    expect(normalizeReview(rawReview({ reviewRef: "abc123" })).eventId).toBe(
      "review:NAVER:smartstore_acme:abc123",
    );
  });

  it("falls back to a content hash without reviewRef, distinct per content", () => {
    const a = normalizeReview(rawReview({ reviewRef: null, body: "first" }));
    const b = normalizeReview(rawReview({ reviewRef: null, body: "second" }));
    expect(a.eventId).toMatch(/^review:NAVER:smartstore_acme:h:[0-9a-f]{16}$/);
    expect(b.eventId).toMatch(/^review:NAVER:smartstore_acme:h:[0-9a-f]{16}$/);
    expect(a.eventId).not.toBe(b.eventId);
  });

  it("never carries reviewer/buyer/seller identity into the normalized event", () => {
    const serialized = JSON.stringify(normalizeReview(rawReview()));
    for (const id of [REVIEWER_NAME, BUYER_ID, BUYER_PHONE, BUYER_EMAIL, BUYER_ADDRESS, ACCOUNT_ID, SELLER_ID, MASTER_ID]) {
      expect(serialized).not.toContain(id);
    }
  });

  it("keeps review content (title/body/option) — that is the VOC value", () => {
    const e = normalizeReview(rawReview());
    expect(e.title).toBe("색이 달라요");
    expect(e.body).toBe("사진이랑 색이 너무 다릅니다");
    expect(e.optionText).toBe("레드 / L");
  });
});

describe("sanitizedReviewSummary", () => {
  it("exposes categories/booleans + a coarse rating bucket — never content, refs, ids, or identity", () => {
    const summary = sanitizedReviewSummary(normalizeReview(rawReview()));
    expect(summary).toEqual({
      platform: "NAVER",
      kind: "review",
      channel: "smartstore_acme",
      ratingBucket: "low",
      hasProductRef: true,
      hasReviewRef: true,
      hasBody: true,
      hasOptionText: true,
      hasWrittenAt: true,
      replyStatus: "not_replied",
      collectionMethod: "browser_export",
      recencyBucket: "unknown",
    });
    const serialized = JSON.stringify(summary);
    for (const leak of [
      "색이 달라요",
      "사진이랑 색이 너무 다릅니다",
      "레드 / L",
      "555",
      "778899",
      "100200300",
      REVIEWER_NAME,
      BUYER_ID,
      SELLER_ID,
      MASTER_ID,
    ]) {
      expect(serialized).not.toContain(leak);
    }
  });
});

describe("module boundary", () => {
  it("imports no network/fs/browser/env and maps no raw url/html/screenshot/token", () => {
    const src = readFileSync(
      join(__dirname, "..", "..", "src", "review", "review-normalizer.ts"),
      "utf8",
    );
    const imports = src
      .split("\n")
      .filter((l) => /^\s*import\b/.test(l) || /\bfrom\s+["']/.test(l))
      .join("\n");
    expect(/playwright/i.test(imports)).toBe(false);
    expect(/from\s+["'](node:)?fs(\/promises)?["']/.test(imports)).toBe(false);
    expect(/from\s+["'](node:)?https?["']/.test(imports)).toBe(false);
    expect(/process\.env|\bfetch\(|\baxios\b/.test(src)).toBe(false);
    // No raw-capture fields are mapped into the event. Check CODE only — doc
    // comments legitimately name these artifacts when explaining what is excluded.
    const code = src
      .split("\n")
      .filter((l) => {
        const t = l.trim();
        return !(t.startsWith("*") || t.startsWith("//") || t.startsWith("/*") || t.startsWith("*/"));
      })
      .join("\n");
    expect(/rawUrl|rawHtml|screenshot|\btoken\b/i.test(code)).toBe(false);
  });
});

describe("normalizeReview — internal eventTimeMs (Phase 2c-1)", () => {
  it("parses an offset-bearing writtenAt into internal eventTimeMs", () => {
    expect(normalizeReview({ platform: "NAVER", writtenAt: "1970-01-01T00:00:00Z" }).eventTimeMs).toBe(0);
    expect(normalizeReview({ platform: "NAVER", writtenAt: "1970-01-01T09:00:00+09:00" }).eventTimeMs).toBe(0);
    expect(normalizeReview({ platform: "NAVER", writtenAt: "1970-01-01T00:00:00-05:00" }).eventTimeMs).toBe(18_000_000);
  });

  it("omits eventTimeMs for timezone-less / invalid writtenAt", () => {
    expect(normalizeReview({ platform: "NAVER", writtenAt: "2026-06-18T09:00:00" })).not.toHaveProperty("eventTimeMs");
    expect(normalizeReview({ platform: "NAVER", writtenAt: "not-a-date" })).not.toHaveProperty("eventTimeMs");
    expect(normalizeReview({ platform: "NAVER", writtenAt: "2026-06-18T09:00:00+0900" })).not.toHaveProperty("eventTimeMs");
  });

  it("omits eventTimeMs for missing / null / blank writtenAt", () => {
    expect(normalizeReview({ platform: "NAVER" })).not.toHaveProperty("eventTimeMs");
    expect(normalizeReview({ platform: "NAVER", writtenAt: null })).not.toHaveProperty("eventTimeMs");
    expect(normalizeReview({ platform: "NAVER", writtenAt: "   " })).not.toHaveProperty("eventTimeMs");
  });

  it("preserves the raw writtenAt string regardless of parse outcome", () => {
    expect(normalizeReview({ platform: "NAVER", writtenAt: "1970-01-01T00:00:00Z" }).writtenAt).toBe("1970-01-01T00:00:00Z");
    expect(normalizeReview({ platform: "NAVER", writtenAt: "2026-06-18T09:00:00" }).writtenAt).toBe("2026-06-18T09:00:00");
  });
});

describe("normalizeReview — eventTimeMs is internal only", () => {
  const e = normalizeReview({ platform: "NAVER", channel: "smartstore_acme", rating: 1, writtenAt: "1970-01-01T00:00:00Z" });

  it("is present on the normalized event", () => {
    expect(e.eventTimeMs).toBe(0);
  });

  it("never appears in the sanitized review summary", () => {
    const summary = sanitizedReviewSummary(e);
    expect(summary).not.toHaveProperty("eventTimeMs");
    expect(JSON.stringify(summary)).not.toContain("eventTimeMs");
  });

  it("never appears in the event-dispatched sanitized summary", () => {
    expect(JSON.stringify(sanitizedSummaryFor(e))).not.toContain("eventTimeMs");
  });

  it("never appears in the attention view (digest + ranked rows) built from review input", () => {
    expect(JSON.stringify(attentionView([e]))).not.toContain("eventTimeMs");
  });
});

describe("sanitizedReviewSummary — recencyBucket (Phase 2d-1)", () => {
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;
  // writtenAt parses to eventTimeMs = 0 (Unix epoch).
  const epochReview = normalizeReview({ platform: "NAVER", writtenAt: "1970-01-01T00:00:00Z" });

  const bucketAt = (refMs: number) => sanitizedReviewSummary(epochReview, { referenceTimeMs: refMs }).recencyBucket;

  it("computes each boundary bucket from explicit referenceTimeMs", () => {
    expect(bucketAt(0)).toBe("fresh_0_2h");
    expect(bucketAt(2 * HOUR)).toBe("same_day_2_24h");
    expect(bucketAt(24 * HOUR)).toBe("recent_1_3d");
    expect(bucketAt(3 * DAY)).toBe("aging_3_7d");
    expect(bucketAt(7 * DAY)).toBe("stale_over_7d");
  });

  it("returns unknown when referenceTimeMs is missing / non-finite", () => {
    expect(sanitizedReviewSummary(epochReview).recencyBucket).toBe("unknown");
    expect(sanitizedReviewSummary(epochReview, {}).recencyBucket).toBe("unknown");
    expect(sanitizedReviewSummary(epochReview, { referenceTimeMs: Number.NaN }).recencyBucket).toBe("unknown");
    expect(sanitizedReviewSummary(epochReview, { referenceTimeMs: Number.POSITIVE_INFINITY }).recencyBucket).toBe("unknown");
  });

  it("returns unknown when the event has no eventTimeMs (timezone-less writtenAt)", () => {
    const noTime = normalizeReview({ platform: "NAVER", writtenAt: "2026-06-18T09:00:00" });
    expect(noTime).not.toHaveProperty("eventTimeMs");
    expect(sanitizedReviewSummary(noTime, { referenceTimeMs: 1_000_000 }).recencyBucket).toBe("unknown");
  });

  it("returns unknown for a future eventTimeMs", () => {
    const future = normalizeReview({ platform: "NAVER", writtenAt: "1970-01-01T01:00:00Z" }); // eventTimeMs = 3_600_000
    expect(sanitizedReviewSummary(future, { referenceTimeMs: 0 }).recencyBucket).toBe("unknown");
  });

  it("never exposes eventTimeMs, raw writtenAt, or elapsed duration", () => {
    const summary = sanitizedReviewSummary(epochReview, { referenceTimeMs: 5 * HOUR });
    expect(summary.recencyBucket).toBe("same_day_2_24h");
    expect(summary).not.toHaveProperty("eventTimeMs");
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("eventTimeMs");
    expect(serialized).not.toContain("1970-01-01T00:00:00Z"); // raw writtenAt
    expect(serialized).not.toContain(String(5 * HOUR)); // elapsed duration must not leak
  });
});

describe("sanitizedSummaryFor — forwards referenceTimeMs to review (Phase 2d-1)", () => {
  const HOUR = 60 * 60 * 1000;
  const epochReview = normalizeReview({ platform: "NAVER", writtenAt: "1970-01-01T00:00:00Z" });

  it("forwards referenceTimeMs into the review recencyBucket", () => {
    const s = sanitizedSummaryFor(epochReview, { referenceTimeMs: 2 * HOUR });
    expect(s.kind).toBe("review");
    if (s.kind === "review") expect(s.recencyBucket).toBe("same_day_2_24h");
  });

  it("without options, review recencyBucket is unknown", () => {
    const s = sanitizedSummaryFor(epochReview);
    if (s.kind === "review") expect(s.recencyBucket).toBe("unknown");
  });

  it("attention view built from a review never carries eventTimeMs", () => {
    expect(JSON.stringify(attentionView([epochReview]))).not.toContain("eventTimeMs");
  });
});
