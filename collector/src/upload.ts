import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { log } from "./log";
import { rowCountBucket } from "./row-count-bucket";

/** Mirror of the backend `IngestResult` record (only the fields the collector reads). */
export interface IngestResult {
  syncJobId: string;
  uploadType: string;
  status: string;
  totalRows: number;
  successRows: number;
  skippedRows: number;
  failedRows: number;
  errorMessage?: string | null;
  sampleErrors?: unknown[];
}

export class UploadError extends Error {
  constructor(
    message: string,
    readonly stage: "login" | "resolveChannel" | "upload" | "itemAnalysis" | "startSubmissionRun" | "replyOutcome" | "replyDraft" | "reviewIdentity",
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "UploadError";
  }
}

type FetchImpl = typeof fetch;

/**
 * Source provenance for an upload, mirroring the backend `CollectionMethod` values that are
 * valid for the upload path. Omitting it leaves the backend default (`MANUAL_UPLOAD`); the
 * collector's capture paths pass `SELLER_CENTER_EXPORT` for files it exported itself.
 */
export type UploadMethod = "MANUAL_UPLOAD" | "SELLER_CENTER_EXPORT";

/**
 * Authenticate against the SellerOps backend and return a JWT. For the POC the
 * collector uses SellerOps dev credentials; the productized path replaces this
 * with a revocable collector/pairing token (separate slice). Either way, no NAVER
 * credential is ever involved.
 */
export async function login(
  baseUrl: string,
  email: string,
  password: string,
  fetchImpl: FetchImpl = fetch,
): Promise<string> {
  const res = await fetchImpl(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new UploadError("login failed", "login", res.status);
  const data = (await res.json()) as { token?: string };
  if (!data.token) throw new UploadError("login response missing token", "login", res.status);
  log("login.ok", { baseUrl });
  return data.token;
}

/** Resolve a channel code (e.g. "NAVER") to its channel id for this org. */
export async function resolveChannelId(
  baseUrl: string,
  token: string,
  code: string,
  fetchImpl: FetchImpl = fetch,
): Promise<string> {
  const res = await fetchImpl(`${baseUrl}/api/channels`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new UploadError("channels fetch failed", "resolveChannel", res.status);
  const channels = (await res.json()) as Array<{ id: string; code: string }>;
  const match = channels.find((c) => c.code === code);
  if (!match) throw new UploadError(`channel not found: ${code}`, "resolveChannel");
  log("channel.resolved", { code });
  return match.id;
}

/** The backend-derived, privacy-safe review target hint returned by the submission-run endpoint. */
export interface ReplyTargetHintResponse {
  rating: number;
  recencyBucket: string;
  bodyFingerprint: string;
}

/** Mirror of the backend `ReviewReplySubmissionRunResponse` (guided fields nullable). */
export interface SubmissionRunResponse {
  actionRef: string;
  submissionRef: string;
  approvedVersion: number | null;
  targetHint: ReplyTargetHintResponse | null;
  asOfDate: string | null;
}

/**
 * Start a guided reply-submission run over the authenticated backend (JWT bearer, loopback in dev). With
 * {@code requireTargetHint} the backend derives AND validates the review target hint BEFORE minting the
 * single-use submissionRef — a review that cannot produce a valid hint 409s and mints nothing. The response
 * carries the opaque submissionRef, the coarse hint, and the explicit KST {@code asOfDate}; never a review
 * body. Only non-secret path ids (accountId, actionRef) are sent; no review text ever crosses this call.
 */
export async function startReplySubmissionRun(
  baseUrl: string,
  token: string,
  accountId: string,
  actionRef: string,
  opts: { requireTargetHint: boolean },
  fetchImpl: FetchImpl = fetch,
): Promise<SubmissionRunResponse> {
  const url = `${baseUrl}/api/seller-accounts/${encodeURIComponent(accountId)}`
    + `/attention/items/${encodeURIComponent(actionRef)}/reply/submission-run`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ requireTargetHint: opts.requireTargetHint }),
  });
  if (!res.ok) throw new UploadError("submission-run failed", "startSubmissionRun", res.status);
  log("reply.submissionRun.ok", { requireTargetHint: opts.requireTargetHint });
  return (await res.json()) as SubmissionRunResponse;
}

/** The operator's own reply-outcome report (a LOCAL, UNVERIFIED fact — never a claim about NAVER). */
export interface ReplyOutcomeBody {
  /** Idempotency key: the same id + same outcome replays; a different outcome on the same id is refused (409). */
  commandId: string;
  /** The single-use submissionRef the run was bound to. */
  submissionRef: string;
  /** `SUBMISSION_ABORTED` (operator did not post) or `OPERATOR_REPORTED_SUBMITTED` (operator posted). */
  operatorOutcome: string;
  /** The Runtime-assigned opaque run id (`run_<hex>`). */
  awRunRef: string;
}

export interface ReplyOutcomeResult {
  actionRef: string;
  recorded: boolean;
  replayed: boolean;
}

/**
 * Record the operator's reply-submission outcome on the backend — a LOCAL, operator-reported, explicitly
 * UNVERIFIED fact (never a NAVER claim, never a completion). Idempotent by {@code commandId}: replaying the same
 * outcome returns 200 with {@code replayed:true}; a different outcome on the same id is refused (409). Only the
 * opaque submissionRef / run ref and the outcome enum cross this call — never any review text.
 */
export async function submitReplyOutcome(
  baseUrl: string,
  token: string,
  accountId: string,
  actionRef: string,
  body: ReplyOutcomeBody,
  fetchImpl: FetchImpl = fetch,
): Promise<ReplyOutcomeResult> {
  const url = `${baseUrl}/api/seller-accounts/${encodeURIComponent(accountId)}`
    + `/attention/items/${encodeURIComponent(actionRef)}/reply/outcome`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new UploadError("reply outcome failed", "replyOutcome", res.status);
  log("reply.outcome.ok", { operatorOutcome: body.operatorOutcome });
  return (await res.json()) as ReplyOutcomeResult;
}

/**
 * The operator's OWN approved reply draft — the text they authored and approved, shown to them read-only in
 * the SellerOps abort-rehearsal overlay so they can visually confirm what they would post before aborting.
 * This is the seller's own reply, NOT review PII: it deliberately carries only the draft body/version and a
 * standing-approval flag, and NEVER the review's `redactedBody` (which the source read also returns but this
 * client discards). The body is display-only; callers MUST NOT log it or put it on any wire.
 */
export interface ApprovedReplyDraft {
  /** The operator-authored approved reply body — display-only; never logged, never persisted. */
  draftBody: string | null;
  /** The approved draft's version, or null when no draft exists. */
  draftVersion: number | null;
  /** Whether a standing approval exists (the submission-run already requires one before minting). */
  approved: boolean;
}

/**
 * Read the current reply-preparation view for one review and return ONLY the approved draft text (+ version +
 * approval flag). The endpoint (`GET .../reply`) also returns the review's `redactedBody`; this client throws
 * it away and never surfaces it. Used solely to populate the read-only draft overlay in the abort rehearsal.
 * Only non-secret path ids (accountId, actionRef) are sent; the reply body that comes back is display-only and
 * is never logged (the success log records only presence flags, never any text).
 */
export async function fetchApprovedReplyDraft(
  baseUrl: string,
  token: string,
  accountId: string,
  actionRef: string,
  fetchImpl: FetchImpl = fetch,
): Promise<ApprovedReplyDraft> {
  const url = `${baseUrl}/api/seller-accounts/${encodeURIComponent(accountId)}`
    + `/attention/items/${encodeURIComponent(actionRef)}/reply`;
  const res = await fetchImpl(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new UploadError("reply prep fetch failed", "replyDraft", res.status);
  const view = (await res.json()) as {
    draft?: { version?: number; body?: string } | null;
    approval?: unknown;
  };
  const draftBody = typeof view.draft?.body === "string" ? view.draft.body : null;
  const draftVersion = typeof view.draft?.version === "number" ? view.draft.version : null;
  const approved = view.approval != null;
  // Presence flags only — NEVER the draft text, and never the review body it discarded.
  log("reply.draft.fetched", { hasDraft: draftBody != null, approved });
  return { draftBody, draftVersion, approved };
}

/**
 * The one-way identity fingerprint of a review's channel-side id (`review-id-fingerprint/v1`), read from the
 * SAME `GET .../reply` view. Deliberately its own tiny result type and its own reader, separate from
 * {@link ApprovedReplyDraft}: the identity path and the draft path have different purposes and different
 * safety properties, and neither should widen to carry the other's data.
 */
export interface ReviewIdentityFingerprint {
  /** 64-hex `review-id-fingerprint/v1` digest, or null when the review was ingested without a channel id. */
  channelReviewIdFingerprint: string | null;
  /** The coarse 1..5 rating — the secondary fact asserted AFTER an identity match. Null when unknown. */
  rating: number | null;
}

/**
 * Read the reply-preparation view for one review and return ONLY the channel review-id fingerprint. Everything
 * else the endpoint returns — the redacted review body, the draft text, the suggestion — is discarded here and
 * never surfaced. The backend never sends the raw channel id, so no raw identifier exists on this path at all;
 * the success log records presence only.
 */
export async function fetchReviewIdentityFingerprint(
  baseUrl: string,
  token: string,
  accountId: string,
  actionRef: string,
  fetchImpl: FetchImpl = fetch,
): Promise<ReviewIdentityFingerprint> {
  const url = `${baseUrl}/api/seller-accounts/${encodeURIComponent(accountId)}`
    + `/attention/items/${encodeURIComponent(actionRef)}/reply`;
  const res = await fetchImpl(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new UploadError("review identity fetch failed", "reviewIdentity", res.status);
  // A non-JSON body (a proxy error page, an HTML login redirect) must not surface as a SyntaxError whose
  // message quotes that body — the caller prints errors, and a body snippet is exactly what must not appear.
  let view: { channelReviewIdFingerprint?: unknown; rating?: unknown };
  try {
    view = (await res.json()) as { channelReviewIdFingerprint?: unknown; rating?: unknown };
  } catch {
    throw new UploadError("review identity response was not JSON", "reviewIdentity", res.status);
  }
  const raw = view.channelReviewIdFingerprint;
  // Fail closed on anything that is not a lowercase 64-hex digest — a malformed value must never be
  // treated as an identity, and must never be echoed back in a log line.
  const fingerprint = typeof raw === "string" && /^[0-9a-f]{64}$/.test(raw) ? raw : null;
  const rating =
    typeof view.rating === "number" && Number.isInteger(view.rating) && view.rating >= 1 && view.rating <= 5
      ? view.rating
      : null;
  log("reply.identity.fetched", { hasChannelReviewId: fingerprint != null, hasRating: rating != null });
  return { channelReviewIdFingerprint: fingerprint, rating };
}

/**
 * Count stored analyses for this org via `GET /api/item-analysis`. Used by the
 * gated integration test to assert item-analysis enrichment fired only for newly
 * inserted rows (delta after a fresh upload; no delta after a duplicate upload).
 */
export async function fetchItemAnalysisCount(
  baseUrl: string,
  token: string,
  fetchImpl: FetchImpl = fetch,
): Promise<number> {
  const res = await fetchImpl(`${baseUrl}/api/item-analysis`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new UploadError("item-analysis fetch failed", "itemAnalysis", res.status);
  const rows = (await res.json()) as unknown[];
  // Bucketed in the log (§4.3 — never an exact count); the exact count is still RETURNED to the caller.
  log("item-analysis.count", { countBucket: rowCountBucket(rows.length) });
  return rows.length;
}

/**
 * Upload in-memory review bytes to the existing `/api/uploads` endpoint as a
 * REVIEW file, under an explicit `filename`. The backend runs the existing
 * ReviewRowMapper → dedup → item-analysis; re-uploading the same rows is
 * idempotent (리뷰글번호 dedup).
 *
 * This is the single place that composes the multipart `filename` on the wire.
 * Callers that must not leak a platform-supplied name (e.g. the Action Window
 * ingest handoff) pass an opaque, caller-controlled `filename` here; the bytes
 * never carry a name of their own.
 *
 * When `method` is supplied it is sent as the source provenance (the collector's
 * capture paths pass `SELLER_CENTER_EXPORT`); omitting it preserves the original
 * wire shape, so the backend records the default `MANUAL_UPLOAD`.
 */
export async function uploadReviewBytes(
  baseUrl: string,
  token: string,
  channelId: string,
  bytes: Uint8Array,
  filename: string,
  fetchImpl: FetchImpl = fetch,
  method?: UploadMethod,
): Promise<IngestResult> {
  const form = new FormData();
  form.append("channelId", channelId);
  form.append("uploadType", "REVIEW");
  if (method !== undefined) form.append("method", method);
  form.append("file", new Blob([new Uint8Array(bytes)]), filename);

  const res = await fetchImpl(`${baseUrl}/api/uploads`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) throw new UploadError("upload failed", "upload", res.status);
  const result = (await res.json()) as IngestResult;
  // Sanitized per §4.3: coarse buckets, never the exact counts, and never the `filename` — it is opaque
  // only on the Action Window path (`aw-<ref>.xlsx`); `uploadReviewFile` passes a real export basename,
  // which can carry store/date identity. The exact counts are still RETURNED to the caller, which folds
  // them itself (`sanitizeBackendIngest` → `{ ok, processed }`, `sanitizeIngest` → buckets).
  log("upload.done", {
    status: result.status,
    totalRowsBucket: rowCountBucket(result.totalRows),
    successRowsBucket: rowCountBucket(result.successRows),
    skippedRowsBucket: rowCountBucket(result.skippedRows),
    failedRowsBucket: rowCountBucket(result.failedRows),
  });
  return result;
}

/**
 * Upload a captured review export FILE to the existing `/api/uploads` endpoint as
 * a REVIEW file. Thin wrapper over {@link uploadReviewBytes} that reads the file
 * and sends its `basename` as the wire filename. See `uploadReviewBytes` for the
 * dedup/idempotency and `method` provenance semantics.
 */
export async function uploadReviewFile(
  baseUrl: string,
  token: string,
  channelId: string,
  filePath: string,
  fetchImpl: FetchImpl = fetch,
  method?: UploadMethod,
): Promise<IngestResult> {
  const bytes = await readFile(filePath);
  return uploadReviewBytes(baseUrl, token, channelId, new Uint8Array(bytes), basename(filePath), fetchImpl, method);
}
