/**
 * The one place in the runtime that reaches `POST /api/seller-accounts/{accountId}/sync`
 * (`CollectControlService.manualSync`) — the product's own one-press collection, invoked for the
 * seller when the AUTOMATIC-acquisition channel's rows are stale for the question they asked.
 *
 * <b>Bounded, once, honest.</b> One attempt per call; a `409` (single-flight — a run is already in
 * flight), a `429` (rate budget), a `5xx`/`501`/`503` (connector off) and a FAILED run are each a
 * closed reason class the answer states beside the stale rows. Nothing is retried and nothing is
 * pretended: a failed refresh leaves the freshness verdict where it was.
 *
 * <b>Outside the READ registry on purpose.</b> `conversationWriteFence.test.ts` pins `manualSync` to
 * this file and this file alone; `privilegedPlaneFence.test.ts` keeps every collection trigger out
 * of the Operator's catalogue. The conversation service constructs this and hands it to the run as a
 * seam the rows path may call — the planner never sees it.
 */
import type { SpringClient } from "../spring/SpringClient";
import { SpringApiError } from "../spring/SpringClient";
import type { RefreshFailure, RefreshOutcome, ReviewRefresher } from "../operator/graph/reviewRefresh";
import { log } from "../log";

export class Refresher implements ReviewRefresher {
  constructor(private readonly client: Pick<SpringClient, "manualSync">) {}

  async refresh(accountId: string, dataType: "REVIEW"): Promise<RefreshOutcome> {
    const started = Date.now();
    if (typeof this.client.manualSync !== "function") {
      log("conversation_refresh", { dataType, ok: false, failure: "UNAVAILABLE", ms: 0 });
      return { ok: false, failure: "UNAVAILABLE" };
    }
    try {
      const run = await this.client.manualSync(accountId, { dataType });
      const status = (run.status ?? "").toUpperCase();
      if (status === "FAILED") {
        log("conversation_refresh", { dataType, ok: false, failure: "RUN_FAILED", ms: Date.now() - started });
        return { ok: false, failure: "RUN_FAILED" };
      }
      if (status === "RUNNING" || status === "QUEUED" || status === "PENDING") {
        // Single-flight coalesced this call onto a run already in progress, or the run has not started: the
        // rows are not yet current, and a collection that has not finished is not a collection.
        log("conversation_refresh", { dataType, ok: false, failure: "IN_PROGRESS", ms: Date.now() - started });
        return { ok: false, failure: "IN_PROGRESS" };
      }
      if ((status !== "SUCCESS" && status !== "PARTIAL") || run.finishedAt == null) {
        // Acceptance Closure §8-A: only a TERMINAL result that supports the observation may count. An
        // unknown status word, or a "finished" run with no finish time, is not evidence of anything.
        log("conversation_refresh", { dataType, ok: false, failure: "UNAVAILABLE", status, ms: Date.now() - started });
        return { ok: false, failure: "UNAVAILABLE" };
      }
      const partial = status === "PARTIAL";
      log("conversation_refresh", { dataType, ok: true, status, partial, successRows: run.successRows ?? null, ms: Date.now() - started });
      return { ok: true, finishedAt: run.finishedAt, successRows: run.successRows ?? null, status, partial };
    } catch (err) {
      const failure = classify(err);
      log("conversation_refresh", { dataType, ok: false, failure, status: err instanceof SpringApiError ? err.status : null, ms: Date.now() - started });
      return { ok: false, failure };
    }
  }
}

function classify(err: unknown): RefreshFailure {
  if (!(err instanceof SpringApiError)) return "UNAVAILABLE";
  if (err.status === 409) return "IN_PROGRESS";
  if (err.status === 429) return "RATE_LIMITED";
  if (err.status === 501 || err.status === 503 || err.status === 502 || err.status === 500 || err.status === 403) return "CONNECTOR_UNAVAILABLE";
  return "UNAVAILABLE";
}
