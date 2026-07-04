/**
 * **ESM inquiry producer seam** (pure, offline) — the FIRST producer for the ingestion envelope.
 *
 * `EsmInquiryCapture` models a record ALREADY observed by a *future* ESM browser collector. It is
 * deliberately NOT a claim about the official ESM page or export schema — the real field mapping is deferred
 * until supervised UI/schema discovery confirms the source fields. This module contains NO selectors, browser
 * calls, downloads, or login behavior; it only maps an already-captured record into the channel-neutral
 * {@link InquiryIngestionEnvelope}.
 *
 * Required source identity (sellerId, connectionId, esmInquiryId) is validated and a missing/blank value is
 * REJECTED — never fabricated. `capturedAt` is supplied by the caller (the Local Agent); the module reads no
 * clock.
 */

import type { SeverityBucket } from "../work/types";
import { INQUIRY_ENVELOPE_SCHEMA_VERSION, deriveEventId, type InquiryIngestionEnvelope } from "./envelope";
import { INQUIRY_ADAPTER_REGISTRY } from "./adapter-registry";

/**
 * The ONE explicit registered descriptor this producer emits — pinned to a live registry entry so a producer
 * can never emit an unregistered adapter. Not the official ESM schema; a provisional pre-discovery seam.
 */
export const ESM_INQUIRY_ADAPTER = { name: "esm-inquiry", version: "0.1.0", channel: "ESM" } as const;

// Compile-time-ish assurance the emitted descriptor is registered (a test also asserts this).
const _REGISTERED = INQUIRY_ADAPTER_REGISTRY.some((a) => a.name === ESM_INQUIRY_ADAPTER.name && a.versions.includes(ESM_INQUIRY_ADAPTER.version) && a.channel === ESM_INQUIRY_ADAPTER.channel);
if (!_REGISTERED) throw new Error("esm-producer: ESM_INQUIRY_ADAPTER is not registered in INQUIRY_ADAPTER_REGISTRY");

/**
 * A record an ESM browser collector WOULD hand off, already observed. Provisional field set — subject to
 * supervised discovery. Carries no customer identity beyond what the envelope/observation already allow.
 */
export interface EsmInquiryCapture {
  sellerId: string;
  connectionId: string;
  /** The inquiry id as ESM exposes it — the channel inquiry id. */
  esmInquiryId: string;
  productId: string;
  orderRef: string | null;
  inquiryText: string;
  /** Caller-supplied epoch-ms the record was observed at the source. */
  observedAtMs: number;
  responseDeadlineAtMs: number | null;
  topicCategory: string;
  severityBucket: SeverityBucket;
}

/** Why an ESM capture could not become an envelope — a required source-identity field was missing/blank. */
export type EsmCaptureRejectReason = "MISSING_SELLER_ID" | "MISSING_CONNECTION_ID" | "MISSING_CHANNEL_INQUIRY_ID";

export type EsmCaptureResult =
  | { ok: true; envelope: InquiryIngestionEnvelope }
  | { ok: false; reason: EsmCaptureRejectReason };

const blank = (s: string): boolean => s.trim().length === 0;

/**
 * Map an already-observed {@link EsmInquiryCapture} into a versioned {@link InquiryIngestionEnvelope}. Rejects
 * (never invents) a missing/blank required source identity; the deterministic `eventId` is derived from the
 * channel source identity + schema version.
 */
export function esmCaptureToEnvelope(capture: EsmInquiryCapture, capturedAt: number): EsmCaptureResult {
  if (blank(capture.sellerId)) return { ok: false, reason: "MISSING_SELLER_ID" };
  if (blank(capture.connectionId)) return { ok: false, reason: "MISSING_CONNECTION_ID" };
  if (blank(capture.esmInquiryId)) return { ok: false, reason: "MISSING_CHANNEL_INQUIRY_ID" };

  const channel = ESM_INQUIRY_ADAPTER.channel;
  const eventId = deriveEventId({ schemaVersion: INQUIRY_ENVELOPE_SCHEMA_VERSION, sellerId: capture.sellerId, channel, connectionId: capture.connectionId, channelInquiryId: capture.esmInquiryId });

  return {
    ok: true,
    envelope: {
      schemaVersion: INQUIRY_ENVELOPE_SCHEMA_VERSION,
      eventId,
      sellerId: capture.sellerId,
      connectionId: capture.connectionId,
      channel,
      channelInquiryId: capture.esmInquiryId,
      capturedAt,
      sourceObservedAt: capture.observedAtMs,
      productId: capture.productId,
      responseDeadlineAt: capture.responseDeadlineAtMs,
      category: { topicCategory: capture.topicCategory, severityBucket: capture.severityBucket },
      sourceAdapter: { name: ESM_INQUIRY_ADAPTER.name, version: ESM_INQUIRY_ADAPTER.version, channel },
      sellerPrivatePayload: { inquiryText: capture.inquiryText, orderRef: capture.orderRef },
    },
  };
}
