/**
 * **ESM Trading CS record → existing inquiry envelope mapper** (pure, offline).
 *
 * Maps an official-API {@link EsmCsInquiryRecord} for one {@link SellerConnection} into the merged
 * {@link InquiryIngestionEnvelope}. The transport DTO carries only exact API fields; the mapper is where all
 * INTERNAL values are derived:
 *  - **marketplace (A/G site)** comes from the caller's query context and is validated against the connection
 *    (and cross-checked to `record.sellerId`) — never fabricated from a response field;
 *  - **intake eligibility** is driven SOLELY by the official `informStatus` (`미처리` → ingest, `처리완료` →
 *    skip, unknown → fail closed); `answerDate` is NOT used for eligibility — it may carry a sentinel value;
 *  - **epoch timestamps** are caller-supplied in the context (the transport resolves `receiveDate` upstream —
 *    raw `receiveDate` parsing is DEFERRED until its official format is confirmed; this pure module reads no
 *    clock and does not parse date strings);
 *  - **topic/severity** are derived in SellerOps ({@link deriveInquiryCategory}, placeholder).
 *
 * `title` + `details` are PRESERVED in `sellerPrivatePayload`; the reply `token` is EXTRACTED to the encrypted
 * store (keyed by connectionId + sellerId + messageNo) and never enveloped; `responseDeadlineAt` is null (no
 * API deadline). Inquirer PII was already discarded at the DTO boundary. Missing identity / unauthorized site
 * is rejected, never fabricated.
 */

import type { InquiryCategoryMeta } from "../inquiry/observation";
import { INQUIRY_ENVELOPE_SCHEMA_VERSION, deriveEventId, type InquiryIngestionEnvelope } from "./envelope";
import { ESM_TRADING_CS_ADAPTER, type EsmCsInquiryRecord, type EsmMarketplace, type SellerConnection } from "./esm-trading-cs-client";
import type { EsmReplyTokenStore } from "./esm-reply-token-store";

/**
 * Why a record could not be mapped. `ALREADY_ANSWERED` (`처리완료`) is a skip; `UNKNOWN_STATUS` is a
 * fail-closed rejection of an unrecognized `informStatus`.
 */
export type EsmTradingCsIngestReason =
  | "MISSING_SELLER_ID"
  | "MISSING_CONNECTION_ID"
  | "MISSING_MESSAGE_NO"
  | "SITE_NOT_AUTHORIZED"
  | "ALREADY_ANSWERED"
  | "UNKNOWN_STATUS";

export type EsmTradingCsIngestResult =
  | { ok: true; envelope: InquiryIngestionEnvelope }
  | { ok: false; reason: EsmTradingCsIngestReason };

/** Caller-supplied ingest context: the queried marketplace + resolved epoch timestamps (no clock/Date.parse here). */
export interface EsmCsIngestContext {
  /** The A/G site the query ran against — resolved from query context, NOT a response field. */
  marketplace: EsmMarketplace;
  /** Caller-supplied epoch-ms when the Local Agent/transport captured the record. */
  capturedAt: number;
  /** Caller-resolved epoch-ms of `receiveDate` (parsed upstream). */
  observedAtMs: number;
}

const blank = (s: string): boolean => s.trim().length === 0;

/** The connection's ESM seller id for a marketplace, or null if the customer is not on that site. */
function siteSellerId(connection: SellerConnection, marketplace: EsmMarketplace): string | null {
  return marketplace === "GMARKET" ? connection.gmarketSellerId : connection.auctionSellerId;
}

/** The official ESM CS `informStatus` response values. `미처리` = unprocessed (intake-eligible); `처리완료` = done. */
export const ESM_INFORM_STATUS_UNPROCESSED = "미처리";
export const ESM_INFORM_STATUS_COMPLETED = "처리완료";

/** Classify the official `informStatus`; anything unrecognized is `UNKNOWN` (fail closed). */
export function classifyInformStatus(informStatus: string): "UNANSWERED" | "ANSWERED" | "UNKNOWN" {
  if (informStatus === ESM_INFORM_STATUS_UNPROCESSED) return "UNANSWERED";
  if (informStatus === ESM_INFORM_STATUS_COMPLETED) return "ANSWERED";
  return "UNKNOWN";
}

export type IntakeEligibility = { ok: true } | { ok: false; reason: "ALREADY_ANSWERED" | "UNKNOWN_STATUS" };

/**
 * Decide intake eligibility from the OFFICIAL `informStatus` ONLY: `미처리` is eligible, `처리완료` is skipped,
 * anything else fails closed. `answerDate` is intentionally NOT consulted — it may carry a sentinel value.
 */
export function evaluateIntakeEligibility(record: EsmCsInquiryRecord): IntakeEligibility {
  const status = classifyInformStatus(record.informStatus);
  if (status === "ANSWERED") return { ok: false, reason: "ALREADY_ANSWERED" };
  if (status === "UNKNOWN") return { ok: false, reason: "UNKNOWN_STATUS" };
  return { ok: true }; // 미처리
}

/**
 * Derive the coarse topic/severity INSIDE SellerOps — the ESM CS API does not return these. Placeholder:
 * a real classifier is a later slice; this stub emits a fixed coarse category (leaks no raw content).
 */
export function deriveInquiryCategory(_record: EsmCsInquiryRecord): InquiryCategoryMeta {
  return { topicCategory: "unclassified", severityBucket: "mid" };
}

/**
 * Map ONE record for a tenant connection + query context: resolve/validate the A/G site, store the reply
 * token, then build the envelope. Rejects blank identity / unauthorized site; skips answered records.
 */
export async function ingestEsmTradingCsRecord(
  record: EsmCsInquiryRecord,
  connection: SellerConnection,
  context: EsmCsIngestContext,
  store: EsmReplyTokenStore,
): Promise<EsmTradingCsIngestResult> {
  if (blank(connection.sellerId)) return { ok: false, reason: "MISSING_SELLER_ID" };
  if (blank(connection.connectionId)) return { ok: false, reason: "MISSING_CONNECTION_ID" };
  if (blank(record.messageNo)) return { ok: false, reason: "MISSING_MESSAGE_NO" };

  // A/G site: resolved from the query context + connection, cross-checked to the response's marketplace seller id.
  const expectedSiteSeller = siteSellerId(connection, context.marketplace);
  if (expectedSiteSeller === null || expectedSiteSeller !== record.sellerId) return { ok: false, reason: "SITE_NOT_AUTHORIZED" };

  const eligibility = evaluateIntakeEligibility(record);
  if (!eligibility.ok) return { ok: false, reason: eligibility.reason };

  // The reply token lives ONLY in the encrypted store, scoped to this tenant connection × seller × message.
  await store.put({ connectionId: connection.connectionId, sellerId: connection.sellerId, messageNo: record.messageNo }, record.token);

  const channel = "ESM" as const;
  const eventId = deriveEventId({ schemaVersion: INQUIRY_ENVELOPE_SCHEMA_VERSION, sellerId: connection.sellerId, channel, connectionId: connection.connectionId, channelInquiryId: record.messageNo });

  return {
    ok: true,
    envelope: {
      schemaVersion: INQUIRY_ENVELOPE_SCHEMA_VERSION,
      eventId,
      sellerId: connection.sellerId,
      connectionId: connection.connectionId,
      channel,
      channelInquiryId: record.messageNo,
      capturedAt: context.capturedAt,
      sourceObservedAt: context.observedAtMs,
      productId: record.goodsNo,
      responseDeadlineAt: null, // the ESM CS API returns no response deadline
      category: deriveInquiryCategory(record),
      sourceAdapter: { name: ESM_TRADING_CS_ADAPTER.name, version: ESM_TRADING_CS_ADAPTER.version, channel },
      // title + details preserved in the seller-private compartment.
      sellerPrivatePayload: { inquiryText: record.details, orderRef: record.orderNo, title: record.title },
    },
  };
}

/**
 * Map a batch of records for ONE tenant connection + context, independently and in order. Each mapped record
 * stores its token and yields an envelope; skipped/invalid records yield a reason. No cross-record state.
 */
export async function ingestEsmTradingCsRecords(
  records: readonly EsmCsInquiryRecord[],
  connection: SellerConnection,
  context: EsmCsIngestContext,
  store: EsmReplyTokenStore,
): Promise<EsmTradingCsIngestResult[]> {
  const results: EsmTradingCsIngestResult[] = [];
  for (const record of records) {
    results.push(await ingestEsmTradingCsRecord(record, connection, context, store));
  }
  return results;
}
