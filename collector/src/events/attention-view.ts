/**
 * Top-N attention view assembler (offline, deterministic, sanitized).
 *
 * `attentionView(events, opts?)` produces the first UI/report-consumable "what needs
 * attention today" payload by combining two existing pure layers:
 *   - `attentionDigest(events)`   — batch rollup over ALL events
 *   - `prioritizeEvents(events)`  — sanitized ranked rows
 * and slicing the ranked rows to a normalized top-N limit.
 *
 * It adds NO new scoring logic, NO AI, NO dedup/clustering, and NO timestamp of its own.
 * It may forward an explicit caller `referenceTimeMs` to BOTH `prioritizeEvents` (so the
 * priority score can apply its capped recency tie-breaker, Phase 3) and `attentionDigest`
 * (so the recency histogram and the rows' coarse `recencyBucket` reflect the same
 * reference, Phase 4) — this is a caller input, never a wall-clock read, and the view adds
 * no `generatedAt`. The surfaced `recencyBucket` (row field) and `byRecency` (digest) are
 * display only: coarse buckets that do NOT change ordering. The output is fully sanitized
 * (digest counts + sanitized `PrioritizedEvent` rows) — never raw events, refs, content,
 * exact amounts/counts, identity, exact timestamps, or internal `eventTimeMs`. No I/O, no
 * network, no fs, no browser, no env, no current-time read.
 */

import { attentionDigest } from "./attention-digest";
import type { AttentionDigest } from "./attention-digest";
import { prioritizeEvents } from "./prioritize-events";
import type { PrioritizedEvent } from "./prioritize-events";
import type { SellerOpsEvent } from "./types";

export interface AttentionViewOptions {
  limit?: number;
  /**
   * Explicit caller reference time (epoch ms) for recency scoring — never the wall
   * clock. Forwarded to `prioritizeEvents` → `priorityScoreFor`. Omitted → recency
   * contributes `+0` and ordering is identical to the pre-recency behavior.
   */
  referenceTimeMs?: number;
}

export interface AttentionView {
  totalEvents: number;
  totalRankedEvents: number;
  limit: number;
  truncated: boolean;
  digest: AttentionDigest;
  top: PrioritizedEvent[];
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

/**
 * Normalize a requested limit deterministically: default 10 when absent/non-finite;
 * floor decimals; clamp to [0, 50]. Never throws.
 */
function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  const floored = Math.floor(limit);
  if (floored < 0) return 0;
  if (floored > MAX_LIMIT) return MAX_LIMIT;
  return floored;
}

/**
 * Assemble the attention view. The digest summarizes ALL events; `top` is the ranked
 * rows sliced to the normalized limit. Deterministic and pure. Empty input → empty
 * digest + `top: []`.
 */
export function attentionView(
  events: SellerOpsEvent[],
  opts?: AttentionViewOptions,
): AttentionView {
  const limit = normalizeLimit(opts?.limit);
  // Forward the explicit reference time to BOTH layers so the digest's coarse recency
  // histogram and the ranked rows' `recencyBucket` reflect the same caller reference time
  // (display only — ordering is unchanged). Omitted → recency is `"unknown"` everywhere.
  const digest = attentionDigest(events, { referenceTimeMs: opts?.referenceTimeMs });
  const ranked = prioritizeEvents(events, { referenceTimeMs: opts?.referenceTimeMs });
  return {
    totalEvents: events.length,
    totalRankedEvents: ranked.length,
    limit,
    truncated: ranked.length > limit,
    digest,
    top: ranked.slice(0, limit),
  };
}
