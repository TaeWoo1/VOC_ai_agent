/**
 * **Cloud-side inquiry ingestion consumer** (pure, offline) — the trust boundary.
 *
 * Consumes the channel-neutral {@link InquiryIngestionEnvelope} (envelope ONLY — never a producer's capture
 * type), and BEFORE touching the workflow it fails closed on: schema version, strict envelope shape, the
 * producer adapter registry, a recomputed event id (the caller-supplied id is never trusted as identity), and
 * a caller-supplied AUTHENTICATED context (seller + authorized connections). Only then does it map the
 * envelope into the existing {@link InquiryObservation} and drive the existing {@link InquiryIntakeCoordinator}
 * (which remains the WorkItem deduplication authority via its channel source identity). Only SANITIZED per-item
 * outcomes cross back out — never inquiry text or order references, in success OR failure.
 *
 * This is the TRANSPORT BOUNDARY only. The Local Agent owns capture; the Cloud owns WorkItems / proposals /
 * approvals / execution (elsewhere). The `IngestionContext` is the pure application seam a future
 * authenticated Cloud endpoint supplies — there is NO HTTP, JWT, persistence, or live authentication here, and
 * no wall clock, browser, connector, or LLM.
 */

import type { WorkItemPhase } from "../work/types";
import { INQUIRY_ENVELOPE_SCHEMA_VERSION, deriveEventId, validateEnvelope, type InquiryIngestionEnvelope } from "./envelope";
import { checkAdapter } from "./adapter-registry";
import type { InquiryObservation } from "../inquiry/observation";
import type { InquiryIntakeCoordinator } from "../inquiry/coordinator";

/** Why the consumer rejected an envelope before/at intake. Sanitized — never contains raw payload. */
export type IngestionRejectReason =
  | "UNSUPPORTED_SCHEMA_VERSION"
  | "INVALID_ENVELOPE"
  | "UNKNOWN_ADAPTER"
  | "UNSUPPORTED_ADAPTER_VERSION"
  | "ADAPTER_CHANNEL_MISMATCH"
  | "EVENT_ID_MISMATCH"
  | "SELLER_CONTEXT_MISMATCH"
  | "CONNECTION_NOT_AUTHORIZED"
  | "SOURCE_CONFLICT"
  | "PROPOSAL_UNAVAILABLE";

/** Sanitized per-item ingestion outcome — enums / ids / booleans only. Never inquiry/reply text or order ref. */
export type IngestionItemOutcome =
  | { ok: true; eventId: string; workItemId: string; phase: WorkItemPhase; proposed: boolean; idempotent: boolean }
  | { ok: false; eventId: string; reason: IngestionRejectReason };

/**
 * The trusted, caller-supplied authentication context a future authenticated Cloud endpoint provides. Pure
 * application seam — NOT JWT/HTTP/session. The consumer trusts these fields and validates the envelope against
 * them.
 */
export interface IngestionContext {
  authenticatedSellerId: string;
  authorizedConnectionIds: readonly string[];
}

/** Map a validated envelope into the existing channel-neutral observation (raw fields from the private payload). */
function envelopeToObservation(envelope: InquiryIngestionEnvelope): InquiryObservation {
  return {
    sellerId: envelope.sellerId,
    connectionId: envelope.connectionId,
    channel: envelope.channel,
    channelInquiryId: envelope.channelInquiryId,
    productId: envelope.productId,
    orderRef: envelope.sellerPrivatePayload.orderRef,
    inquiryText: envelope.sellerPrivatePayload.inquiryText,
    title: envelope.sellerPrivatePayload.title,
    observedAt: envelope.sourceObservedAt,
    responseDeadlineAt: envelope.responseDeadlineAt,
    category: envelope.category,
  };
}

export class InquiryIngestionConsumer {
  /** Wraps ONE intake coordinator so dedup state persists across ingests (the dedup authority). */
  constructor(private readonly intake: InquiryIntakeCoordinator) {}

  /**
   * Ingest one envelope under a trusted context. Validation order (fail closed, no workflow call on failure):
   * schema version → strict envelope shape → adapter registry → recomputed event id → authenticated context.
   * Only then map + hand to the intake coordinator. Never retries.
   */
  async ingest(envelope: InquiryIngestionEnvelope, context: IngestionContext, atMs: number): Promise<IngestionItemOutcome> {
    const reject = (reason: IngestionRejectReason): IngestionItemOutcome => ({ ok: false, eventId: envelope.eventId, reason });

    if (envelope.schemaVersion !== INQUIRY_ENVELOPE_SCHEMA_VERSION) return reject("UNSUPPORTED_SCHEMA_VERSION");

    const shape = validateEnvelope(envelope);
    if (!shape.ok) return reject(shape.reason);

    const adapter = checkAdapter(envelope.sourceAdapter, envelope.channel);
    if (!adapter.ok) return reject(adapter.reason);

    // Recompute the event id from the trusted identity fields — the caller-supplied id is never trusted.
    const expectedEventId = deriveEventId({ schemaVersion: envelope.schemaVersion, sellerId: envelope.sellerId, channel: envelope.channel, connectionId: envelope.connectionId, channelInquiryId: envelope.channelInquiryId });
    if (expectedEventId !== envelope.eventId) return reject("EVENT_ID_MISMATCH");

    if (envelope.sellerId !== context.authenticatedSellerId) return reject("SELLER_CONTEXT_MISMATCH");
    if (!context.authorizedConnectionIds.includes(envelope.connectionId)) return reject("CONNECTION_NOT_AUTHORIZED");

    const outcome = await this.intake.ingest(envelopeToObservation(envelope), atMs);
    if (!outcome.ok) return reject(outcome.reason);
    const { workItem } = outcome.slice.aggregate;
    return { ok: true, eventId: envelope.eventId, workItemId: workItem.workItemId, phase: workItem.phase, proposed: outcome.slice.proposal !== null, idempotent: outcome.idempotent };
  }

  /**
   * Ingest a batch under one context, applied INDEPENDENTLY to every item, preserving input order. One
   * invalid/unauthorized/conflicting item never blocks the others; duplicate events dedup through the
   * coordinator (no second WorkItem, no re-draft); a batch replay is idempotent. No hidden retries. Processed
   * sequentially so the shared dedup state stays consistent.
   */
  async ingestBatch(envelopes: readonly InquiryIngestionEnvelope[], context: IngestionContext, atMs: number): Promise<IngestionItemOutcome[]> {
    const results: IngestionItemOutcome[] = [];
    for (const envelope of envelopes) {
      results.push(await this.ingest(envelope, context, atMs));
    }
    return results;
  }
}
