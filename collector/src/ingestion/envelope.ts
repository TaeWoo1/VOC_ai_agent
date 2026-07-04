/**
 * **Versioned inquiry ingestion envelope** (pure, offline) — the transport contract between a Local Agent
 * producer (browser/API channel capture) and the Cloud ingestion consumer.
 *
 * Channel-neutral: ESM is the first producer, but NAVER / Cafe24 producers emit the SAME envelope without the
 * inquiry workflow changing. The Cloud consumer depends only on this type, never on any producer's capture
 * shape.
 *
 * **Privacy.** The raw operational fields (`inquiryText`, `orderRef`) live in `sellerPrivatePayload` — a
 * compartment that is **logically seller-private**. This is NOT encryption by itself; authenticated transport
 * and encryption are deferred to the live Cloud transport slice. Sanitized ingestion results and validation
 * errors NEVER include this payload.
 *
 * **Identity.** All timestamps are caller-supplied epoch-ms (no wall-clock read). `eventId` is the
 * DETERMINISTIC transport-event identity — a canonical, length-delimited hash of the schema version, seller
 * id, channel, connection id, and channel inquiry id. It is NOT the WorkItem deduplication authority (the
 * intake coordinator's channel source identity is); the consumer recomputes it and never trusts the
 * caller-supplied value.
 */

import { createHash } from "node:crypto";

import type { CommerceChannel } from "../connection/sync-state";
import type { InquiryCategoryMeta } from "../inquiry/observation";

/** The envelope schema version this build produces + accepts. */
export const INQUIRY_ENVELOPE_SCHEMA_VERSION = 1 as const;

/** Which producer emitted the envelope, and which channel it claims to produce for. */
export interface SourceAdapterRef {
  /** Adapter id, e.g. "esm-inquiry". */
  name: string;
  /** Adapter version, e.g. "0.1.0". */
  version: string;
  /** The channel this adapter claims — validated against the registry, not trusted. */
  channel: CommerceChannel;
}

/** Raw operational data — logically seller-private. Never surfaced in a sanitized result. */
export interface SellerPrivatePayload {
  /** Raw inquiry body text — seller-private. */
  inquiryText: string;
  /** Optional raw order reference — seller-private. */
  orderRef: string | null;
  /** Optional raw inquiry title — seller-private (preserved alongside the body when the source has one). */
  title?: string;
}

/**
 * One versioned inquiry ingestion envelope. `(channel, connectionId, channelInquiryId)` is the channel source
 * identity; `productId` + `category` are sanitized/aggregatable metadata; `sellerPrivatePayload` holds the
 * protected raw fields. Carries no customer identity beyond what {@link InquiryObservation} already allows.
 */
export interface InquiryIngestionEnvelope {
  schemaVersion: typeof INQUIRY_ENVELOPE_SCHEMA_VERSION;
  /** Deterministic transport identity (see {@link deriveEventId}). Recomputed + verified by the consumer. */
  eventId: string;
  sellerId: string;
  connectionId: string;
  channel: CommerceChannel;
  channelInquiryId: string;
  /** Caller-supplied epoch-ms when the Local Agent captured the record. */
  capturedAt: number;
  /** Caller-supplied epoch-ms when the record was observed at the source. */
  sourceObservedAt: number;
  /** Product reference (catalog-level, non-PII). */
  productId: string;
  /** Optional caller-supplied epoch-ms response deadline. */
  responseDeadlineAt: number | null;
  /** Sanitized category metadata. */
  category: InquiryCategoryMeta;
  /** The producing adapter (name + version + claimed channel). */
  sourceAdapter: SourceAdapterRef;
  /** The logically seller-private payload — raw operational fields only. */
  sellerPrivatePayload: SellerPrivatePayload;
}

/** The identity an event id is derived from: schema version + seller + channel source identity. */
export interface EventIdInput {
  schemaVersion: number;
  sellerId: string;
  channel: CommerceChannel;
  connectionId: string;
  channelInquiryId: string;
}

/** Netstring encoding (`<len>:<value>,`) — injective, so distinct identities never encode the same string. */
function netstring(value: string): string {
  return `${value.length}:${value},`;
}

/**
 * Derive the deterministic transport event id: SHA-256 (first 16 hex) over the canonically length-delimited
 * (schema version, seller id, channel, connection id, channel inquiry id). Pure — no clock, no randomness.
 */
export function deriveEventId(input: EventIdInput): string {
  const encoded = [String(input.schemaVersion), input.sellerId, input.channel, input.connectionId, input.channelInquiryId].map(netstring).join("");
  return `evt-${createHash("sha256").update(encoded, "utf8").digest("hex").slice(0, 16)}`;
}

const SEVERITY_BUCKETS: ReadonlySet<string> = new Set(["low", "mid", "high"]);

/** Strict envelope validation outcome. Sanitized — never echoes any field value. */
export type EnvelopeValidation = { ok: true } | { ok: false; reason: "INVALID_ENVELOPE" };

/**
 * Fail-closed structural validation, BEFORE any workflow ingestion. Rejects blank required identity/adapter/
 * product/inquiry-text fields, malformed category, non-finite/negative timestamps, and a response deadline
 * earlier than the source observation time. Never fabricates or normalizes a missing value.
 */
export function validateEnvelope(envelope: InquiryIngestionEnvelope): EnvelopeValidation {
  const blank = (s: unknown): boolean => typeof s !== "string" || s.trim().length === 0;
  const badTime = (n: unknown): boolean => typeof n !== "number" || !Number.isFinite(n) || n < 0;

  if ([envelope.sellerId, envelope.connectionId, envelope.channelInquiryId, envelope.productId, envelope.sourceAdapter?.name, envelope.sourceAdapter?.version, envelope.sellerPrivatePayload?.inquiryText, envelope.category?.topicCategory].some(blank)) {
    return { ok: false, reason: "INVALID_ENVELOPE" };
  }
  if (!SEVERITY_BUCKETS.has(envelope.category?.severityBucket as string)) return { ok: false, reason: "INVALID_ENVELOPE" };
  if (badTime(envelope.capturedAt) || badTime(envelope.sourceObservedAt)) return { ok: false, reason: "INVALID_ENVELOPE" };
  if (envelope.responseDeadlineAt !== null) {
    if (badTime(envelope.responseDeadlineAt) || envelope.responseDeadlineAt < envelope.sourceObservedAt) return { ok: false, reason: "INVALID_ENVELOPE" };
  }
  return { ok: true };
}
