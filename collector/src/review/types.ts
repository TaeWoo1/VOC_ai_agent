/**
 * Cross-platform review signal model (offline spec layer).
 *
 * Reviews are SellerOps' differentiation axis. This module defines the common,
 * platform-agnostic shape that *future* platform collectors (NAVER, ESM Plus,
 * Cafe24, Coupang, …) normalize their raw review rows into — so downstream AI
 * tasks (classification, complaint extraction, product insight, reply drafts,
 * priority scoring) consume one stream regardless of source.
 *
 * This is types only — no I/O, no network, no secrets, no live collection. No
 * reviewer PII, seller identity, raw URL/HTML, screenshot, or token belongs here.
 */

/**
 * How a review was (or would be) obtained. Reviews are platform-specific: some
 * platforms expose an official API, some only an export, some neither (→ a
 * user-consented browser/export fallback or a manual upload). `unknown` until known.
 */
export type ReviewCollectionMethod =
  | "official_api"
  | "official_export"
  | "browser_export"
  | "manual_upload"
  | "unknown";

/** Whether the seller has replied to the review. `unknown` until known. */
export type ReviewReplyStatus = "not_replied" | "replied" | "unknown";

/** Originating platform of a normalized review. `UNKNOWN` is the honest offline default. */
export type ReviewPlatform = "NAVER" | "ESM_PLUS" | "CAFE24" | "COUPANG" | "UNKNOWN";

/**
 * The common SellerOps event a raw review normalizes into. It carries the review
 * CONTENT (title/body/option) and reference CODES (product/order/review), which are
 * the VOC value; it deliberately carries NO reviewer name/contact, NO buyer/account/
 * seller identity, and NO raw URL/HTML/screenshot/token — those are dropped at
 * normalization, never stored.
 */
export interface SellerOpsReviewEvent {
  /** Deterministic id: `review:<platform>:<channel>:<reviewRef>` or a content hash when absent. */
  eventId: string;
  platform: ReviewPlatform;
  kind: "review";
  /** Free-form sub-channel/store identifier as provided (not PII); `unknown` when absent. */
  channel: string;
  /** Product reference code (not PII); null when absent. */
  productRef: string | null;
  /** Order reference code (not PII); null when absent. */
  orderRef: string | null;
  /** Review reference code (not PII); null when absent. */
  reviewRef: string | null;
  /** Numeric rating as provided; null when absent/unparseable. */
  rating: number | null;
  /** Review title (content); null when absent. */
  title: string | null;
  /** Review body (content); null when absent. */
  body: string | null;
  /** Purchased-option text (content, e.g. color/size); null when absent. */
  optionText: string | null;
  /** ISO-ish written timestamp as provided; null when absent. */
  writtenAt: string | null;
  /** ISO-ish last-update timestamp as provided; null when absent. */
  updatedAt: string | null;
  replyStatus: ReviewReplyStatus;
  collectionMethod: ReviewCollectionMethod;
}

/** Coarse rating bucket for sanitized summaries — never the exact rating value. */
export type RatingBucket = "low" | "mid" | "high" | "unknown";

/**
 * Log-safe summary of a review event. It exposes categories/booleans only — NEVER
 * the review body/title/option, and NEVER product/review/order reference codes or
 * any identity. Rating is reduced to a coarse bucket.
 */
export interface SanitizedReviewSummary {
  platform: string;
  kind: "review";
  channel: string;
  ratingBucket: RatingBucket;
  hasProductRef: boolean;
  hasReviewRef: boolean;
  hasBody: boolean;
  hasOptionText: boolean;
  hasWrittenAt: boolean;
  replyStatus: ReviewReplyStatus;
  collectionMethod: ReviewCollectionMethod;
}
