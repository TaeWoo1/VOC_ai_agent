import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  normalizeEsmClaim,
  sanitizedClaimSummary,
  type RawEsmClaim,
} from "../../src/esmplus/claim-normalizer";
import { sanitizedSummaryFor } from "../../src/events/sanitized-summary";
import { attentionView } from "../../src/events/attention-view";

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
      // internal parsed epoch ms from the offset-bearing createdAt (regDt)
      eventTimeMs: 1_781_773_200_000,
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
      recencyBucket: "unknown",
    });
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("900800700");
    expect(serialized).not.toContain("흠집");
    expect(serialized).not.toContain(BUYER_NAME);
  });
});

describe("normalizeEsmClaim — internal eventTimeMs (Phase 2c)", () => {
  it("parses an offset-bearing createdAt (regDt) into internal eventTimeMs", () => {
    expect(normalizeEsmClaim({ siteGubun: "AUCTION", regDt: "1970-01-01T00:00:00Z" }).eventTimeMs).toBe(0);
    expect(normalizeEsmClaim({ siteGubun: "AUCTION", regDt: "1970-01-01T09:00:00+09:00" }).eventTimeMs).toBe(0);
    expect(normalizeEsmClaim({ siteGubun: "AUCTION", regDt: "1970-01-01T00:00:00-05:00" }).eventTimeMs).toBe(18_000_000);
  });

  it("omits eventTimeMs for timezone-less / invalid createdAt", () => {
    expect(normalizeEsmClaim({ siteGubun: "AUCTION", regDt: "2026-06-18T09:00:00" })).not.toHaveProperty("eventTimeMs");
    expect(normalizeEsmClaim({ siteGubun: "AUCTION", regDt: "not-a-date" })).not.toHaveProperty("eventTimeMs");
    expect(normalizeEsmClaim({ siteGubun: "AUCTION", regDt: "2026-06-18T09:00:00+0900" })).not.toHaveProperty("eventTimeMs");
  });

  it("omits eventTimeMs for missing / null / blank createdAt", () => {
    expect(normalizeEsmClaim({ siteGubun: "AUCTION" })).not.toHaveProperty("eventTimeMs");
    expect(normalizeEsmClaim({ siteGubun: "AUCTION", regDt: null })).not.toHaveProperty("eventTimeMs");
    expect(normalizeEsmClaim({ siteGubun: "AUCTION", regDt: "   " })).not.toHaveProperty("eventTimeMs");
  });

  it("preserves the raw createdAt string regardless of parse outcome", () => {
    expect(normalizeEsmClaim({ siteGubun: "AUCTION", regDt: "1970-01-01T00:00:00Z" }).createdAt).toBe("1970-01-01T00:00:00Z");
    expect(normalizeEsmClaim({ siteGubun: "AUCTION", regDt: "2026-06-18T09:00:00" }).createdAt).toBe("2026-06-18T09:00:00");
  });
});

describe("normalizeEsmClaim — eventTimeMs is internal only", () => {
  const e = normalizeEsmClaim({ siteGubun: "AUCTION", claimStatus: "접수", regDt: "1970-01-01T00:00:00Z" });

  it("is present on the normalized event", () => {
    expect(e.eventTimeMs).toBe(0);
  });

  it("never appears in the sanitized claim summary", () => {
    const summary = sanitizedClaimSummary(e);
    expect(summary).not.toHaveProperty("eventTimeMs");
    expect(JSON.stringify(summary)).not.toContain("eventTimeMs");
  });

  it("never appears in the event-dispatched sanitized summary", () => {
    expect(JSON.stringify(sanitizedSummaryFor(e))).not.toContain("eventTimeMs");
  });

  it("never appears in the attention view (digest + ranked rows) built from claim input", () => {
    expect(JSON.stringify(attentionView([e]))).not.toContain("eventTimeMs");
  });
});

describe("sanitizedClaimSummary — recencyBucket (Phase 2d)", () => {
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;
  // createdAt parses to eventTimeMs = 0 (Unix epoch).
  const epochClaim = normalizeEsmClaim({ siteGubun: "AUCTION", regDt: "1970-01-01T00:00:00Z" });

  const bucketAt = (refMs: number) => sanitizedClaimSummary(epochClaim, { referenceTimeMs: refMs }).recencyBucket;

  it("computes each boundary bucket from explicit referenceTimeMs", () => {
    expect(bucketAt(0)).toBe("fresh_0_2h");
    expect(bucketAt(2 * HOUR)).toBe("same_day_2_24h");
    expect(bucketAt(24 * HOUR)).toBe("recent_1_3d");
    expect(bucketAt(3 * DAY)).toBe("aging_3_7d");
    expect(bucketAt(7 * DAY)).toBe("stale_over_7d");
  });

  it("returns unknown when referenceTimeMs is missing / non-finite", () => {
    expect(sanitizedClaimSummary(epochClaim).recencyBucket).toBe("unknown");
    expect(sanitizedClaimSummary(epochClaim, {}).recencyBucket).toBe("unknown");
    expect(sanitizedClaimSummary(epochClaim, { referenceTimeMs: Number.NaN }).recencyBucket).toBe("unknown");
    expect(sanitizedClaimSummary(epochClaim, { referenceTimeMs: Number.POSITIVE_INFINITY }).recencyBucket).toBe("unknown");
  });

  it("returns unknown when the event has no eventTimeMs (timezone-less createdAt)", () => {
    const noTime = normalizeEsmClaim({ siteGubun: "AUCTION", regDt: "2026-06-18T09:00:00" });
    expect(noTime).not.toHaveProperty("eventTimeMs");
    expect(sanitizedClaimSummary(noTime, { referenceTimeMs: 1_000_000 }).recencyBucket).toBe("unknown");
  });

  it("returns unknown for a future eventTimeMs", () => {
    const future = normalizeEsmClaim({ siteGubun: "AUCTION", regDt: "1970-01-01T01:00:00Z" }); // eventTimeMs = 3_600_000
    expect(sanitizedClaimSummary(future, { referenceTimeMs: 0 }).recencyBucket).toBe("unknown");
  });

  it("never exposes eventTimeMs, raw createdAt, or elapsed duration", () => {
    const summary = sanitizedClaimSummary(epochClaim, { referenceTimeMs: 5 * HOUR });
    expect(summary.recencyBucket).toBe("same_day_2_24h");
    expect(summary).not.toHaveProperty("eventTimeMs");
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("eventTimeMs");
    expect(serialized).not.toContain("1970-01-01T00:00:00Z"); // raw createdAt
    expect(serialized).not.toContain(String(5 * HOUR)); // elapsed duration must not leak
  });
});

describe("sanitizedSummaryFor — forwards referenceTimeMs to claim (Phase 2d)", () => {
  const HOUR = 60 * 60 * 1000;
  const epochClaim = normalizeEsmClaim({ siteGubun: "AUCTION", regDt: "1970-01-01T00:00:00Z" });

  it("forwards referenceTimeMs into the claim recencyBucket", () => {
    const s = sanitizedSummaryFor(epochClaim, { referenceTimeMs: 2 * HOUR });
    expect(s.kind).toBe("claim");
    if (s.kind === "claim") expect(s.recencyBucket).toBe("same_day_2_24h");
  });

  it("without options, claim recencyBucket is unknown", () => {
    const s = sanitizedSummaryFor(epochClaim);
    if (s.kind === "claim") expect(s.recencyBucket).toBe("unknown");
  });

  it("attention view built from a claim never carries eventTimeMs", () => {
    expect(JSON.stringify(attentionView([epochClaim]))).not.toContain("eventTimeMs");
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
