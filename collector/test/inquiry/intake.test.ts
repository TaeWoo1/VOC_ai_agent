/**
 * Pure offline tests for the inquiry intake adapter.
 *
 * Focus: deterministic ids from the channel source identity (stable across re-ingestion; isolated per
 * connection); raw inquiry/order values + the channel execution reference are PRESERVED in `sellerPrivate`
 * (not replaced by hashes) while the shareable projection keeps only safe product/VOC metadata; and the
 * seller provider context is reconstructable SOLELY from the created signal (via its seller projection).
 */

import { describe, it, expect } from "vitest";

import { deriveSourceIds, observationFingerprint, toInquirySignal, sellerContextFromSignal } from "../../src/inquiry/intake";
import type { InquiryObservation } from "../../src/inquiry/observation";

function obs(over: Partial<InquiryObservation> = {}): InquiryObservation {
  return {
    sellerId: "seller-1",
    connectionId: "conn-1",
    channel: "NAVER",
    channelInquiryId: "INQ-1",
    productId: "prod-1",
    orderRef: "ORDER-9",
    inquiryText: "이 상품 재고 있나요? 홍길동 010-0000-0000",
    observedAt: 5,
    responseDeadlineAt: 900,
    category: { topicCategory: "stock", severityBucket: "mid" },
    ...over,
  };
}

describe("deriveSourceIds", () => {
  it("is deterministic and stable across re-ingestion of the same observation", () => {
    expect(deriveSourceIds(obs())).toEqual(deriveSourceIds(obs()));
    const ids = deriveSourceIds(obs());
    expect(ids.workItemId).toBe(`wi-${ids.sourceKey}`);
    expect(ids.proposeCommandId).toBe(`cmd-propose-${ids.sourceKey}`);
    expect(ids.sourceKey).toMatch(/^[0-9a-f]{16}$/);
  });

  it("isolates the same channel inquiry id across different connections", () => {
    expect(deriveSourceIds(obs({ connectionId: "conn-1" })).sourceKey).not.toBe(deriveSourceIds(obs({ connectionId: "conn-2" })).sourceKey);
  });

  it("fingerprints differ when content differs under the same source identity", () => {
    expect(observationFingerprint(obs({ inquiryText: "a" }))).not.toBe(observationFingerprint(obs({ inquiryText: "b" })));
    expect(observationFingerprint(obs())).toBe(observationFingerprint(obs()));
  });
});

describe("toInquirySignal retains raw inquiry/order values only in sellerPrivate", () => {
  const o = obs();
  const signal = toInquirySignal(o, deriveSourceIds(o));

  it("preserves the raw operational values (text, order ref, channel ref, deadline) in sellerPrivate", () => {
    expect(signal.sellerPrivate.sourceText).toBe(o.inquiryText);
    expect(signal.sellerPrivate.orderRef).toBe("ORDER-9");
    expect(signal.sellerPrivate.channelSourceRef).toBe("INQ-1"); // needed for later execution
    expect(signal.sellerPrivate.responseDeadlineAt).toBe(900);
  });

  it("keeps an order-ref hash ADDITIONALLY (never the only retained value)", () => {
    expect(signal.sellerPrivate.orderRefHash).toMatch(/^[0-9a-f]{16}$/);
    expect(signal.sellerPrivate.orderRef).toBe("ORDER-9"); // raw still present alongside the hash
    expect(signal.sellerPrivate.customerRefHash).toBeNull();
  });

  it("keeps ONLY safe product/VOC metadata in shareable/productRef — no raw text or order id", () => {
    expect(signal.shareable).toEqual({ severityBucket: "mid", topicCategory: "stock", recencyBucket: "unknown" });
    const nonPrivate = JSON.stringify({ ...signal, sellerPrivate: null });
    expect(nonPrivate.includes(o.inquiryText)).toBe(false);
    expect(nonPrivate.includes("ORDER-9")).toBe(false);
  });

  it("a null order reference keeps a null raw ref and a null hash", () => {
    const s = toInquirySignal(obs({ orderRef: null }), deriveSourceIds(obs()));
    expect(s.sellerPrivate.orderRef).toBeNull();
    expect(s.sellerPrivate.orderRefHash).toBeNull();
  });
});

describe("sellerContextFromSignal reconstructs the provider context solely from the signal", () => {
  it("rebuilds the full seller-visible context from the signal's seller projection (no observation needed)", () => {
    const o = obs();
    const signal = toInquirySignal(o, deriveSourceIds(o));
    // The observation is intentionally not referenced below — only `signal`.
    expect(sellerContextFromSignal(signal)).toEqual({
      sellerId: "seller-1",
      channel: "NAVER",
      productId: "prod-1",
      orderRef: "ORDER-9",
      inquiryText: o.inquiryText,
      category: { topicCategory: "stock", severityBucket: "mid" },
      responseDeadlineAt: 900,
    });
  });
});
