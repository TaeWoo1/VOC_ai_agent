import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { attentionSignalsFor } from "../../src/events/attention-signals";
import { normalizeEsmClaim } from "../../src/esmplus/claim-normalizer";
import { normalizeEsmInquiry } from "../../src/esmplus/inquiry-normalizer";
import { normalizeEsmOrder } from "../../src/esmplus/order-normalizer";
import { normalizeEsmSalesContext } from "../../src/esmplus/sales-context-normalizer";
import { normalizeReview } from "../../src/review/review-normalizer";

// Synthetic content/identity that must never surface through a signal.
const REVIEW_BODY = "사진이랑 색이 너무 다릅니다";
const CLAIM_REASON = "받은 상품에 흠집이 있습니다";
const SELLER_ID = "seller_acme_123";
const MASTER_ID = "ESMMASTER_XYZ";
const GROSS = 45_000_000;

const codes = (signals: { code: string }[]) => signals.map((s) => s.code);

describe("review attention signals", () => {
  it("low-rating review emits low_rating_review (high)", () => {
    const e = normalizeReview({ platform: "NAVER", rating: 1, body: REVIEW_BODY });
    const signals = attentionSignalsFor(e);
    expect(codes(signals)).toContain("low_rating_review");
    expect(signals.find((s) => s.code === "low_rating_review")?.severity).toBe("high");
  });

  it("not-replied review emits not_replied_review (medium)", () => {
    const e = normalizeReview({ platform: "NAVER", rating: 5, replyStatus: "미답변" });
    const signals = attentionSignalsFor(e);
    expect(codes(signals)).toEqual(["not_replied_review"]);
    expect(signals[0]?.severity).toBe("medium");
  });

  it("high-rating, replied review emits no high/medium signal (no content-availability noise)", () => {
    const e = normalizeReview({ platform: "NAVER", rating: 5, body: REVIEW_BODY, replyStatus: "답변완료" });
    expect(attentionSignalsFor(e)).toEqual([]);
  });

  it("low-rating + not-replied review emits both, in deterministic order", () => {
    const e = normalizeReview({ platform: "NAVER", rating: 2, replyStatus: "미답변" });
    expect(codes(attentionSignalsFor(e))).toEqual(["low_rating_review", "not_replied_review"]);
  });
});

describe("inquiry attention signals", () => {
  it("open inquiry emits unanswered_inquiry (medium)", () => {
    const e = normalizeEsmInquiry({ siteGubun: "GMARKET", answerYn: "N", contents: "언제 오나요" });
    const signals = attentionSignalsFor(e);
    expect(codes(signals)).toEqual(["unanswered_inquiry"]);
    expect(signals[0]?.severity).toBe("medium");
  });

  it("answered inquiry emits no signal", () => {
    const e = normalizeEsmInquiry({ siteGubun: "GMARKET", answerYn: "Y" });
    expect(attentionSignalsFor(e)).toEqual([]);
  });
});

describe("claim attention signals", () => {
  it("open/in-progress claim emits active_claim (high)", () => {
    const open = normalizeEsmClaim({ siteGubun: "AUCTION", claimStatus: "접수", reasonText: CLAIM_REASON });
    const inProgress = normalizeEsmClaim({ siteGubun: "AUCTION", claimStatus: "처리중", reasonText: CLAIM_REASON });
    expect(codes(attentionSignalsFor(open))).toEqual(["active_claim"]);
    expect(codes(attentionSignalsFor(inProgress))).toEqual(["active_claim"]);
    expect(attentionSignalsFor(open).find((s) => s.code === "active_claim")?.severity).toBe("high");
  });

  it("resolved claim emits no active_claim", () => {
    const e = normalizeEsmClaim({ siteGubun: "AUCTION", claimStatus: "완료처리" });
    expect(codes(attentionSignalsFor(e))).not.toContain("active_claim");
  });
});

describe("order attention signals", () => {
  it("order events emit no signal in this layer yet", () => {
    const e = normalizeEsmOrder({ siteGubun: "GMARKET", orderStatus: "배송중", itemName: "테스트 상품" });
    expect(attentionSignalsFor(e)).toEqual([]);
  });
});

describe("sales context attention signals", () => {
  it("high amountBucket emits high_sales_context (high) + sales_context_available, deterministic order", () => {
    const e = normalizeEsmSalesContext({
      siteGubun: "GMARKET",
      grossSalesAmount: GROSS,
      orderCount: 100,
      sellerId: SELLER_ID,
      masterId: MASTER_ID,
    });
    expect(codes(attentionSignalsFor(e))).toEqual(["high_sales_context", "sales_context_available"]);
    expect(attentionSignalsFor(e).find((s) => s.code === "high_sales_context")?.severity).toBe("high");
  });

  it("context present but not high → only sales_context_available (low)", () => {
    const e = normalizeEsmSalesContext({ siteGubun: "GMARKET", grossSalesAmount: 50_000 });
    const signals = attentionSignalsFor(e);
    expect(codes(signals)).toEqual(["sales_context_available"]);
    expect(signals[0]?.severity).toBe("low");
  });

  it("no amount/count context → no sales signal", () => {
    const e = normalizeEsmSalesContext({ siteGubun: "GMARKET" });
    expect(attentionSignalsFor(e)).toEqual([]);
  });
});

describe("signals leak nothing sensitive", () => {
  it("never include raw text, refs/ids, exact amounts/counts, or identity", () => {
    const events = [
      normalizeReview({ platform: "NAVER", rating: 1, body: REVIEW_BODY, reviewRef: 778899, productRef: 555 }),
      normalizeEsmClaim({ siteGubun: "AUCTION", claimStatus: "접수", reasonText: CLAIM_REASON, claimNo: 900800700 }),
      normalizeEsmSalesContext({ siteGubun: "GMARKET", grossSalesAmount: GROSS, orderCount: 100, sellerId: SELLER_ID, masterId: MASTER_ID, settlementNo: 50607080 }),
    ];
    const serialized = JSON.stringify(events.map(attentionSignalsFor));
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
  it("imports no network/fs/browser/env and no AI client", () => {
    const src = readFileSync(
      join(__dirname, "..", "..", "src", "events", "attention-signals.ts"),
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
  });
});
