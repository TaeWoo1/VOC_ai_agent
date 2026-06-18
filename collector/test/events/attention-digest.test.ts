import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { attentionDigest } from "../../src/events/attention-digest";
import { normalizeEsmClaim } from "../../src/esmplus/claim-normalizer";
import { normalizeEsmInquiry } from "../../src/esmplus/inquiry-normalizer";
import { normalizeEsmOrder } from "../../src/esmplus/order-normalizer";
import { normalizeEsmSalesContext } from "../../src/esmplus/sales-context-normalizer";
import { normalizeReview } from "../../src/review/review-normalizer";

// Synthetic content/identity that must never surface through the digest.
const REVIEW_BODY = "사진이랑 색이 너무 다릅니다";
const CLAIM_REASON = "받은 상품에 흠집이 있습니다";
const SELLER_ID = "seller_acme_123";
const MASTER_ID = "ESMMASTER_XYZ";
const GROSS = 45_000_000;

describe("attentionDigest — empty", () => {
  it("empty input returns a zero digest", () => {
    expect(attentionDigest([])).toEqual({
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

describe("attentionDigest — single low-rating review", () => {
  it("counts the event, its signal, severity, kind, platform, channel", () => {
    const e = normalizeReview({ platform: "NAVER", channel: "smartstore_acme", rating: 1, body: REVIEW_BODY });
    const d = attentionDigest([e]);
    expect(d.totalEvents).toBe(1);
    expect(d.totalSignals).toBe(1);
    expect(d.bySignalCode).toEqual([{ code: "low_rating_review", count: 1 }]);
    expect(d.bySeverity).toEqual([{ severity: "high", count: 1 }]);
    expect(d.byEventKind).toEqual([{ kind: "review", count: 1 }]);
    expect(d.byPlatform).toEqual([{ platform: "NAVER", count: 1 }]);
    expect(d.byChannel).toEqual([{ channel: "smartstore_acme", count: 1 }]);
  });
});

describe("attentionDigest — mixed batch", () => {
  const events = [
    normalizeReview({ platform: "NAVER", channel: "smartstore_acme", rating: 2, replyStatus: "미답변", body: REVIEW_BODY }),
    normalizeEsmInquiry({ siteGubun: "GMARKET", answerYn: "N", contents: "언제 오나요" }),
    normalizeEsmClaim({ siteGubun: "AUCTION", claimStatus: "접수", reasonText: CLAIM_REASON }),
    normalizeEsmSalesContext({ siteGubun: "GMARKET", grossSalesAmount: GROSS, orderCount: 100, sellerId: SELLER_ID, masterId: MASTER_ID }),
    normalizeEsmOrder({ siteGubun: "GMARKET", orderStatus: "배송중", itemName: "테스트 상품" }),
  ];
  const d = attentionDigest(events);

  it("counts all five events", () => {
    expect(d.totalEvents).toBe(5);
  });

  it("aggregates signals across review + inquiry + claim + sales (order has none)", () => {
    // review: low_rating_review + not_replied_review; inquiry: unanswered_inquiry;
    // claim: active_claim; sales: high_sales_context + sales_context_available; order: 0
    expect(d.totalSignals).toBe(6);
    expect(d.bySignalCode).toEqual([
      { code: "low_rating_review", count: 1 },
      { code: "not_replied_review", count: 1 },
      { code: "unanswered_inquiry", count: 1 },
      { code: "active_claim", count: 1 },
      { code: "sales_context_available", count: 1 },
      { code: "high_sales_context", count: 1 },
    ]);
  });

  it("orders severities high → medium → low", () => {
    expect(d.bySeverity).toEqual([
      { severity: "high", count: 3 }, // low_rating_review, active_claim, high_sales_context
      { severity: "medium", count: 2 }, // not_replied_review, unanswered_inquiry
      { severity: "low", count: 1 }, // sales_context_available
    ]);
  });

  it("orders event kinds by the fixed declared order, counting order_shipping too", () => {
    expect(d.byEventKind).toEqual([
      { kind: "review", count: 1 },
      { kind: "cs_inquiry", count: 1 },
      { kind: "claim", count: 1 },
      { kind: "order_shipping", count: 1 },
      { kind: "sales_context", count: 1 },
    ]);
  });

  it("orders platform/channel lexicographically (platform is the coarse tag, not the channel)", () => {
    // inquiry/claim/sales/order all carry platform "ESM_PLUS"; review carries "NAVER".
    expect(d.byPlatform).toEqual([
      { platform: "ESM_PLUS", count: 4 },
      { platform: "NAVER", count: 1 },
    ]);
    // channels: review smartstore_acme; inquiry/sales/order gmarket; claim auction.
    expect(d.byChannel).toEqual([
      { channel: "auction", count: 1 },
      { channel: "gmarket", count: 3 },
      { channel: "smartstore_acme", count: 1 },
    ]);
  });
});

describe("attentionDigest — high sales context", () => {
  it("contributes high_sales_context and sales_context_available", () => {
    const e = normalizeEsmSalesContext({ siteGubun: "GMARKET", grossSalesAmount: GROSS, orderCount: 100 });
    const d = attentionDigest([e]);
    expect(d.bySignalCode).toEqual([
      { code: "sales_context_available", count: 1 },
      { code: "high_sales_context", count: 1 },
    ]);
    expect(d.totalSignals).toBe(2);
  });
});

describe("attentionDigest — order events with no signals", () => {
  it("counts the event kind but contributes zero signals", () => {
    const e = normalizeEsmOrder({ siteGubun: "GMARKET", orderStatus: "배송완료" });
    const d = attentionDigest([e]);
    expect(d.totalEvents).toBe(1);
    expect(d.totalSignals).toBe(0);
    expect(d.bySignalCode).toEqual([]);
    expect(d.byEventKind).toEqual([{ kind: "order_shipping", count: 1 }]);
  });
});

describe("attentionDigest — no leakage", () => {
  it("never exposes content, refs/ids, exact amounts/counts, or identity", () => {
    const events = [
      normalizeReview({ platform: "NAVER", rating: 1, body: REVIEW_BODY, reviewRef: 778899, productRef: 555 }),
      normalizeEsmClaim({ siteGubun: "AUCTION", claimStatus: "접수", reasonText: CLAIM_REASON, claimNo: 900800700 }),
      normalizeEsmSalesContext({ siteGubun: "GMARKET", grossSalesAmount: GROSS, orderCount: 100, sellerId: SELLER_ID, masterId: MASTER_ID, settlementNo: 50607080 }),
    ];
    const serialized = JSON.stringify(attentionDigest(events));
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
      join(__dirname, "..", "..", "src", "events", "attention-digest.ts"),
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
