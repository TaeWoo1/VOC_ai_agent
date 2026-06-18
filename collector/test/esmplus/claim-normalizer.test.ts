import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  normalizeEsmClaim,
  sanitizedClaimSummary,
  type RawEsmClaim,
} from "../../src/esmplus/claim-normalizer";

const BUYER_NAME = "구매자홍길동";
const BUYER_PHONE = "010-1111-2222";
const RECEIVER_ADDR = "서울시 어딘가 123-45";

function rawClaim(over: Partial<RawEsmClaim> = {}): RawEsmClaim {
  return {
    claimNo: 900800700,
    siteGubun: "AUCTION",
    claimType: "반품신청",
    claimStatus: "처리중",
    regDt: "2026-06-18T09:00:00.000Z",
    updateDt: "2026-06-18T11:00:00.000Z",
    itemNo: 555,
    orderNo: 100200300,
    reasonName: "상품불량",
    reasonText: "받은 상품에 흠집이 있습니다",
    buyerName: BUYER_NAME,
    buyerId: "buyer_hong",
    buyerPhone: BUYER_PHONE,
    receiverName: "수령인김철수",
    receiverPhone: "010-3333-4444",
    receiverAddress: RECEIVER_ADDR,
    ...over,
  };
}

describe("normalizeEsmClaim", () => {
  it("maps a synthetic return claim to the normalized SellerOps event", () => {
    expect(normalizeEsmClaim(rawClaim())).toEqual({
      eventId: "esmplus:auction:claim:900800700",
      platform: "ESM_PLUS",
      kind: "claim",
      channel: "auction",
      claimType: "return",
      status: "in_progress",
      createdAt: "2026-06-18T09:00:00.000Z",
      updatedAt: "2026-06-18T11:00:00.000Z",
      productRef: "555",
      orderRef: "100200300",
      claimRef: "900800700",
      reasonCategory: "product",
      reasonText: "받은 상품에 흠집이 있습니다",
    });
  });

  it("maps claim type variants", () => {
    expect(normalizeEsmClaim(rawClaim({ claimType: "주문취소" })).claimType).toBe("cancel");
    expect(normalizeEsmClaim(rawClaim({ claimType: "교환요청" })).claimType).toBe("exchange");
    expect(normalizeEsmClaim(rawClaim({ claimType: "환불" })).claimType).toBe("refund");
    expect(normalizeEsmClaim(rawClaim({ claimType: "???" })).claimType).toBe("unknown");
    expect(normalizeEsmClaim(rawClaim({ claimType: null })).claimType).toBe("unknown");
  });

  it("maps claim status variants", () => {
    expect(normalizeEsmClaim(rawClaim({ claimStatus: "접수" })).status).toBe("open");
    expect(normalizeEsmClaim(rawClaim({ claimStatus: "완료처리" })).status).toBe("resolved");
    expect(normalizeEsmClaim(rawClaim({ claimStatus: "반려" })).status).toBe("rejected");
    expect(normalizeEsmClaim(rawClaim({ claimStatus: "???" })).status).toBe("unknown");
  });

  it("maps reason categories conservatively (unmapped → other, absent → unknown)", () => {
    expect(normalizeEsmClaim(rawClaim({ reasonName: "배송지연" })).reasonCategory).toBe("delivery");
    expect(normalizeEsmClaim(rawClaim({ reasonName: "단순변심" })).reasonCategory).toBe("customer_change");
    expect(normalizeEsmClaim(rawClaim({ reasonName: "결제오류" })).reasonCategory).toBe("payment");
    expect(normalizeEsmClaim(rawClaim({ reasonName: "기타사유" })).reasonCategory).toBe("other");
    expect(normalizeEsmClaim(rawClaim({ reasonName: null })).reasonCategory).toBe("unknown");
  });

  it("handles missing/optional fields safely", () => {
    const e = normalizeEsmClaim({});
    expect(e.platform).toBe("ESM_PLUS");
    expect(e.channel).toBe("unknown");
    expect(e.claimType).toBe("unknown");
    expect(e.status).toBe("unknown");
    expect(e.reasonCategory).toBe("unknown");
    expect(e.reasonText).toBeNull();
    expect(e.orderRef).toBeNull();
    expect(e.claimRef).toBeNull();
    expect(e.eventId).toMatch(/^esmplus:unknown:claim:h:[0-9a-f]{16}$/);
  });

  it("never carries buyer/recipient PII into the normalized event", () => {
    const serialized = JSON.stringify(normalizeEsmClaim(rawClaim()));
    for (const pii of [BUYER_NAME, BUYER_PHONE, "buyer_hong", "수령인김철수", "010-3333-4444", RECEIVER_ADDR]) {
      expect(serialized).not.toContain(pii);
    }
  });

  it("produces distinct content-hash ids for distinct id-less claims", () => {
    const a = normalizeEsmClaim({ siteGubun: "AUCTION", orderNo: 1 });
    const b = normalizeEsmClaim({ siteGubun: "AUCTION", orderNo: 2 });
    expect(a.eventId).not.toBe(b.eventId);
  });
});

describe("sanitizedClaimSummary", () => {
  it("exposes only categories/booleans — never content, refs, ids, or PII", () => {
    const summary = sanitizedClaimSummary(normalizeEsmClaim(rawClaim()));
    expect(summary).toEqual({
      platform: "ESM_PLUS",
      kind: "claim",
      channel: "auction",
      claimType: "return",
      status: "in_progress",
      reasonCategory: "product",
      hasReasonText: true,
      hasOrderRef: true,
      hasProductRef: true,
      hasClaimRef: true,
      hasCreatedAt: true,
      hasUpdatedAt: true,
    });
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("900800700");
    expect(serialized).not.toContain("흠집");
    expect(serialized).not.toContain(BUYER_NAME);
  });
});

describe("module boundary", () => {
  it("imports no network/fs/browser/env", () => {
    const src = readFileSync(join(__dirname, "..", "..", "src", "esmplus", "claim-normalizer.ts"), "utf8");
    const imports = src
      .split("\n")
      .filter((l) => /^\s*import\b/.test(l) || /\bfrom\s+["']/.test(l))
      .join("\n");
    expect(/playwright/i.test(imports)).toBe(false);
    expect(/from\s+["'](node:)?fs(\/promises)?["']/.test(imports)).toBe(false);
    expect(/from\s+["'](node:)?https?["']/.test(imports)).toBe(false);
    expect(/process\.env|\bfetch\(|\baxios\b/.test(src)).toBe(false);
  });
});
