/**
 * Top-N attention view assembler (offline, deterministic, sanitized).
 *
 * `attentionView(events, opts?)` produces the first UI/report-consumable "what needs
 * attention today" payload by combining two existing pure layers:
 *   - `attentionDigest(events)`   — batch rollup over ALL events
 *   - `prioritizeEvents(events)`  — sanitized ranked rows
 * and slicing the ranked rows to a normalized top-N limit.
 *
 * It adds NO new scoring logic, NO AI, NO recency/dedup/clustering, and NO timestamp.
 * The output is fully sanitized (it only carries the digest counts + sanitized
 * `PrioritizedEvent` rows) — never raw events, refs, content, exact amounts/counts,
 * or identity. No I/O, no network, no fs, no browser, no env, no current-time read.
 */

import { attentionDigest } from "./attention-digest";
import type { AttentionDigest } from "./attention-digest";
import { prioritizeEvents } from "./prioritize-events";
import type { PrioritizedEvent } from "./prioritize-events";
import type { SellerOpsEvent } from "./types";

export interface AttentionViewOptions {
  limit?: number;
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
  const digest = attentionDigest(events);
  const ranked = prioritizeEvents(events);
  return {
    totalEvents: events.length,
    totalRankedEvents: ranked.length,
    limit,
    truncated: ranked.length > limit,
    digest,
    top: ranked.slice(0, limit),
  };
}
