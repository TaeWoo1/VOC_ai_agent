/**
 * **Turning a `submissionRef` into what a guided reply run needs** — one POST, to one endpoint, over the
 * loopback backend, under the agent's OWN session.
 *
 * The resident `reply`/`naver` carrier receives ONLY the opaque `submissionRef` on `START_RUN` (the tab minted
 * it via `POST …/reply/submission-run`, and the v2 wire carries nothing else). Everything the run then needs —
 * which account and action it belongs to, the privacy-safe target hint, the KST as-of date the hint's recency
 * bucket was computed against, the review-id fingerprint, and the approved draft — must therefore be resolved
 * here, by the agent, and never by the browser.
 *
 * The endpoint is the reply-side sibling of `POST /api/agent/review-locate-targets` and
 * `/review-acquisition-targets`: `POST /api/agent/reply-submission-targets { submissionRef }`. Until the backend
 * serves it, every resolve is `null` and the run ends before a page is touched — the honest ending for a
 * binding nobody can resolve, and the same one a spent or expired ref gets.
 *
 * Every refusal is `null`; a failed response body is never read; nothing about the review is logged.
 */
import { log } from "../../log";
import type { RecencyBucket, ReplyTargetHint } from "./reply-surface";

type FetchImpl = typeof fetch;

const HEX16 = /^[0-9a-f]{16}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const KST_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RECENCY_BUCKETS: readonly RecencyBucket[] = ["TODAY", "THIS_WEEK", "OLDER"];

export interface ReplySubmissionTarget {
  readonly accountId: string;
  readonly actionRef: string;
  readonly hint: ReplyTargetHint;
  readonly asOfDate: string;
  /** SHA-256 of the channel review id, when the backend holds one. */
  readonly channelReviewIdFingerprint: string | null;
  /** The approved draft, byte for byte. Held by the driver factory; never logged, emitted, or persisted. */
  readonly draftBody: string;
  readonly draftVersion: number | null;
}

export async function fetchReplySubmissionTarget(
  baseUrl: string,
  token: string,
  submissionRef: string,
  fetchImpl: FetchImpl = fetch,
): Promise<ReplySubmissionTarget | null> {
  if (!HEX16.test(submissionRef)) {
    log("aw_reply_submission_target_refused", { reason: "MALFORMED_REF" });
    return null;
  }
  let res: Response;
  try {
    res = await fetchImpl(`${baseUrl}/api/agent/reply-submission-targets`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ submissionRef }),
    });
  } catch {
    log("aw_reply_submission_target_refused", { reason: "TRANSPORT" });
    return null;
  }
  if (!res.ok) {
    log("aw_reply_submission_target_refused", { httpStatus: res.status });
    return null;
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    log("aw_reply_submission_target_refused", { reason: "MALFORMED_RESPONSE" });
    return null;
  }
  const target = parseReplySubmissionTarget(body);
  // Presence flags only.
  log("aw_reply_submission_target", { resolved: target !== null, hasReviewId: target?.channelReviewIdFingerprint != null });
  return target;
}

/** The wire shape, checked field by field. Anything off-shape is a refusal, never a partial target. */
export function parseReplySubmissionTarget(body: unknown): ReplySubmissionTarget | null {
  if (typeof body !== "object" || body === null) return null;
  const r = body as Record<string, unknown>;
  if (typeof r.accountId !== "string" || r.accountId.length === 0 || r.accountId.length > 64) return null;
  if (typeof r.actionRef !== "string" || r.actionRef.length === 0 || r.actionRef.length > 256) return null;
  const hint = r.targetHint as Record<string, unknown> | null | undefined;
  if (typeof hint !== "object" || hint === null) return null;
  const rating = hint.rating;
  if (!Number.isInteger(rating) || (rating as number) < 1 || (rating as number) > 5) return null;
  if (typeof hint.recencyBucket !== "string" || !RECENCY_BUCKETS.includes(hint.recencyBucket as RecencyBucket)) return null;
  if (typeof hint.bodyFingerprint !== "string" || hint.bodyFingerprint.length === 0 || hint.bodyFingerprint.length > 128) return null;
  if (typeof r.asOfDate !== "string" || !KST_DATE.test(r.asOfDate)) return null;
  const fp = r.channelReviewIdFingerprint;
  if (fp !== null && fp !== undefined && !(typeof fp === "string" && HEX64.test(fp))) return null;
  if (typeof r.draftBody !== "string" || r.draftBody.length === 0) return null;
  const version = r.draftVersion;
  if (version !== null && version !== undefined && !Number.isInteger(version)) return null;
  return {
    accountId: r.accountId,
    actionRef: r.actionRef,
    hint: { rating: rating as number, recencyBucket: hint.recencyBucket as RecencyBucket, bodyFingerprint: hint.bodyFingerprint },
    asOfDate: r.asOfDate,
    channelReviewIdFingerprint: typeof fp === "string" ? fp : null,
    draftBody: r.draftBody,
    draftVersion: typeof version === "number" ? version : null,
  };
}
