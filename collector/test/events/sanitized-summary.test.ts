import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sanitizedSummaryFor } from "../../src/events/sanitized-summary";
import { normalizeEsmClaim } from "../../src/esmplus/claim-normalizer";
import { normalizeEsmInquiry } from "../../src/esmplus/inquiry-normalizer";
import { normalizeEsmOrder } from "../../src/esmplus/order-normalizer";
import { normalizeEsmSalesContext } from "../../src/esmplus/sales-context-normalizer";
import { normalizeReview } from "../../src/review/review-normalizer";

// Synthetic content/identity that must never surface through the dispatched summary.
const REVIEW_BODY = "사진이랑 색이 너무 다릅니다";
const REVIEW_TITLE = "색이 달라요";
const REVIEW_OPTION = "레드 / L";
const INQUIRY_BODY = "언제 배송되나요 정말 궁금합니다";
const INQUIRY_TITLE = "배송 문의드립니다";
const CLAIM_REASON = "받은 상품에 흠집이 있습니다";
const ORDER_TITLE = "테스트 상품";
const GROSS = 4500000;
const SETTLE = 4180000;
const REVIEWER = "리뷰어홍길동";
const SELLER_ID = "seller_acme_123";
const MASTER_ID = "ESMMASTER_XYZ";

const reviewEvent = normalizeReview({
  reviewRef: 778899,
  platform: "NAVER",
  channel: "smartstore_acme",
  productRef: 555,
  rating: 2,
  title: REVIEW_TITLE,
  body: REVIEW_BODY,
  optionText: REVIEW_OPTION,
  reviewerName: REVIEWER,
  sellerId: SELLER_ID,
});

const inquiryEvent = normalizeEsmInquiry({
  inquiryNo: 123456,
  siteGubun: "GMARKET",
  title: INQUIRY_TITLE,
  contents: INQUIRY_BODY,
  buyerName: REVIEWER,
});

const orderEvent = normalizeEsmOrder({
  orderNo: 100200300,
  siteGubun: "GMARKET",
  orderStatus: "배송중",
  itemName: ORDER_TITLE,
  quantity: 2,
});

const claimEvent = normalizeEsmClaim({
  claimNo: 900800700,
  siteGubun: "AUCTION",
  claimType: "반품신청",
  reasonName: "상품불량",
  reasonText: CLAIM_REASON,
});

const salesEvent = normalizeEsmSalesContext({
  settlementNo: 50607080,
  siteGubun: "GMARKET",
  grossSalesAmount: GROSS,
  settlementAmount: SETTLE,
  orderCount: 120,
  currency: "KRW",
  sellerId: SELLER_ID,
  masterId: MASTER_ID,
});

describe("sanitizedSummaryFor dispatch", () => {
  it("dispatches each event kind to its matching sanitized summary", () => {
    expect(sanitizedSummaryFor(reviewEvent).kind).toBe("review");
    expect(sanitizedSummaryFor(inquiryEvent).kind).toBe("cs_inquiry");
    expect(sanitizedSummaryFor(orderEvent).kind).toBe("order_shipping");
    expect(sanitizedSummaryFor(claimEvent).kind).toBe("claim");
    expect(sanitizedSummaryFor(salesEvent).kind).toBe("sales_context");
  });

  it("returns the same shape as the per-normalizer sanitized summary (review)", () => {
    const s = sanitizedSummaryFor(reviewEvent);
    expect(s).toMatchObject({
      platform: "NAVER",
      kind: "review",
      channel: "smartstore_acme",
      ratingBucket: "low",
      hasBody: true,
      replyStatus: "unknown",
      collectionMethod: "unknown",
    });
  });

  it("sales_context summary exposes amountBucket, never the exact amount", () => {
    const s = sanitizedSummaryFor(salesEvent);
    expect(s).toMatchObject({ kind: "sales_context", amountBucket: "1m_to_10m" });
    const serialized = JSON.stringify(s);
    expect(serialized).not.toContain(String(GROSS));
    expect(serialized).not.toContain(String(SETTLE));
  });
});

describe("dispatched summaries leak nothing sensitive", () => {
  it("never exposes content, reference codes, exact amounts/counts, or identity", () => {
    const events = [reviewEvent, inquiryEvent, orderEvent, claimEvent, salesEvent];
    const serialized = JSON.stringify(events.map(sanitizedSummaryFor));
    const forbidden = [
      // content
      REVIEW_BODY, REVIEW_TITLE, REVIEW_OPTION, INQUIRY_BODY, INQUIRY_TITLE, CLAIM_REASON, ORDER_TITLE,
      // reference codes
      "778899", "555", "123456", "100200300", "900800700", "50607080",
      // exact amounts / counts
      String(GROSS), String(SETTLE), "120",
      // identity
      REVIEWER, SELLER_ID, MASTER_ID,
    ];
    for (const leak of forbidden) {
      expect(serialized).not.toContain(leak);
    }
  });
});

describe("module boundary", () => {
  it("imports no network/fs/browser/env in the dispatcher or the event types", () => {
    for (const rel of [
      ["src", "events", "sanitized-summary.ts"],
      ["src", "events", "types.ts"],
    ]) {
      const src = readFileSync(join(__dirname, "..", "..", ...rel), "utf8");
      const imports = src
        .split("\n")
        .filter((l) => /^\s*import\b/.test(l) || /\bfrom\s+["']/.test(l))
        .join("\n");
      expect(/playwright/i.test(imports)).toBe(false);
      expect(/from\s+["'](node:)?fs(\/promises)?["']/.test(imports)).toBe(false);
      expect(/from\s+["'](node:)?https?["']/.test(imports)).toBe(false);
      expect(/process\.env|\bfetch\(|\baxios\b/.test(src)).toBe(false);
    }
  });
});
