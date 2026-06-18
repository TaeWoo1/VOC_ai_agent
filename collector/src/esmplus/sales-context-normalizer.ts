/**
 * Pure normalizer: a raw (synthetic) ESM Plus sales/settlement row → the common
 * `SellerOpsSalesContextEvent`. No network, no fs, no browser, no env — a data
 * transform, fully offline-testable against synthetic fixtures.
 *
 * This is **operational context, not accounting**: a lightweight layer used to
 * prioritize reviews / inquiries / claims / product issues. It does NOT aggregate,
 * does NOT build a dashboard, and makes NO financial-accuracy claim beyond the
 * normalized source data.
 *
 * PII / identity discipline: the raw row may carry buyer PII and seller identity
 * (seller id / master id / account id). Those are DROPPED and never copied into the
 * normalized event, which keeps only a product reference code, coarse counts, and
 * monetary amounts. Monetary amounts are business-sensitive — they appear in the
 * full event but NEVER in the sanitized summary (only a coarse bucket does).
 */

import { createHash } from "node:crypto";
import type {
  EsmChannel,
  SalesAmountBucket,
  SalesCurrency,
  SanitizedSalesContextSummary,
  SellerOpsSalesContextEvent,
} from "./types";

/**
 * Raw synthetic ESM sales/settlement row (loose — optional, possibly wrong-typed).
 * Stand-in for an official API/settlement row; NOT real data. Buyer PII and seller
 * identity fields are accepted but intentionally NOT mapped into the normalized event.
 */
export interface RawEsmSalesContext {
  settlementNo?: string | number | null;
  salesRowId?: string | number | null;
  siteGubun?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  itemNo?: string | number | null;
  orderCount?: string | number | null;
  claimCount?: string | number | null;
  grossSalesAmount?: string | number | null;
  settlementAmount?: string | number | null;
  currency?: string | null;
  // Seller identity / buyer PII — accepted in the raw shape but DROPPED.
  sellerId?: string | null;
  masterId?: string | null;
  accountId?: string | null;
  buyerName?: string | null;
}

function trimOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

function refOrNull(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return trimOrNull(v);
}

function channelOf(siteGubun: unknown): EsmChannel {
  const s = typeof siteGubun === "string" ? siteGubun.trim().toLowerCase() : "";
  if (s === "gmarket" || s === "gmkt") return "gmarket";
  if (s === "auction" || s === "ac") return "auction";
  if (s === "esmplus" || s === "esm") return "esmplus";
  return "unknown";
}

/** Non-negative integer count; clean integer string or finite non-negative integer, else null. */
function countOrNull(v: unknown): number | null {
  if (typeof v === "number") {
    return Number.isInteger(v) && v >= 0 ? v : null;
  }
  if (typeof v === "string") {
    const t = v.trim();
    if (/^\d+$/.test(t)) {
      const n = Number(t);
      if (Number.isInteger(n) && n >= 0) return n;
    }
  }
  return null;
}

/**
 * Non-negative monetary amount; clean numeric string (integer or decimal) or finite
 * non-negative number, else null. Negatives are rejected by default (no context flag
 * here authorizes them) and become null — conservative, never a guessed sign.
 */
function amountOrNull(v: unknown): number | null {
  if (typeof v === "number") {
    return Number.isFinite(v) && v >= 0 ? v : null;
  }
  if (typeof v === "string") {
    const t = v.trim();
    if (/^\d+(\.\d+)?$/.test(t)) {
      const n = Number(t);
      if (Number.isFinite(n) && n >= 0) return n;
    }
  }
  return null;
}

/** Conservative currency mapping; defaults to `unknown`. */
function currencyOf(v: unknown): SalesCurrency {
  const t = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (t === "krw" || t === "won" || t === "원" || t === "₩") return "KRW";
  return "unknown";
}

/** Coarse magnitude bucket — loses precision so exact amounts never leak. */
function amountBucketOf(amount: number | null): SalesAmountBucket {
  if (amount === null) return "unknown";
  if (amount === 0) return "zero";
  if (amount < 100_000) return "under_100k";
  if (amount < 1_000_000) return "100k_to_1m";
  if (amount < 10_000_000) return "1m_to_10m";
  if (amount < 100_000_000) return "10m_to_100m";
  return "100m_plus";
}

/** Stable id: prefer a settlement/sales row id; else a content hash from non-identity fields. */
function eventIdFor(channel: EsmChannel, raw: RawEsmSalesContext): string {
  const id = refOrNull(raw.settlementNo) ?? refOrNull(raw.salesRowId);
  if (id !== null) return `esmplus:${channel}:sales:${id}`;
  const basis = JSON.stringify([
    refOrNull(raw.itemNo) ?? "",
    trimOrNull(raw.periodStart) ?? "",
    trimOrNull(raw.periodEnd) ?? "",
  ]);
  const hash = createHash("sha256").update(basis, "utf8").digest("hex").slice(0, 16);
  return `esmplus:${channel}:sales:h:${hash}`;
}

/** Normalize one raw ESM sales/settlement row into a `SellerOpsSalesContextEvent`. Identity/PII dropped. */
export function normalizeEsmSalesContext(raw: RawEsmSalesContext): SellerOpsSalesContextEvent {
  const channel = channelOf(raw.siteGubun);
  return {
    eventId: eventIdFor(channel, raw),
    platform: "ESM_PLUS",
    kind: "sales_context",
    channel,
    periodStart: trimOrNull(raw.periodStart),
    periodEnd: trimOrNull(raw.periodEnd),
    productRef: refOrNull(raw.itemNo),
    orderCount: countOrNull(raw.orderCount),
    claimCount: countOrNull(raw.claimCount),
    grossSalesAmount: amountOrNull(raw.grossSalesAmount),
    settlementAmount: amountOrNull(raw.settlementAmount),
    currency: currencyOf(raw.currency),
  };
}

/**
 * Log-safe summary — categories/booleans only, plus one coarse `amountBucket`.
 * Exact monetary amounts, counts, refs, ids, and identity are NEVER exposed here.
 */
export function sanitizedSalesContextSummary(
  event: SellerOpsSalesContextEvent,
): SanitizedSalesContextSummary {
  return {
    platform: event.platform,
    kind: event.kind,
    channel: event.channel,
    currency: event.currency,
    hasProductRef: event.productRef !== null,
    hasPeriod: event.periodStart !== null || event.periodEnd !== null,
    hasOrderCount: event.orderCount !== null,
    hasClaimCount: event.claimCount !== null,
    hasGrossSalesAmount: event.grossSalesAmount !== null,
    hasSettlementAmount: event.settlementAmount !== null,
    amountBucket: amountBucketOf(event.grossSalesAmount),
  };
}
