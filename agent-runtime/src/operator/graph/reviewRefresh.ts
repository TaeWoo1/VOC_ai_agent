/**
 * The refresh SEAM the review rows path may call — an interface only, so the graph never imports the
 * one file that reaches the backend's collection endpoint (`conversation/Refresher.ts`).
 *
 * <b>Why a seam and not a tool.</b> A refresh is a READ of a channel the seller already connected
 * (`CollectControlService.manualSync`), but it STARTS a collection run, and a collection trigger is
 * on the privileged plane the Operator's catalogue deliberately does not hold
 * (`privilegedPlaneFence.test.ts`). So it is not selectable by a plan: the rows path calls it only
 * when a deterministic decision table says the channel's acquisition is AUTOMATIC and its rows are
 * stale for THIS question, once per channel, with the outcome said honestly either way.
 */
export type RefreshFailure =
  /** The backend refused because a run is already in flight (single-flight) — the rows will be current soon. */
  | "IN_PROGRESS"
  /** The channel's rate budget for this window is spent. */
  | "RATE_LIMITED"
  /** The connector is off or the account cannot be read (fail-closed deployment posture). */
  | "CONNECTOR_UNAVAILABLE"
  /** The run itself finished FAILED. */
  | "RUN_FAILED"
  /** The client has no refresh method (a backend predating the endpoint) or an unclassified error. */
  | "UNAVAILABLE";

export type RefreshOutcome =
  | { readonly ok: true; readonly finishedAt: string; readonly successRows: number | null; readonly status: string; readonly partial: boolean }
  | { readonly ok: false; readonly failure: RefreshFailure };

export interface ReviewRefresher {
  /** One bounded attempt. Never retries; a thrown error is classified, never rethrown. */
  refresh(accountId: string, dataType: "REVIEW"): Promise<RefreshOutcome>;
}

/** Seller-facing, closed. The reason class travels as a word the seller can act on, never as a vendor message. */
export const REFRESH_FAILURE_LABEL: Record<RefreshFailure, string> = {
  IN_PROGRESS: "이미 수집이 진행 중입니다",
  RATE_LIMITED: "이 시간대의 수집 한도에 도달했습니다",
  CONNECTOR_UNAVAILABLE: "채널 연결을 지금 사용할 수 없습니다",
  RUN_FAILED: "수집이 실패했습니다",
  UNAVAILABLE: "지금은 새로 가져올 수 없습니다",
};
