/**
 * Pure normalizer: a raw (synthetic) ESM Plus seller inquiry → the common
 * `SellerOpsInquiryEvent`. No network, no fs, no browser, no env — just a data
 * transform, fully offline-testable against synthetic fixtures.
 *
 * PII discipline: the raw inquiry may carry buyer name / id / contact. Those are
 * DROPPED here and never copied into the normalized event. The event keeps only
 * the inquiry content (title/body), reference codes (product/order), status,
 * category, channel, and timestamp — the VOC-relevant, non-PII fields.
 */

import { createHash } from "node:crypto";
import { parseOffsetTimestampToEpochMs } from "../events/offset-timestamp-parser";
import { recencyBucketFor } from "../events/recency-bucket";
import type { SanitizedSummaryOptions } from "../events/recency-bucket";
import type {
  EsmChannel,
  InquiryCategory,
  InquiryStatus,
  SanitizedInquirySummary,
  SellerOpsInquiryEvent,
} from "./types";

/**
 * Raw synthetic ESM inquiry shape (loose — fields are optional and may be missing
 * or wrong-typed in real payloads). This is a stand-in for an official API row;
 * NOT real data. Buyer-identity fields are accepted but intentionally NOT mapped
 * into the normalized event.
 */
export interface RawEsmInquiry {
  inquiryNo?: string | number | null;
  siteGubun?: string | null;
  inquiryTypeName?: string | null;
  answerYn?: string | null;
  title?: string | null;
  contents?: string | null;
  regDt?: string | null;
  itemNo?: string | number | null;
  orderNo?: string | number | null;
  // Buyer identity — accepted in the raw shape but DROPPED at normalization.
  buyerName?: string | null;
  buyerId?: string | null;
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

function statusOf(answerYn: unknown): InquiryStatus {
  const s = typeof answerYn === "string" ? answerYn.trim().toUpperCase() : "";
  if (s === "Y") return "answered";
  if (s === "N") return "open";
  return "unknown";
}

/**
 * Conservative category mapping from a free-form type label. Defaults to `unknown`
 * when absent and `other` when present-but-unmapped — never guesses a specific
 * category from ambiguous text.
 */
function categoryOf(typeName: unknown): InquiryCategory {
  const t = trimOrNull(typeName);
  if (t === null) return "unknown";
  const lower = t.toLowerCase();
  if (/배송|delivery|shipping/.test(lower)) return "delivery";
  if (/취소|환불|반품|교환|cancel|refund|return|exchange/.test(lower)) return "cancel_refund_exchange";
  if (/상품|product|item/.test(lower)) return "product";
  return "other";
}

/** Stable id: prefer the inquiry number; else a content hash so two rows don't collide. */
function eventIdFor(channel: EsmChannel, inquiryNo: unknown, raw: RawEsmInquiry): string {
  const no = refOrNull(inquiryNo);
  if (no !== null) return `esmplus:${channel}:${no}`;
  const basis = JSON.stringify([raw.title ?? "", raw.contents ?? "", raw.regDt ?? "", raw.itemNo ?? "", raw.orderNo ?? ""]);
  const hash = createHash("sha256").update(basis, "utf8").digest("hex").slice(0, 16);
  return `esmplus:${channel}:h:${hash}`;
}

/**
 * Normalize one raw ESM inquiry into a `SellerOpsInquiryEvent`. All fields are
 * optional-safe (missing → null/unknown). Buyer identity is never carried over.
 */
export function normalizeEsmInquiry(raw: RawEsmInquiry): SellerOpsInquiryEvent {
  const channel = channelOf(raw.siteGubun);
  const createdAt = trimOrNull(raw.regDt);
  // INTERNAL: parse the primary timestamp only when it is offset-bearing; absent
  // otherwise (timezone-less / invalid / missing). Never exposed in sanitized output.
  const parsedEventTimeMs = parseOffsetTimestampToEpochMs(createdAt);
  return {
    eventId: eventIdFor(channel, raw.inquiryNo, raw),
    platform: "ESM_PLUS",
    kind: "cs_inquiry",
    channel,
    category: categoryOf(raw.inquiryTypeName),
    status: statusOf(raw.answerYn),
    title: trimOrNull(raw.title),
    body: trimOrNull(raw.contents),
    createdAt,
    productRef: refOrNull(raw.itemNo),
    orderRef: refOrNull(raw.orderNo),
    ...(parsedEventTimeMs !== null ? { eventTimeMs: parsedEventTimeMs } : {}),
  };
}

/** Log-safe summary — categories/booleans only; never content, refs, ids, or PII. */
export function sanitizedInquirySummary(
  event: SellerOpsInquiryEvent,
  opts: SanitizedSummaryOptions = {},
): SanitizedInquirySummary {
  // Recency is derived from the internal `eventTimeMs` + an EXPLICIT caller reference
  // time only; no wall-clock read. No reference time → `unknown`. The exact time and
  // elapsed duration are never exposed — only the coarse bucket.
  const recencyBucket =
    opts.referenceTimeMs === undefined
      ? "unknown"
      : recencyBucketFor(event.eventTimeMs, opts.referenceTimeMs);
  return {
    platform: event.platform,
    kind: event.kind,
    channel: event.channel,
    category: event.category,
    status: event.status,
    hasTitle: event.title !== null,
    hasBody: event.body !== null,
    hasProductRef: event.productRef !== null,
    hasOrderRef: event.orderRef !== null,
    hasCreatedAt: event.createdAt !== null,
    recencyBucket,
  };
}
