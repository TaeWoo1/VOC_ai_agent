/**
 * Pure normalizer: a raw (synthetic) ESM Plus claim row → the common
 * `SellerOpsClaimEvent`. No network, no fs, no browser, no env — a data transform,
 * fully offline-testable against synthetic fixtures.
 *
 * PII discipline: the raw claim may carry buyer/recipient identity. Those are
 * DROPPED and never copied into the normalized event, which keeps only operational
 * reference codes (order/product/claim), the claim type/status, a conservative
 * reason category, and the reason text (content). No seller identity.
 */

import { createHash } from "node:crypto";
import { parseOffsetTimestampToEpochMs } from "../events/offset-timestamp-parser";
import { recencyBucketFor } from "../events/recency-bucket";
import type { SanitizedSummaryOptions } from "../events/recency-bucket";
import type {
  ClaimReasonCategory,
  ClaimStatus,
  ClaimType,
  EsmChannel,
  SanitizedClaimSummary,
  SellerOpsClaimEvent,
} from "./types";

/**
 * Raw synthetic ESM claim shape (loose — optional, possibly wrong-typed). Stand-in
 * for an official API row; NOT real data. Buyer/recipient identity fields are
 * accepted but intentionally NOT mapped into the normalized event.
 */
export interface RawEsmClaim {
  claimNo?: string | number | null;
  siteGubun?: string | null;
  claimType?: string | null;
  claimStatus?: string | null;
  regDt?: string | null;
  updateDt?: string | null;
  itemNo?: string | number | null;
  orderNo?: string | number | null;
  reasonName?: string | null;
  reasonText?: string | null;
  // Buyer/recipient identity — accepted in the raw shape but DROPPED.
  buyerName?: string | null;
  buyerId?: string | null;
  buyerPhone?: string | null;
  receiverName?: string | null;
  receiverPhone?: string | null;
  receiverAddress?: string | null;
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

/** Conservative claim-type mapping; defaults to `unknown` (absent or unmapped). */
function claimTypeOf(raw: unknown): ClaimType {
  const t = trimOrNull(raw);
  if (t === null) return "unknown";
  const lower = t.toLowerCase();
  if (/취소|cancel/.test(lower)) return "cancel";
  if (/교환|exchange/.test(lower)) return "exchange";
  if (/반품|return/.test(lower)) return "return";
  if (/환불|refund/.test(lower)) return "refund";
  return "unknown";
}

/** Conservative claim-status mapping; defaults to `unknown`. */
function claimStatusOf(raw: unknown): ClaimStatus {
  const t = trimOrNull(raw);
  if (t === null) return "unknown";
  const lower = t.toLowerCase();
  if (/완료|resolved|승인|완료처리/.test(lower)) return "resolved";
  if (/거부|반려|rejected|불가/.test(lower)) return "rejected";
  if (/진행|처리중|in_?progress|접수처리/.test(lower)) return "in_progress";
  if (/접수|신청|open|요청/.test(lower)) return "open";
  return "unknown";
}

/** Conservative reason-category mapping; defaults to `unknown` (absent) / `other` (present, unmapped). */
function reasonCategoryOf(reasonName: unknown): ClaimReasonCategory {
  const t = trimOrNull(reasonName);
  if (t === null) return "unknown";
  const lower = t.toLowerCase();
  if (/배송|delivery|shipping|지연/.test(lower)) return "delivery";
  if (/상품|불량|파손|product|defect|damaged/.test(lower)) return "product";
  if (/단순변심|변심|change|change_of_mind/.test(lower)) return "customer_change";
  if (/결제|환불|payment|refund/.test(lower)) return "payment";
  return "other";
}

/** Stable id: prefer the claim number; else a content hash from non-PII fields. */
function eventIdFor(channel: EsmChannel, claimNo: unknown, raw: RawEsmClaim): string {
  const no = refOrNull(claimNo);
  if (no !== null) return `esmplus:${channel}:claim:${no}`;
  const basis = JSON.stringify([
    refOrNull(raw.orderNo) ?? "",
    refOrNull(raw.itemNo) ?? "",
    trimOrNull(raw.claimType) ?? "",
    trimOrNull(raw.regDt) ?? "",
  ]);
  const hash = createHash("sha256").update(basis, "utf8").digest("hex").slice(0, 16);
  return `esmplus:${channel}:claim:h:${hash}`;
}

/** Normalize one raw ESM claim into a `SellerOpsClaimEvent`. Buyer/recipient PII is dropped. */
export function normalizeEsmClaim(raw: RawEsmClaim): SellerOpsClaimEvent {
  const channel = channelOf(raw.siteGubun);
  const createdAt = trimOrNull(raw.regDt);
  // INTERNAL: parse the primary timestamp only when it is offset-bearing; absent
  // otherwise (timezone-less / invalid / missing). Never exposed in sanitized output.
  const parsedEventTimeMs = parseOffsetTimestampToEpochMs(createdAt);
  return {
    eventId: eventIdFor(channel, raw.claimNo, raw),
    platform: "ESM_PLUS",
    kind: "claim",
    channel,
    claimType: claimTypeOf(raw.claimType),
    status: claimStatusOf(raw.claimStatus),
    createdAt,
    updatedAt: trimOrNull(raw.updateDt),
    productRef: refOrNull(raw.itemNo),
    orderRef: refOrNull(raw.orderNo),
    claimRef: refOrNull(raw.claimNo),
    reasonCategory: reasonCategoryOf(raw.reasonName),
    reasonText: trimOrNull(raw.reasonText),
    ...(parsedEventTimeMs !== null ? { eventTimeMs: parsedEventTimeMs } : {}),
  };
}

/** Log-safe summary — categories/booleans only; never content, refs, ids, or PII. */
export function sanitizedClaimSummary(
  event: SellerOpsClaimEvent,
  opts: SanitizedSummaryOptions = {},
): SanitizedClaimSummary {
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
    claimType: event.claimType,
    status: event.status,
    reasonCategory: event.reasonCategory,
    hasReasonText: event.reasonText !== null,
    hasOrderRef: event.orderRef !== null,
    hasProductRef: event.productRef !== null,
    hasClaimRef: event.claimRef !== null,
    hasCreatedAt: event.createdAt !== null,
    hasUpdatedAt: event.updatedAt !== null,
    recencyBucket,
  };
}
