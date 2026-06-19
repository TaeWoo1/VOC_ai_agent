import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ESM_CAPABILITIES,
  capabilityFor,
  firstMilestoneTarget,
} from "../../src/esmplus/capabilities";
import {
  normalizeEsmInquiry,
  sanitizedInquirySummary,
  type RawEsmInquiry,
} from "../../src/esmplus/inquiry-normalizer";
import { sanitizedSummaryFor } from "../../src/events/sanitized-summary";
import { attentionView } from "../../src/events/attention-view";

// Synthetic only — never real ESM data. Buyer identity here must never reach output.
const BUYER_NAME = "구매자홍길동";
const BUYER_ID = "buyer_hong_0001";

function rawInquiry(over: Partial<RawEsmInquiry> = {}): RawEsmInquiry {
  return {
    inquiryNo: 778899,
    siteGubun: "GMARKET",
    inquiryTypeName: "배송문의",
    answerYn: "N",
    title: "언제 배송되나요",
    contents: "주문한 상품 배송 일정이 궁금합니다",
    regDt: "2026-06-18T09:00:00.000Z",
    itemNo: 12345,
    orderNo: 67890,
    buyerName: BUYER_NAME,
    buyerId: BUYER_ID,
    ...over,
  };
}

describe("ESM capability map", () => {
  it("marks CS/inquiry as the single first-milestone target", () => {
    const cs = capabilityFor("cs_inquiry");
    expect(cs?.isFirstMilestoneTarget).toBe(true);
    expect(firstMilestoneTarget().area).toBe("cs_inquiry");
    // Exactly one first-milestone target.
    expect(ESM_CAPABILITIES.filter((c) => c.isFirstMilestoneTarget)).toHaveLength(1);
  });

  it("does not falsely claim review support — it is unknown/unconfirmed", () => {
    expect(capabilityFor("review")?.support).toBe("unknown");
    // No area is claimed as 'supported' (only planned/unknown/unsupported exist).
    for (const c of ESM_CAPABILITIES) {
      expect(["planned", "unknown", "unsupported"]).toContain(c.support);
    }
  });

  it("covers the API-first areas visible in the ESM Trading API guide", () => {
    const areas = ESM_CAPABILITIES.map((c) => c.area).sort();
    expect(areas).toEqual(
      [
        "claim",
        "cs_inquiry",
        "order_shipping",
        "product",
        "review",
        "service",
        "settlement",
        "star_delivery",
      ].sort(),
    );
  });

  it("marks the guide's non-review areas as planned (never supported)", () => {
    for (const area of ["product", "order_shipping", "claim", "settlement", "service", "star_delivery"] as const) {
      expect(capabilityFor(area)?.support).toBe("planned");
    }
  });
});

describe("normalizeEsmInquiry", () => {
  it("maps a synthetic inquiry to the normalized SellerOps event", () => {
    const e = normalizeEsmInquiry(rawInquiry());
    expect(e).toEqual({
      eventId: "esmplus:gmarket:778899",
      platform: "ESM_PLUS",
      kind: "cs_inquiry",
      channel: "gmarket",
      category: "delivery",
      status: "open",
      title: "언제 배송되나요",
      body: "주문한 상품 배송 일정이 궁금합니다",
      createdAt: "2026-06-18T09:00:00.000Z",
      productRef: "12345",
      orderRef: "67890",
      // internal parsed epoch ms from the offset-bearing createdAt (regDt)
      eventTimeMs: 1_781_773_200_000,
    });
  });

  it("never carries buyer identity into the normalized event", () => {
    const serialized = JSON.stringify(normalizeEsmInquiry(rawInquiry()));
    expect(serialized).not.toContain(BUYER_NAME);
    expect(serialized).not.toContain(BUYER_ID);
  });

  it("maps channel and status variants", () => {
    expect(normalizeEsmInquiry(rawInquiry({ siteGubun: "AUCTION" })).channel).toBe("auction");
    expect(normalizeEsmInquiry(rawInquiry({ siteGubun: "ESMPLUS" })).channel).toBe("esmplus");
    expect(normalizeEsmInquiry(rawInquiry({ siteGubun: "??" })).channel).toBe("unknown");
    expect(normalizeEsmInquiry(rawInquiry({ answerYn: "Y" })).status).toBe("answered");
    expect(normalizeEsmInquiry(rawInquiry({ answerYn: undefined })).status).toBe("unknown");
  });

  it("maps inquiry categories conservatively (unmapped → other, absent → unknown)", () => {
    expect(normalizeEsmInquiry(rawInquiry({ inquiryTypeName: "상품문의" })).category).toBe("product");
    expect(normalizeEsmInquiry(rawInquiry({ inquiryTypeName: "환불 요청" })).category).toBe(
      "cancel_refund_exchange",
    );
    expect(normalizeEsmInquiry(rawInquiry({ inquiryTypeName: "기타 잡담" })).category).toBe("other");
    expect(normalizeEsmInquiry(rawInquiry({ inquiryTypeName: null })).category).toBe("unknown");
  });

  it("handles missing/empty optional fields safely", () => {
    const e = normalizeEsmInquiry({});
    expect(e.platform).toBe("ESM_PLUS");
    expect(e.channel).toBe("unknown");
    expect(e.status).toBe("unknown");
    expect(e.category).toBe("unknown");
    expect(e.title).toBeNull();
    expect(e.body).toBeNull();
    expect(e.createdAt).toBeNull();
    expect(e.productRef).toBeNull();
    expect(e.orderRef).toBeNull();
    // A content-hash id is produced even with no inquiryNo (no collision on empties).
    expect(e.eventId).toMatch(/^esmplus:unknown:h:[0-9a-f]{16}$/);
  });

  it("whitespace-only content normalizes to null", () => {
    const e = normalizeEsmInquiry(rawInquiry({ title: "   ", contents: "" }));
    expect(e.title).toBeNull();
    expect(e.body).toBeNull();
  });

  it("produces distinct content-hash ids for distinct id-less inquiries", () => {
    const a = normalizeEsmInquiry({ siteGubun: "GMARKET", contents: "질문 A" });
    const b = normalizeEsmInquiry({ siteGubun: "GMARKET", contents: "질문 B" });
    expect(a.eventId).not.toBe(b.eventId);
  });
});

describe("sanitizedInquirySummary", () => {
  it("exposes only categories/booleans — never content, refs, ids, or buyer PII", () => {
    const summary = sanitizedInquirySummary(normalizeEsmInquiry(rawInquiry()));
    expect(summary).toEqual({
      platform: "ESM_PLUS",
      kind: "cs_inquiry",
      channel: "gmarket",
      category: "delivery",
      status: "open",
      hasTitle: true,
      hasBody: true,
      hasProductRef: true,
      hasOrderRef: true,
      hasCreatedAt: true,
      recencyBucket: "unknown",
    });
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("언제 배송");
    expect(serialized).not.toContain("12345");
    expect(serialized).not.toContain("778899");
    expect(serialized).not.toContain(BUYER_NAME);
  });
});

describe("normalizeEsmInquiry — internal eventTimeMs (Phase 2c)", () => {
  it("parses an offset-bearing createdAt (regDt) into internal eventTimeMs", () => {
    expect(normalizeEsmInquiry({ siteGubun: "GMARKET", regDt: "1970-01-01T00:00:00Z" }).eventTimeMs).toBe(0);
    expect(normalizeEsmInquiry({ siteGubun: "GMARKET", regDt: "1970-01-01T09:00:00+09:00" }).eventTimeMs).toBe(0);
    expect(normalizeEsmInquiry({ siteGubun: "GMARKET", regDt: "1970-01-01T00:00:00-05:00" }).eventTimeMs).toBe(18_000_000);
  });

  it("omits eventTimeMs for timezone-less / invalid createdAt", () => {
    expect(normalizeEsmInquiry({ siteGubun: "GMARKET", regDt: "2026-06-18T09:00:00" })).not.toHaveProperty("eventTimeMs");
    expect(normalizeEsmInquiry({ siteGubun: "GMARKET", regDt: "not-a-date" })).not.toHaveProperty("eventTimeMs");
    expect(normalizeEsmInquiry({ siteGubun: "GMARKET", regDt: "2026-06-18T09:00:00+0900" })).not.toHaveProperty("eventTimeMs");
  });

  it("omits eventTimeMs for missing / null / blank createdAt", () => {
    expect(normalizeEsmInquiry({ siteGubun: "GMARKET" })).not.toHaveProperty("eventTimeMs");
    expect(normalizeEsmInquiry({ siteGubun: "GMARKET", regDt: null })).not.toHaveProperty("eventTimeMs");
    expect(normalizeEsmInquiry({ siteGubun: "GMARKET", regDt: "   " })).not.toHaveProperty("eventTimeMs");
  });

  it("preserves the raw createdAt string regardless of parse outcome", () => {
    expect(normalizeEsmInquiry({ siteGubun: "GMARKET", regDt: "1970-01-01T00:00:00Z" }).createdAt).toBe("1970-01-01T00:00:00Z");
    expect(normalizeEsmInquiry({ siteGubun: "GMARKET", regDt: "2026-06-18T09:00:00" }).createdAt).toBe("2026-06-18T09:00:00");
  });
});

describe("normalizeEsmInquiry — eventTimeMs is internal only", () => {
  const e = normalizeEsmInquiry({ siteGubun: "GMARKET", answerYn: "N", regDt: "1970-01-01T00:00:00Z" });

  it("is present on the normalized event", () => {
    expect(e.eventTimeMs).toBe(0);
  });

  it("never appears in the sanitized inquiry summary", () => {
    const summary = sanitizedInquirySummary(e);
    expect(summary).not.toHaveProperty("eventTimeMs");
    expect(JSON.stringify(summary)).not.toContain("eventTimeMs");
  });

  it("never appears in the event-dispatched sanitized summary", () => {
    expect(JSON.stringify(sanitizedSummaryFor(e))).not.toContain("eventTimeMs");
  });

  it("never appears in the attention view (digest + ranked rows) built from inquiry input", () => {
    expect(JSON.stringify(attentionView([e]))).not.toContain("eventTimeMs");
  });
});

describe("sanitizedInquirySummary — recencyBucket (Phase 2d)", () => {
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;
  // createdAt parses to eventTimeMs = 0 (Unix epoch).
  const epochInquiry = normalizeEsmInquiry({ siteGubun: "GMARKET", regDt: "1970-01-01T00:00:00Z" });

  const bucketAt = (refMs: number) => sanitizedInquirySummary(epochInquiry, { referenceTimeMs: refMs }).recencyBucket;

  it("computes each boundary bucket from explicit referenceTimeMs", () => {
    expect(bucketAt(0)).toBe("fresh_0_2h");
    expect(bucketAt(2 * HOUR)).toBe("same_day_2_24h");
    expect(bucketAt(24 * HOUR)).toBe("recent_1_3d");
    expect(bucketAt(3 * DAY)).toBe("aging_3_7d");
    expect(bucketAt(7 * DAY)).toBe("stale_over_7d");
  });

  it("returns unknown when referenceTimeMs is missing / non-finite", () => {
    expect(sanitizedInquirySummary(epochInquiry).recencyBucket).toBe("unknown");
    expect(sanitizedInquirySummary(epochInquiry, {}).recencyBucket).toBe("unknown");
    expect(sanitizedInquirySummary(epochInquiry, { referenceTimeMs: Number.NaN }).recencyBucket).toBe("unknown");
    expect(sanitizedInquirySummary(epochInquiry, { referenceTimeMs: Number.POSITIVE_INFINITY }).recencyBucket).toBe("unknown");
  });

  it("returns unknown when the event has no eventTimeMs (timezone-less createdAt)", () => {
    const noTime = normalizeEsmInquiry({ siteGubun: "GMARKET", regDt: "2026-06-18T09:00:00" });
    expect(noTime).not.toHaveProperty("eventTimeMs");
    expect(sanitizedInquirySummary(noTime, { referenceTimeMs: 1_000_000 }).recencyBucket).toBe("unknown");
  });

  it("returns unknown for a future eventTimeMs", () => {
    const future = normalizeEsmInquiry({ siteGubun: "GMARKET", regDt: "1970-01-01T01:00:00Z" }); // eventTimeMs = 3_600_000
    expect(sanitizedInquirySummary(future, { referenceTimeMs: 0 }).recencyBucket).toBe("unknown");
  });

  it("never exposes eventTimeMs, raw createdAt, or elapsed duration", () => {
    const summary = sanitizedInquirySummary(epochInquiry, { referenceTimeMs: 5 * HOUR });
    expect(summary.recencyBucket).toBe("same_day_2_24h");
    expect(summary).not.toHaveProperty("eventTimeMs");
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("eventTimeMs");
    expect(serialized).not.toContain("1970-01-01T00:00:00Z"); // raw createdAt
    expect(serialized).not.toContain(String(5 * HOUR)); // elapsed duration must not leak
  });
});

describe("sanitizedSummaryFor — forwards referenceTimeMs to cs_inquiry (Phase 2d)", () => {
  const HOUR = 60 * 60 * 1000;
  const epochInquiry = normalizeEsmInquiry({ siteGubun: "GMARKET", regDt: "1970-01-01T00:00:00Z" });

  it("forwards referenceTimeMs into the inquiry recencyBucket", () => {
    const s = sanitizedSummaryFor(epochInquiry, { referenceTimeMs: 2 * HOUR });
    expect(s.kind).toBe("cs_inquiry");
    if (s.kind === "cs_inquiry") expect(s.recencyBucket).toBe("same_day_2_24h");
  });

  it("without options, inquiry recencyBucket is unknown", () => {
    const s = sanitizedSummaryFor(epochInquiry);
    if (s.kind === "cs_inquiry") expect(s.recencyBucket).toBe("unknown");
  });

  it("attention view built from an inquiry never carries eventTimeMs", () => {
    expect(JSON.stringify(attentionView([epochInquiry]))).not.toContain("eventTimeMs");
  });
});

describe("module boundary", () => {
  it("normalizer/capabilities import no network/fs/browser/env", () => {
    for (const rel of ["inquiry-normalizer.ts", "capabilities.ts", "types.ts"]) {
      const src = readFileSync(join(__dirname, "..", "..", "src", "esmplus", rel), "utf8");
      const imports = src
        .split("\n")
        .filter((l) => /^\s*import\b/.test(l) || /\bfrom\s+["']/.test(l))
        .join("\n");
      expect(/playwright/i.test(imports), rel).toBe(false);
      expect(/chromium/i.test(imports), rel).toBe(false);
      expect(/from\s+["'](node:)?fs(\/promises)?["']/.test(imports), rel).toBe(false);
      expect(/from\s+["'](node:)?https?["']/.test(imports), rel).toBe(false);
      expect(/process\.env|\bfetch\(|\baxios\b/.test(src), rel).toBe(false);
    }
  });
});
