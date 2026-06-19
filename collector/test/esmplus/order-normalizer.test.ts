import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  normalizeEsmOrder,
  sanitizedOrderSummary,
  type RawEsmOrder,
} from "../../src/esmplus/order-normalizer";
import { sanitizedSummaryFor } from "../../src/events/sanitized-summary";
import { attentionView } from "../../src/events/attention-view";

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
      // internal parsed epoch ms from the offset-bearing orderedAt (orderDt)
      eventTimeMs: 1_781_773_200_000,
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
      recencyBucket: "unknown",
    });
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("100200300");
    expect(serialized).not.toContain("테스트 상품");
    expect(serialized).not.toContain(BUYER_NAME);
  });
});

describe("normalizeEsmOrder — internal eventTimeMs (Phase 2c)", () => {
  it("parses an offset-bearing orderedAt (orderDt) into internal eventTimeMs", () => {
    expect(normalizeEsmOrder({ siteGubun: "GMARKET", orderDt: "1970-01-01T00:00:00Z" }).eventTimeMs).toBe(0);
    expect(normalizeEsmOrder({ siteGubun: "GMARKET", orderDt: "1970-01-01T09:00:00+09:00" }).eventTimeMs).toBe(0);
    expect(normalizeEsmOrder({ siteGubun: "GMARKET", orderDt: "1970-01-01T00:00:00-05:00" }).eventTimeMs).toBe(18_000_000);
  });

  it("omits eventTimeMs for timezone-less / invalid orderedAt", () => {
    expect(normalizeEsmOrder({ siteGubun: "GMARKET", orderDt: "2026-06-18T09:00:00" })).not.toHaveProperty("eventTimeMs");
    expect(normalizeEsmOrder({ siteGubun: "GMARKET", orderDt: "not-a-date" })).not.toHaveProperty("eventTimeMs");
    expect(normalizeEsmOrder({ siteGubun: "GMARKET", orderDt: "2026-06-18T09:00:00+0900" })).not.toHaveProperty("eventTimeMs");
  });

  it("omits eventTimeMs for missing / null / blank orderedAt", () => {
    expect(normalizeEsmOrder({ siteGubun: "GMARKET" })).not.toHaveProperty("eventTimeMs");
    expect(normalizeEsmOrder({ siteGubun: "GMARKET", orderDt: null })).not.toHaveProperty("eventTimeMs");
    expect(normalizeEsmOrder({ siteGubun: "GMARKET", orderDt: "   " })).not.toHaveProperty("eventTimeMs");
  });

  it("preserves the raw orderedAt string regardless of parse outcome", () => {
    expect(normalizeEsmOrder({ siteGubun: "GMARKET", orderDt: "1970-01-01T00:00:00Z" }).orderedAt).toBe("1970-01-01T00:00:00Z");
    expect(normalizeEsmOrder({ siteGubun: "GMARKET", orderDt: "2026-06-18T09:00:00" }).orderedAt).toBe("2026-06-18T09:00:00");
  });
});

describe("normalizeEsmOrder — eventTimeMs is internal only", () => {
  const e = normalizeEsmOrder({ siteGubun: "GMARKET", orderStatus: "배송중", orderDt: "1970-01-01T00:00:00Z" });

  it("is present on the normalized event", () => {
    expect(e.eventTimeMs).toBe(0);
  });

  it("never appears in the sanitized order summary", () => {
    const summary = sanitizedOrderSummary(e);
    expect(summary).not.toHaveProperty("eventTimeMs");
    expect(JSON.stringify(summary)).not.toContain("eventTimeMs");
  });

  it("never appears in the event-dispatched sanitized summary", () => {
    expect(JSON.stringify(sanitizedSummaryFor(e))).not.toContain("eventTimeMs");
  });

  it("never appears in the attention view (digest + ranked rows) built from order input", () => {
    expect(JSON.stringify(attentionView([e]))).not.toContain("eventTimeMs");
  });
});

describe("sanitizedOrderSummary — recencyBucket (Phase 2d)", () => {
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;
  // orderedAt parses to eventTimeMs = 0 (Unix epoch).
  const epochOrder = normalizeEsmOrder({ siteGubun: "GMARKET", orderDt: "1970-01-01T00:00:00Z" });

  const bucketAt = (refMs: number) => sanitizedOrderSummary(epochOrder, { referenceTimeMs: refMs }).recencyBucket;

  it("computes each boundary bucket from explicit referenceTimeMs", () => {
    expect(bucketAt(0)).toBe("fresh_0_2h");
    expect(bucketAt(2 * HOUR)).toBe("same_day_2_24h");
    expect(bucketAt(24 * HOUR)).toBe("recent_1_3d");
    expect(bucketAt(3 * DAY)).toBe("aging_3_7d");
    expect(bucketAt(7 * DAY)).toBe("stale_over_7d");
  });

  it("returns unknown when referenceTimeMs is missing / non-finite", () => {
    expect(sanitizedOrderSummary(epochOrder).recencyBucket).toBe("unknown");
    expect(sanitizedOrderSummary(epochOrder, {}).recencyBucket).toBe("unknown");
    expect(sanitizedOrderSummary(epochOrder, { referenceTimeMs: Number.NaN }).recencyBucket).toBe("unknown");
    expect(sanitizedOrderSummary(epochOrder, { referenceTimeMs: Number.POSITIVE_INFINITY }).recencyBucket).toBe("unknown");
  });

  it("returns unknown when the event has no eventTimeMs (timezone-less orderedAt)", () => {
    const noTime = normalizeEsmOrder({ siteGubun: "GMARKET", orderDt: "2026-06-18T09:00:00" });
    expect(noTime).not.toHaveProperty("eventTimeMs");
    expect(sanitizedOrderSummary(noTime, { referenceTimeMs: 1_000_000 }).recencyBucket).toBe("unknown");
  });

  it("returns unknown for a future eventTimeMs", () => {
    const future = normalizeEsmOrder({ siteGubun: "GMARKET", orderDt: "1970-01-01T01:00:00Z" }); // eventTimeMs = 3_600_000
    expect(sanitizedOrderSummary(future, { referenceTimeMs: 0 }).recencyBucket).toBe("unknown");
  });

  it("never exposes eventTimeMs, raw orderedAt, or elapsed duration", () => {
    const summary = sanitizedOrderSummary(epochOrder, { referenceTimeMs: 5 * HOUR });
    expect(summary.recencyBucket).toBe("same_day_2_24h");
    expect(summary).not.toHaveProperty("eventTimeMs");
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("eventTimeMs");
    expect(serialized).not.toContain("1970-01-01T00:00:00Z"); // raw orderedAt
    expect(serialized).not.toContain(String(5 * HOUR)); // elapsed duration must not leak
  });
});

describe("sanitizedSummaryFor — forwards referenceTimeMs to order_shipping (Phase 2d)", () => {
  const HOUR = 60 * 60 * 1000;
  const epochOrder = normalizeEsmOrder({ siteGubun: "GMARKET", orderDt: "1970-01-01T00:00:00Z" });

  it("forwards referenceTimeMs into the order recencyBucket", () => {
    const s = sanitizedSummaryFor(epochOrder, { referenceTimeMs: 2 * HOUR });
    expect(s.kind).toBe("order_shipping");
    if (s.kind === "order_shipping") expect(s.recencyBucket).toBe("same_day_2_24h");
  });

  it("without options, order recencyBucket is unknown", () => {
    const s = sanitizedSummaryFor(epochOrder);
    if (s.kind === "order_shipping") expect(s.recencyBucket).toBe("unknown");
  });

  it("attention view built from an order never carries eventTimeMs", () => {
    expect(JSON.stringify(attentionView([epochOrder]))).not.toContain("eventTimeMs");
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
