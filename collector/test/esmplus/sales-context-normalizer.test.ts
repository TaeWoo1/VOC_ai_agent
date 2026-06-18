import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  normalizeEsmSalesContext,
  sanitizedSalesContextSummary,
  type RawEsmSalesContext,
} from "../../src/esmplus/sales-context-normalizer";

// Synthetic only — seller identity / buyer PII here must never reach output.
const SELLER_ID = "seller_acme_123";
const MASTER_ID = "ESMMASTER_XYZ";
const ACCOUNT_ID = "acct_999";
const BUYER_NAME = "구매자홍길동";

function rawSales(over: Partial<RawEsmSalesContext> = {}): RawEsmSalesContext {
  return {
    settlementNo: 50607080,
    siteGubun: "GMARKET",
    periodStart: "2026-06-01",
    periodEnd: "2026-06-30",
    itemNo: 555,
    orderCount: 120,
    claimCount: 8,
    grossSalesAmount: 4500000,
    settlementAmount: 4180000,
    currency: "KRW",
    sellerId: SELLER_ID,
    masterId: MASTER_ID,
    accountId: ACCOUNT_ID,
    buyerName: BUYER_NAME,
    ...over,
  };
}

describe("normalizeEsmSalesContext", () => {
  it("maps a synthetic settlement row to the normalized SellerOps event", () => {
    expect(normalizeEsmSalesContext(rawSales())).toEqual({
      eventId: "esmplus:gmarket:sales:50607080",
      platform: "ESM_PLUS",
      kind: "sales_context",
      channel: "gmarket",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
      productRef: "555",
      orderCount: 120,
      claimCount: 8,
      grossSalesAmount: 4500000,
      settlementAmount: 4180000,
      currency: "KRW",
    });
  });

  it("maps channel variants", () => {
    expect(normalizeEsmSalesContext(rawSales({ siteGubun: "AUCTION" })).channel).toBe("auction");
    expect(normalizeEsmSalesContext(rawSales({ siteGubun: "esm" })).channel).toBe("esmplus");
    expect(normalizeEsmSalesContext(rawSales({ siteGubun: "??" })).channel).toBe("unknown");
  });

  it("maps currency variants conservatively (default unknown)", () => {
    expect(normalizeEsmSalesContext(rawSales({ currency: "원" })).currency).toBe("KRW");
    expect(normalizeEsmSalesContext(rawSales({ currency: "won" })).currency).toBe("KRW");
    expect(normalizeEsmSalesContext(rawSales({ currency: "USD" })).currency).toBe("unknown");
    expect(normalizeEsmSalesContext(rawSales({ currency: null })).currency).toBe("unknown");
  });

  it("parses counts as non-negative integers (string digits ok; else null)", () => {
    expect(normalizeEsmSalesContext(rawSales({ orderCount: "42" })).orderCount).toBe(42);
    expect(normalizeEsmSalesContext(rawSales({ orderCount: "abc" })).orderCount).toBeNull();
    expect(normalizeEsmSalesContext(rawSales({ orderCount: -3 })).orderCount).toBeNull();
    expect(normalizeEsmSalesContext(rawSales({ orderCount: 1.5 })).orderCount).toBeNull();
    expect(normalizeEsmSalesContext(rawSales({ claimCount: 0 })).claimCount).toBe(0);
    expect(normalizeEsmSalesContext(rawSales({ claimCount: null })).claimCount).toBeNull();
  });

  it("parses amounts conservatively (integers, decimals; negatives/garbage → null)", () => {
    expect(normalizeEsmSalesContext(rawSales({ grossSalesAmount: "1200000" })).grossSalesAmount).toBe(1200000);
    expect(normalizeEsmSalesContext(rawSales({ grossSalesAmount: "999.50" })).grossSalesAmount).toBe(999.5);
    expect(normalizeEsmSalesContext(rawSales({ grossSalesAmount: "-500" })).grossSalesAmount).toBeNull();
    expect(normalizeEsmSalesContext(rawSales({ grossSalesAmount: -500 })).grossSalesAmount).toBeNull();
    expect(normalizeEsmSalesContext(rawSales({ grossSalesAmount: "1,200,000" })).grossSalesAmount).toBeNull();
    expect(normalizeEsmSalesContext(rawSales({ settlementAmount: "abc" })).settlementAmount).toBeNull();
    expect(normalizeEsmSalesContext(rawSales({ grossSalesAmount: 0 })).grossSalesAmount).toBe(0);
  });

  it("handles missing/empty optional fields safely", () => {
    const e = normalizeEsmSalesContext({});
    expect(e.platform).toBe("ESM_PLUS");
    expect(e.channel).toBe("unknown");
    expect(e.periodStart).toBeNull();
    expect(e.periodEnd).toBeNull();
    expect(e.productRef).toBeNull();
    expect(e.orderCount).toBeNull();
    expect(e.claimCount).toBeNull();
    expect(e.grossSalesAmount).toBeNull();
    expect(e.settlementAmount).toBeNull();
    expect(e.currency).toBe("unknown");
    expect(e.eventId).toMatch(/^esmplus:unknown:sales:h:[0-9a-f]{16}$/);
  });

  it("prefers settlementNo, falls back to salesRowId, then content hash", () => {
    expect(normalizeEsmSalesContext(rawSales({ settlementNo: 111, salesRowId: 222 })).eventId).toBe(
      "esmplus:gmarket:sales:111",
    );
    expect(
      normalizeEsmSalesContext(rawSales({ settlementNo: null, salesRowId: 222 })).eventId,
    ).toBe("esmplus:gmarket:sales:222");
    expect(
      normalizeEsmSalesContext(rawSales({ settlementNo: null, salesRowId: null })).eventId,
    ).toMatch(/^esmplus:gmarket:sales:h:[0-9a-f]{16}$/);
  });

  it("produces distinct content-hash ids for distinct id-less rows", () => {
    const a = normalizeEsmSalesContext({ siteGubun: "GMARKET", settlementNo: null, itemNo: 1 });
    const b = normalizeEsmSalesContext({ siteGubun: "GMARKET", settlementNo: null, itemNo: 2 });
    expect(a.eventId).not.toBe(b.eventId);
  });

  it("never carries seller identity or buyer PII into the normalized event", () => {
    const serialized = JSON.stringify(normalizeEsmSalesContext(rawSales()));
    for (const id of [SELLER_ID, MASTER_ID, ACCOUNT_ID, BUYER_NAME]) {
      expect(serialized).not.toContain(id);
    }
  });
});

describe("sanitizedSalesContextSummary", () => {
  it("exposes categories/booleans + a coarse bucket — never exact amounts, refs, ids, or identity", () => {
    const summary = sanitizedSalesContextSummary(normalizeEsmSalesContext(rawSales()));
    expect(summary).toEqual({
      platform: "ESM_PLUS",
      kind: "sales_context",
      channel: "gmarket",
      currency: "KRW",
      hasProductRef: true,
      hasPeriod: true,
      hasOrderCount: true,
      hasClaimCount: true,
      hasGrossSalesAmount: true,
      hasSettlementAmount: true,
      amountBucket: "1m_to_10m",
    });
    const serialized = JSON.stringify(summary);
    // exact amounts, counts, refs, ids, PII must not appear
    for (const leak of ["4500000", "4180000", "120", "555", "50607080", SELLER_ID, MASTER_ID, ACCOUNT_ID, BUYER_NAME]) {
      expect(serialized).not.toContain(leak);
    }
  });

  it("buckets gross-sales magnitude coarsely without leaking the value", () => {
    const bucketOf = (amt: number | null) =>
      sanitizedSalesContextSummary(normalizeEsmSalesContext(rawSales({ grossSalesAmount: amt }))).amountBucket;
    expect(bucketOf(0)).toBe("zero");
    expect(bucketOf(50_000)).toBe("under_100k");
    expect(bucketOf(500_000)).toBe("100k_to_1m");
    expect(bucketOf(5_000_000)).toBe("1m_to_10m");
    expect(bucketOf(50_000_000)).toBe("10m_to_100m");
    expect(bucketOf(250_000_000)).toBe("100m_plus");
    expect(bucketOf(null)).toBe("unknown");
  });
});

describe("module boundary", () => {
  it("imports no network/fs/browser/env", () => {
    const src = readFileSync(
      join(__dirname, "..", "..", "src", "esmplus", "sales-context-normalizer.ts"),
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
  });
});
