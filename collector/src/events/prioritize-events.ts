/**
 * Batch ranking over a list of `SellerOpsEvent` (offline, deterministic, sanitized).
 *
 * `prioritizeEvents(events)` scores each event with `priorityScoreFor` and returns a
 * ranked list of SANITIZED rows — the raw event object is never returned. Each row
 * carries only the input index, the coarse `kind`/`platform`/`channel` from the
 * sanitized summary, and the priority explanation (score/band/signals/reason codes).
 *
 * Deterministic: sort by score descending, then `inputIndex` ascending as a stable
 * tie-breaker — no hidden product judgment, no randomness. Recency (Phase 3) is applied
 * inside `priorityScoreFor` ONLY from an explicit, batch-wide `referenceTimeMs` passed
 * by the caller; without it, scoring and ordering are identical to the pre-recency
 * behavior. This slice is ranking only: NO deduplication, NO clustering, NO AI. No I/O,
 * no network, no fs, no browser, no env, no current-time read.
 */

import type { PriorityScoreExplanation } from "./priority-score";
import { priorityScoreFor } from "./priority-score";
import type { SanitizedSummaryOptions } from "./recency-bucket";
import { sanitizedSummaryFor } from "./sanitized-summary";
import type { SellerOpsEvent, SellerOpsEventKind } from "./types";

/**
 * One ranked row. Sanitized by construction — it holds the input index, coarse
 * kind/platform/channel, and the priority explanation. It never holds the raw event,
 * reference codes, raw content, exact amounts/counts, or identity.
 */
export interface PrioritizedEvent {
  inputIndex: number;
  kind: SellerOpsEventKind;
  platform: string;
  channel: string;
  priority: PriorityScoreExplanation;
}

/**
 * Rank a batch of events by priority. Pure and deterministic: same input + same
 * `opts.referenceTimeMs` → same order. Empty input → `[]`. Sort is score descending with
 * `inputIndex` ascending as the stable tie-breaker (equal scores keep their original
 * relative order).
 *
 * `opts.referenceTimeMs` (explicit, never the wall clock) is a SINGLE batch-wide
 * reference time forwarded to every event's `priorityScoreFor`, so recency cannot make
 * ordering non-deterministic. Omitted → recency contributes `+0` everywhere and the
 * ranking is identical to the pre-recency behavior.
 */
export function prioritizeEvents(
  events: SellerOpsEvent[],
  opts: SanitizedSummaryOptions = {},
): PrioritizedEvent[] {
  const rows: PrioritizedEvent[] = events.map((event, inputIndex) => {
    // Row metadata (kind/platform/channel) does not depend on recency; only the score
    // does, so only `priorityScoreFor` receives the reference time.
    const summary = sanitizedSummaryFor(event);
    return {
      inputIndex,
      kind: summary.kind,
      platform: summary.platform,
      channel: summary.channel,
      priority: priorityScoreFor(event, opts),
    };
  });

  return rows.sort((a, b) => {
    if (b.priority.score !== a.priority.score) {
      return b.priority.score - a.priority.score; // score descending
    }
    return a.inputIndex - b.inputIndex; // stable tie-breaker: input order
  });
}
