/**
 * Pure normalizer: a raw (synthetic) cross-platform review row → the common
 * `SellerOpsReviewEvent`. No network, no fs, no browser, no env — a data transform,
 * fully offline-testable against synthetic fixtures. This is NOT live collection.
 *
 * PII / identity discipline: the raw row may carry reviewer name/contact, buyer/
 * account/seller identity, and raw capture artifacts (URL, HTML, screenshot, token).
 * Those are DROPPED and never copied into the normalized event, which keeps only the
 * review CONTENT (title/body/option) and operational reference CODES. The raw-capture
 * fields are not even part of the typed raw shape — they have no mapping path.
 */

import { createHash } from "node:crypto";
import type {
  RatingBucket,
  ReviewCollectionMethod,
  ReviewPlatform,
  ReviewReplyStatus,
  SanitizedReviewSummary,
  SellerOpsReviewEvent,
} from "./types";

/**
 * Raw synthetic review row (loose — optional, possibly wrong-typed). Stand-in for a
 * future platform collector's output; NOT real data. Reviewer/buyer/seller identity
 * fields are accepted but intentionally NOT mapped into the normalized event. Raw
 * capture artifacts (URL/HTML/screenshot/token) are deliberately absent from this
 * shape — there is no field to carry them through.
 */
export interface RawReview {
  reviewRef?: string | number | null;
  platform?: string | null;
  channel?: string | null;
  productRef?: string | number | null;
  orderRef?: string | number | null;
  rating?: string | number | null;
  title?: string | null;
  body?: string | null;
  optionText?: string | null;
  writtenAt?: string | null;
  updatedAt?: string | null;
  replyStatus?: string | boolean | null;
  collectionMethod?: string | null;
  // Reviewer/buyer/seller identity — accepted in the raw shape but DROPPED.
  reviewerName?: string | null;
  buyerId?: string | null;
  buyerPhone?: string | null;
  buyerEmail?: string | null;
  buyerAddress?: string | null;
  accountId?: string | null;
  sellerId?: string | null;
  masterId?: string | null;
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

/** Free-form channel string; defaults to `"unknown"` (never null — channel is a string field). */
function channelOf(v: unknown): string {
  return trimOrNull(v) ?? "unknown";
}

/** Conservative platform mapping; defaults to `UNKNOWN`. */
function platformOf(v: unknown): ReviewPlatform {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (s === "naver") return "NAVER";
  if (s === "esm_plus" || s === "esmplus" || s === "esm" || s === "gmarket" || s === "auction") return "ESM_PLUS";
  if (s === "cafe24") return "CAFE24";
  if (s === "coupang") return "COUPANG";
  return "UNKNOWN";
}

/** Numeric rating as provided; clean numeric string or finite number, else null. */
function ratingOrNull(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const t = v.trim();
    if (/^\d+(\.\d+)?$/.test(t)) {
      const n = Number(t);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

/** Coarse rating bucket: 1~2 low, 3 mid, 4~5 high, else unknown (decimals fall in range). */
function ratingBucketOf(rating: number | null): RatingBucket {
  if (rating === null) return "unknown";
  if (rating >= 1 && rating < 3) return "low";
  if (rating >= 3 && rating < 4) return "mid";
  if (rating >= 4 && rating <= 5) return "high";
  return "unknown";
}

/** Conservative reply-status mapping; defaults to `unknown`. */
function replyStatusOf(v: unknown): ReviewReplyStatus {
  if (typeof v === "boolean") return v ? "replied" : "not_replied";
  const t = trimOrNull(v);
  if (t === null) return "unknown";
  const lower = t.toLowerCase();
  if (/미답변|not_?replied|none|no_?reply/.test(lower)) return "not_replied";
  if (/답변|replied|완료|done|answered/.test(lower)) return "replied";
  return "unknown";
}

/** Conservative collection-method mapping; defaults to `unknown`. */
function collectionMethodOf(v: unknown): ReviewCollectionMethod {
  const t = trimOrNull(v);
  if (t === null) return "unknown";
  const lower = t.toLowerCase();
  if (lower === "official_api") return "official_api";
  if (lower === "official_export") return "official_export";
  if (lower === "browser_export") return "browser_export";
  if (lower === "manual_upload") return "manual_upload";
  return "unknown";
}

/** Stable id: `review:<platform>:<channel>:<reviewRef>`; else a content hash from non-PII fields. */
function eventIdFor(
  platform: ReviewPlatform,
  channel: string,
  reviewRef: string | null,
  raw: RawReview,
): string {
  if (reviewRef !== null) return `review:${platform}:${channel}:${reviewRef}`;
  const basis = JSON.stringify([
    platform,
    channel,
    refOrNull(raw.productRef) ?? "",
    trimOrNull(raw.writtenAt) ?? "",
    trimOrNull(raw.title) ?? "",
    trimOrNull(raw.body) ?? "",
  ]);
  const hash = createHash("sha256").update(basis, "utf8").digest("hex").slice(0, 16);
  return `review:${platform}:${channel}:h:${hash}`;
}

/** Normalize one raw review into a `SellerOpsReviewEvent`. Reviewer/buyer/seller identity dropped. */
export function normalizeReview(raw: RawReview): SellerOpsReviewEvent {
  const platform = platformOf(raw.platform);
  const channel = channelOf(raw.channel);
  const reviewRef = refOrNull(raw.reviewRef);
  return {
    eventId: eventIdFor(platform, channel, reviewRef, raw),
    platform,
    kind: "review",
    channel,
    productRef: refOrNull(raw.productRef),
    orderRef: refOrNull(raw.orderRef),
    reviewRef,
    rating: ratingOrNull(raw.rating),
    title: trimOrNull(raw.title),
    body: trimOrNull(raw.body),
    optionText: trimOrNull(raw.optionText),
    writtenAt: trimOrNull(raw.writtenAt),
    updatedAt: trimOrNull(raw.updatedAt),
    replyStatus: replyStatusOf(raw.replyStatus),
    collectionMethod: collectionMethodOf(raw.collectionMethod),
  };
}

/**
 * Log-safe summary — categories/booleans + a coarse rating bucket only. NEVER the
 * review body/title/option, NEVER product/review/order refs, NEVER any identity.
 */
export function sanitizedReviewSummary(event: SellerOpsReviewEvent): SanitizedReviewSummary {
  return {
    platform: event.platform,
    kind: event.kind,
    channel: event.channel,
    ratingBucket: ratingBucketOf(event.rating),
    hasProductRef: event.productRef !== null,
    hasReviewRef: event.reviewRef !== null,
    hasBody: event.body !== null,
    hasOptionText: event.optionText !== null,
    hasWrittenAt: event.writtenAt !== null,
    replyStatus: event.replyStatus,
    collectionMethod: event.collectionMethod,
  };
}
