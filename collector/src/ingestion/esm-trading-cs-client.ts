/**
 * **ESM Trading CS API — client seam + multi-tenant contract** (pure, offline).
 *
 * The official-API pivot for ESM inquiries (Cloud API track — NOT the Local Agent browser track). A
 * transport-agnostic SEAM only: production wires a real HTTP client behind {@link EsmTradingCsClient}, tests
 * inject a fake. There is NO HTTP, no real credential, and no browser inquiry capture here.
 *
 * **Transport DTO = exact official response fields.** {@link EsmCsInquiryRecord} mirrors the ESM CS/QnA
 * response 1:1 (`qnaType, sellerId, messageNo, goodsNo, siteGoodsNo, orderNo, payNo, informStatus,
 * receiveDate, answerDate, contractType, title, details, token, reAsking`). Internal marketplace / answer
 * status / epoch timestamps are NOT DTO fields — they are derived in the mapper. Inquirer PII
 * (`inquirerName` / `inquirerPhone`) is DISCARDED at the raw→DTO boundary ({@link discardInquirerPii}) and
 * never modeled on the DTO.
 *
 * **Tenancy (Model B).** SellerOps owns its own ESM+ Master ID (JWT `kid`) + Secret Key, referenced (never
 * embodied) by {@link ProviderCredentialRef}. Each customer is a {@link SellerConnection} holding optional
 * Gmarket / Auction seller ids (the A/G site is resolved from the query context + connection, never from a
 * response field). CS listing is bounded to a 7-day window ({@link validateQueryWindow}).
 *
 * **Secrets & PII.** `token` is secret-adjacent — extracted to the encrypted store, never enveloped/logged/
 * audited. `secretKeyRef`/`masterId` are never logged. Field names track the ESM Trading API CS/QnA guide;
 * anything unconfirmed stays a labeled placeholder (§6 — never guess-tuned).
 */

/** The registered adapter descriptor this API producer emits (pinned to `adapter-registry.ts`). */
export const ESM_TRADING_CS_ADAPTER = { name: "esm-trading-cs-api", version: "0.1.0", channel: "ESM" } as const;

/** ESM umbrella marketplaces — each customer connection may be on either or both. */
export type EsmMarketplace = "GMARKET" | "AUCTION";

/**
 * A REFERENCE to SellerOps's own ESM+ provider credential (Model B). `masterId` is the ESM+ Master ID used
 * as the JWT `kid` (an identifier, not a secret); `secretKeyRef` is an opaque handle to the Secret Key in the
 * vault. Never the secret itself; never logged, enveloped, or audited.
 */
export interface ProviderCredentialRef {
  provider: "ESM_TRADING_CS";
  masterId: string;
  secretKeyRef: string;
}

/**
 * One customer's ESM connection under SellerOps's provider credential — the tenant identity. Holds only
 * non-secret operational ids: the SellerOps `sellerId`/`connectionId` plus the optional per-marketplace
 * seller ids. Never a credential or token.
 */
export interface SellerConnection {
  sellerId: string;
  connectionId: string;
  channel: "ESM";
  /** Gmarket seller id for this customer, or null if not on Gmarket. */
  gmarketSellerId: string | null;
  /** Auction seller id for this customer, or null if not on Auction. */
  auctionSellerId: string | null;
}

/**
 * The ESM CS inquiry transport DTO — the OFFICIAL response fields, verbatim. `sellerId` is the ESM-side
 * marketplace seller id; `token` is the per-inquiry reply token; `details` is the body. Contains NO inquirer
 * PII (discarded upstream) and NO SellerOps-derived fields.
 */
export interface EsmCsInquiryRecord {
  qnaType: string;
  sellerId: string;
  messageNo: string;
  goodsNo: string;
  siteGoodsNo: string;
  orderNo: string | null;
  payNo: string | null;
  informStatus: string;
  receiveDate: string;
  answerDate: string | null;
  contractType: string;
  title: string;
  details: string;
  token: string;
  reAsking: boolean;
}

/** The raw CS response as received — the DTO fields PLUS inquirer PII that must be discarded at the boundary. */
export interface EsmCsRawInquiry extends EsmCsInquiryRecord {
  inquirerName?: string | null;
  inquirerPhone?: string | null;
}

/** Project a raw response to the transport DTO, DISCARDING inquirer PII (name/phone never enter the system). */
export function discardInquirerPii(raw: EsmCsRawInquiry): EsmCsInquiryRecord {
  const { inquirerName: _n, inquirerPhone: _p, ...dto } = raw;
  return dto;
}

/**
 * Three DISTINCT status concepts — do not conflate:
 *  - the response `informStatus` (on {@link EsmCsInquiryRecord}) is TEXT (`미처리` / `처리완료`);
 *  - the query `status` filter ({@link EsmCsQueryStatus}) is a NUMERIC enum sent when LISTING;
 *  - the reply `answerStatus` ({@link EsmCsReplyAnswerStatus}) is a NUMERIC enum sent when POSTING an answer.
 * The numeric enum values are the confirmed ESM CS codes.
 */
export type EsmCsQueryStatus = 1 | 2 | 3 | 4 | 5;
export type EsmCsReplyAnswerStatus = 1 | 2;

const QUERY_STATUS_VALUES: ReadonlySet<number> = new Set<EsmCsQueryStatus>([1, 2, 3, 4, 5]);
const REPLY_ANSWER_STATUS_VALUES: ReadonlySet<number> = new Set<EsmCsReplyAnswerStatus>([1, 2]);

export function isEsmCsQueryStatus(value: number): value is EsmCsQueryStatus {
  return QUERY_STATUS_VALUES.has(value);
}
export function isEsmCsReplyAnswerStatus(value: number): value is EsmCsReplyAnswerStatus {
  return REPLY_ANSWER_STATUS_VALUES.has(value);
}

export type QueryStatusCheck = { ok: true } | { ok: false; reason: "UNSUPPORTED_QUERY_STATUS" };
export type AnswerStatusCheck = { ok: true } | { ok: false; reason: "UNSUPPORTED_ANSWER_STATUS" };

/** Validation boundary: reject a query status outside the supported `1..5`. */
export function validateQueryStatus(value: number): QueryStatusCheck {
  return isEsmCsQueryStatus(value) ? { ok: true } : { ok: false, reason: "UNSUPPORTED_QUERY_STATUS" };
}

/** Validation boundary: reject a reply answer status outside the supported `1..2`. */
export function validateAnswerStatus(value: number): AnswerStatusCheck {
  return isEsmCsReplyAnswerStatus(value) ? { ok: true } : { ok: false, reason: "UNSUPPORTED_ANSWER_STATUS" };
}

/** The 7-day maximum ESM CS listing window (ms). A constant duration — not a wall-clock read. */
export const ESM_CS_QUERY_WINDOW_MAX_MS = 7 * 24 * 60 * 60 * 1000;

/** A caller-supplied listing window (epoch-ms bounds). */
export interface EsmCsQueryWindow {
  fromMs: number;
  toMs: number;
}

/** A listing query: the 7-day window + the numeric query `status` filter. */
export interface EsmCsListQuery {
  window: EsmCsQueryWindow;
  status: EsmCsQueryStatus;
}

export type QueryWindowCheck = { ok: true } | { ok: false; reason: "INVALID_WINDOW" | "WINDOW_TOO_LARGE" };

/** Enforce the 7-day query window: finite, ordered bounds spanning at most {@link ESM_CS_QUERY_WINDOW_MAX_MS}. */
export function validateQueryWindow(window: EsmCsQueryWindow): QueryWindowCheck {
  const { fromMs, toMs } = window;
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs < 0 || toMs < fromMs) return { ok: false, reason: "INVALID_WINDOW" };
  if (toMs - fromMs > ESM_CS_QUERY_WINDOW_MAX_MS) return { ok: false, reason: "WINDOW_TOO_LARGE" };
  return { ok: true };
}

// ── Answer contract (documentation + validation only; no HTTP/execution here) ──────────────────────

/** The ESM CS answer (reply POST) request contract. `token` comes from the reply-token store, never the envelope. */
export interface EsmCsAnswerRequest {
  messageNo: string;
  token: string;
  /** The reply's NUMERIC answer status enum (distinct from the query status and the response `informStatus`). */
  answerStatus: EsmCsReplyAnswerStatus;
  title: string;
  /** The answer body — bounded to {@link ESM_CS_ANSWER_MAX_BYTES} UTF-8 bytes. */
  comments: string;
}

/** The ESM CS answer body byte limit (UTF-8). */
export const ESM_CS_ANSWER_MAX_BYTES = 1000;

export type AnswerCommentsCheck = { ok: true } | { ok: false; reason: "EMPTY" | "TOO_LONG" };

/** Validate answer comments: non-empty and at most {@link ESM_CS_ANSWER_MAX_BYTES} UTF-8 bytes. */
export function validateAnswerComments(comments: string): AnswerCommentsCheck {
  if (comments.trim().length === 0) return { ok: false, reason: "EMPTY" };
  if (Buffer.byteLength(comments, "utf8") > ESM_CS_ANSWER_MAX_BYTES) return { ok: false, reason: "TOO_LONG" };
  return { ok: true };
}

/**
 * The ESM Trading CS API client seam — transport-agnostic. `listInquiries` scopes to ONE tenant
 * (`credential` + `connection`) over a bounded query (7-day window + numeric status filter); callers MUST
 * {@link validateQueryWindow} on `query.window` first, and the transport must apply {@link discardInquirerPii}
 * before returning DTOs. No HTTP lives here.
 */
export interface EsmTradingCsClient {
  listInquiries(credential: ProviderCredentialRef, connection: SellerConnection, query: EsmCsListQuery): Promise<EsmCsInquiryRecord[]>;
}
