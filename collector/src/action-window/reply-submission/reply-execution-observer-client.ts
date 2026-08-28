/**
 * **Reporting what the guided reply run OBSERVED** to the backend's execution record — never what it did to
 * the marketplace, because it did nothing to the marketplace.
 *
 * Two states, in order: `COMPOSER_FILLED` (the approved draft is in the composer the seller opened) and
 * `SELLER_SUBMISSION_OBSERVED` (the seller's own submit was seen on that composer). The backend keeps them on
 * `review_reply_execution` and never promotes either to `VERIFIED` — the seller may have edited the text, and
 * there is no read-back oracle here. Endpoint (lane A, 2026-08-28):
 * `POST /api/seller-accounts/{accountId}/attention/items/{actionRef}/reply/execution/observe`.
 *
 * Best-effort and one-way: a refused or unreachable report changes nothing about the run (the run's own
 * terminal is still what the operator reports through the existing outcome route). Logged as booleans.
 */
import { log } from "../../log";

type FetchImpl = typeof fetch;

export const REPLY_EXECUTION_OBSERVATIONS = ["COMPOSER_FILLED", "SELLER_SUBMISSION_OBSERVED"] as const;
export type ReplyExecutionObservation = (typeof REPLY_EXECUTION_OBSERVATIONS)[number];

export interface ReplyExecutionObservationRequest {
  readonly accountId: string;
  readonly actionRef: string;
  /** Idempotency key: one per (run, state). */
  readonly commandId: string;
  readonly submissionRef: string;
  readonly state: ReplyExecutionObservation;
}

export async function reportReplyExecutionObservation(
  baseUrl: string,
  token: string,
  request: ReplyExecutionObservationRequest,
  fetchImpl: FetchImpl = fetch,
): Promise<boolean> {
  const url =
    `${baseUrl}/api/seller-accounts/${encodeURIComponent(request.accountId)}` +
    `/attention/items/${encodeURIComponent(request.actionRef)}/reply/execution/observe`;
  let ok = false;
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ commandId: request.commandId, submissionRef: request.submissionRef, state: request.state }),
    });
    ok = res.ok;
    if (!ok) log("aw_reply_execution_observe_rejected", { state: request.state, httpStatus: res.status });
  } catch {
    log("aw_reply_execution_observe_rejected", { state: request.state, reason: "TRANSPORT" });
  }
  if (ok) log("aw_reply_execution_observed", { state: request.state });
  return ok;
}
