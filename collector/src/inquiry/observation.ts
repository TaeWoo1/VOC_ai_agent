/**
 * **Channel-neutral inquiry observation** (pure, offline).
 *
 * The minimal shape the inquiry vertical slice needs to operate — one customer inquiry as observed on a
 * seller's channel, BEFORE it is turned into a sanitized {@link CommerceSignal}. It carries both the raw,
 * seller-private operational fields (inquiry text, order reference) and coarse sanitized category metadata;
 * the intake adapter (`intake.ts`) decides what stays seller-private and what is safe to share.
 *
 * This is an observation, not a live-collection result: producing it involves no NAVER/ESM call, no
 * connector, no browser, no HTTP — a caller (a future ingestion adapter) hands it in. `observedAt` /
 * `responseDeadlineAt` are caller-supplied epoch-ms (never a wall-clock read here).
 */

import type { CommerceChannel } from "../connection/sync-state";
import type { SeverityBucket } from "../work/types";

/** Sanitized, coarse category metadata for an inquiry — safe to carry into the shareable projection. */
export interface InquiryCategoryMeta {
  /** Coarse topic category (e.g. "stock", "sizing", "shipping") — never the raw inquiry text. */
  topicCategory: string;
  severityBucket: SeverityBucket;
}

/**
 * One channel-neutral inquiry observation. The raw `inquiryText` / `orderRef` are seller-private operational
 * data; `productId` + `category` are the shareable/aggregatable metadata. `(channel, connectionId,
 * channelInquiryId)` is the channel SOURCE IDENTITY the intake adapter derives deterministic ids from.
 */
export interface InquiryObservation {
  sellerId: string;
  connectionId: string;
  channel: CommerceChannel;
  /** The inquiry's id in the channel — part of the source identity, scoped to the connection. */
  channelInquiryId: string;
  /** Product reference (catalog-level, non-PII) — the shareable aggregation key. */
  productId: string;
  /** Optional order reference (raw) — seller-private; only a hash reaches the signal. */
  orderRef: string | null;
  /** Raw inquiry text — seller-private; NEVER enters the shareable projection. */
  inquiryText: string;
  /** Optional raw inquiry title — seller-private; NEVER enters the shareable projection. */
  title?: string;
  /** Caller-supplied epoch-ms the inquiry was observed. */
  observedAt: number;
  /** Optional caller-supplied epoch-ms response deadline. */
  responseDeadlineAt: number | null;
  /** Sanitized category metadata. */
  category: InquiryCategoryMeta;
}
