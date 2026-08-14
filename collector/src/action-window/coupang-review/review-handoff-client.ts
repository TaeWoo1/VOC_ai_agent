/**
 * **The wire half of the review handoff** — one POST, to one endpoint, over the loopback backend.
 *
 * A separate module from the walk that calls it, for the reason the credential handoff client is separate: the
 * walk can then be tested with no network at all, and the one function in this package that puts review bodies
 * on a socket is this one, by itself, short enough to read in full.
 *
 * **What it must never do, and does not:** log a review body, log a response body, echo a review into an error
 * message, or read a value out of a failed response. A rejected handoff is diagnosed by its HTTP status and
 * nothing else — a 4xx from this endpoint is one of the backend's own safe reason constants, and reading the
 * body here would make this function a place where review text and a response body coexist.
 *
 * **A retry is safe here, and is still not performed.** Unlike a credential, every review de-duplicates on its
 * content, so a repeated POST stores nothing twice. The reason there is no retry is different: a second POST
 * whose first one actually succeeded would double the run's reported `received`, and a walk that cannot say how
 * much it handed over is the thing this whole design is built to avoid. The operator re-runs instead.
 */
import { log } from "../../log";
import type { CoupangAcquiredReview } from "./review-rows";

type FetchImpl = typeof fetch;

/** What the backend said it did. Counts only; it returns no review and no row identity. */
export interface ReviewHandoffResponse {
  readonly ok: boolean;
  readonly received: number;
  readonly stored: number;
  readonly skipped: number;
  readonly failed: number;
  /** `HTTP_<status>` when the backend refused. Null on success. */
  readonly reason: string | null;
}

/** A network failure, carrying no body and no review. The HTTP status is the whole diagnosis it offers. */
export class ReviewHandoffTransportError extends Error {
  constructor(readonly httpStatus?: number) {
    super(httpStatus === undefined ? "review handoff transport failed" : `review handoff failed (${httpStatus})`);
    this.name = "ReviewHandoffTransportError";
  }
}

/**
 * The wire row. It is built here rather than sent as the canonical record so the SHAPE of what crosses is
 * visible in one place — and so that adding a field to the canonical record does not silently start
 * transmitting it. `bodyFingerprint` deliberately does NOT travel: the backend recomputes it from the body it
 * stored, and a fingerprint the agent asserted would be a second source of truth for the locate target.
 */
function wireRow(review: CoupangAcquiredReview): Record<string, unknown> {
  return {
    writtenOn: review.writtenOn,
    rating: review.rating,
    body: review.body,
    productId: review.productId,
    vendorItemId: review.vendorItemId,
    productName: review.productName,
    mediaCount: review.mediaCount,
    bodyTruncated: review.bodyTruncated,
  };
}

export interface ReviewHandoffRequest {
  readonly accountSlot: string;
  readonly channelCode: string;
  /** The walk's coverage CLAIM — true only when the pager showed the last page. Never inferred downstream. */
  readonly complete: boolean;
  readonly stopReason: string;
  readonly reviews: readonly CoupangAcquiredReview[];
}

/**
 * Hand the acquired reviews to the backend, which resolves the opaque slot, guards the channel, and stores
 * them through the ingestion spine where identical reviews de-duplicate.
 *
 * An HTTP error is RETURNED as a non-stored result carrying only the status, rather than thrown: the caller
 * has to record a value-free outcome either way, and a thrown `fetch`/JSON error is the classic route by which
 * a response body reaches a log line. A transport failure — no response at all — throws
 * {@link ReviewHandoffTransportError}, which carries nothing.
 */
export async function postCoupangReviewHandoff(
  baseUrl: string,
  token: string,
  request: ReviewHandoffRequest,
  fetchImpl: FetchImpl = fetch,
): Promise<ReviewHandoffResponse> {
  const received = request.reviews.length;
  let res: Response;
  try {
    res = await fetchImpl(`${baseUrl}/api/agent/review-handoff`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        accountSlot: request.accountSlot,
        channelCode: request.channelCode,
        complete: request.complete,
        stopReason: request.stopReason,
        reviews: request.reviews.map(wireRow),
      }),
    });
  } catch {
    // The caught error is not inspected: a fetch failure can quote the request it failed on, and this request
    // is a page of what customers wrote.
    throw new ReviewHandoffTransportError();
  }
  if (!res.ok) {
    log("aw_coupang_review_handoff_rejected", { httpStatus: res.status, received });
    return { ok: false, received, stored: 0, skipped: 0, failed: 0, reason: `HTTP_${res.status}` };
  }
  let body: { received?: unknown; stored?: unknown; skipped?: unknown; failed?: unknown };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    // A non-JSON 200 (a proxy page, an HTML redirect) must not surface as a SyntaxError whose message quotes
    // that page — and it cannot be read as a successful store. Fail closed.
    log("aw_coupang_review_handoff_rejected", { httpStatus: res.status, received, reason: "MALFORMED_RESPONSE" });
    return { ok: false, received, stored: 0, skipped: 0, failed: 0, reason: "MALFORMED_RESPONSE" };
  }
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  const result: ReviewHandoffResponse = {
    ok: true,
    received: num(body.received),
    stored: num(body.stored),
    skipped: num(body.skipped),
    failed: num(body.failed),
    reason: null,
  };
  log("aw_coupang_review_handoff", {
    received: result.received,
    stored: result.stored,
    skipped: result.skipped,
    failed: result.failed,
  });
  return result;
}
