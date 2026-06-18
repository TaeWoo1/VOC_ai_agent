import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  normalizeEsmOrder,
  sanitizedOrderSummary,
  type RawEsmOrder,
} from "../../src/esmplus/order-normalizer";

// Synthetic only — buyer/recipient identity here must never reach output.
const BUYER_NAME = "구매자홍길동";
const BUYER_PHONE = "010-1111-2222";
const RECEIVER_NAME = "수령인김철수";
const RECEIVER_ADDR = "서울시 어딘가 123-45";

function rawOrder(over: Partial<RawEsmOrder> = {}): RawEsmOrder {
  return {
    orderNo: 100200300,
    siteGubun: "GMARKET",
    orderStatus: "배송중",
    orderDt: "2026-06-18T09:00:00.000Z",
    updateDt: "2026-06-18T12:00:00.000Z",
    itemNo: 555,
    shipmentNo: 777,
    itemName: "테스트 상품",
    quantity: 2,
    buyerName: BUYER_NAME,
    buyerId: "buyer_hong",
    buyerPhone: BUYER_PHONE,
    buyerEmail: "hong@example.com",
    receiverName: RECEIVER_NAME,
    receiverPhone: "010-3333-4444",
    receiverAddress: RECEIVER_ADDR,
    ...over,
  };
}

describe("normalizeEsmOrder", () => {
  it("maps a synthetic order to the normalized SellerOps event", () => {
    expect(normalizeEsmOrder(rawOrder())).toEqual({
      eventId: "esmplus:gmarket:order:100200300",
      platform: "ESM_PLUS",
      kind: "order_shipping",
      channel: "gmarket",
      status: "shipped",
      orderedAt: "2026-06-18T09:00:00.000Z",
      updatedAt: "2026-06-18T12:00:00.000Z",
      productRef: "555",
      orderRef: "100200300",
      shipmentRef: "777",
      title: "테스트 상품",
      quantity: 2,
    });
  });

  it("maps channel and status variants", () => {
    expect(normalizeEsmOrder(rawOrder({ siteGubun: "AUCTION" })).channel).toBe("auction");
    expect(normalizeEsmOrder(rawOrder({ siteGubun: "??" })).channel).toBe("unknown");
    expect(normalizeEsmOrder(rawOrder({ orderStatus: "배송완료" })).status).toBe("delivered");
    expect(normalizeEsmOrder(rawOrder({ orderStatus: "주문취소" })).status).toBe("cancelled");
    expect(normalizeEsmOrder(rawOrder({ orderStatus: "상품준비중" })).status).toBe("preparing");
    expect(normalizeEsmOrder(rawOrder({ orderStatus: "신규주문" })).status).toBe("new_order");
    expect(normalizeEsmOrder(rawOrder({ orderStatus: "???" })).status).toBe("unknown");
    expect(normalizeEsmOrder(rawOrder({ orderStatus: null })).status).toBe("unknown");
  });

  it("parses quantity safely (string digits ok; non-numeric → null)", () => {
    expect(normalizeEsmOrder(rawOrder({ quantity: "3" })).quantity).toBe(3);
    expect(normalizeEsmOrder(rawOrder({ quantity: "abc" })).quantity).toBeNull();
    expect(normalizeEsmOrder(rawOrder({ quantity: 1.5 })).quantity).toBe(1.5);
    expect(normalizeEsmOrder(rawOrder({ quantity: null })).quantity).toBeNull();
  });

  it("handles missing/empty optional fields safely", () => {
    const e = normalizeEsmOrder({});
    expect(e.platform).toBe("ESM_PLUS");
    expect(e.channel).toBe("unknown");
    expect(e.status).toBe("unknown");
    expect(e.orderedAt).toBeNull();
    expect(e.productRef).toBeNull();
    expect(e.orderRef).toBeNull();
    expect(e.shipmentRef).toBeNull();
    expect(e.title).toBeNull();
    expect(e.quantity).toBeNull();
    expect(e.eventId).toMatch(/^esmplus:unknown:order:h:[0-9a-f]{16}$/);
  });

  it("never carries buyer/recipient PII into the normalized event", () => {
    const serialized = JSON.stringify(normalizeEsmOrder(rawOrder()));
    for (const pii of [BUYER_NAME, BUYER_PHONE, "buyer_hong", "hong@example.com", RECEIVER_NAME, "010-3333-4444", RECEIVER_ADDR]) {
      expect(serialized).not.toContain(pii);
    }
  });

  it("produces distinct content-hash ids for distinct id-less orders", () => {
    const a = normalizeEsmOrder({ siteGubun: "GMARKET", itemNo: 1 });
    const b = normalizeEsmOrder({ siteGubun: "GMARKET", itemNo: 2 });
    expect(a.eventId).not.toBe(b.eventId);
  });
});

describe("sanitizedOrderSummary", () => {
  it("exposes only categories/booleans — never refs, ids, content, or PII", () => {
    const summary = sanitizedOrderSummary(normalizeEsmOrder(rawOrder()));
    expect(summary).toEqual({
      platform: "ESM_PLUS",
      kind: "order_shipping",
      channel: "gmarket",
      status: "shipped",
      hasOrderRef: true,
      hasProductRef: true,
      hasShipmentRef: true,
      hasTitle: true,
      hasQuantity: true,
      hasOrderedAt: true,
      hasUpdatedAt: true,
    });
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("100200300");
    expect(serialized).not.toContain("테스트 상품");
    expect(serialized).not.toContain(BUYER_NAME);
  });
});

describe("module boundary", () => {
  it("imports no network/fs/browser/env", () => {
    const src = readFileSync(join(__dirname, "..", "..", "src", "esmplus", "order-normalizer.ts"), "utf8");
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
