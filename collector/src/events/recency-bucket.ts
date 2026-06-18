/**
 * Phase 1 of the recency model: a pure coarse-recency helper (offline, deterministic).
 *
 * `recencyBucketFor(eventTimeMs, referenceTimeMs)` maps an event time + an explicit
 * caller-provided reference time to a coarse `RecencyBucket`. It is a pure function of
 * its two epoch-millisecond inputs — it NEVER reads the wall clock (`Date.now`,
 * `new Date`), parses date strings, or accepts `Date` objects, so the codebase-wide
 * "no current-time read in source" rule holds. Missing / non-finite / future inputs
 * map to `unknown`. Output is only the coarse bucket — never an exact timestamp,
 * elapsed duration, raw date string, or timezone.
 *
 * This slice is the helper ONLY. It is not wired into normalizers, sanitized
 * summaries, `priorityScoreFor`, `prioritizeEvents`, or `attentionView` (Phases 2–4,
 * deferred — see recency-bucket-model.md). No I/O, no imports.
 */

export type RecencyBucket =
  | "fresh_0_2h"
  | "same_day_2_24h"
  | "recent_1_3d"
  | "aging_3_7d"
  | "stale_over_7d"
  | "unknown";

/**
 * Options for sanitized-summary builders that can surface a coarse `recencyBucket`.
 * `referenceTimeMs` is an EXPLICIT caller-provided reference (epoch ms) — the library
 * never reads the wall clock. Omitted / non-finite → recency `"unknown"`.
 */
export interface SanitizedSummaryOptions {
  referenceTimeMs?: number;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Coarse recency bucket from two epoch-millisecond inputs. Pure and deterministic.
 *
 * `eventTimeMs` null/undefined/non-finite → `unknown`; `referenceTimeMs` non-finite →
 * `unknown`; a future event (`eventTimeMs > referenceTimeMs`) → `unknown`. Otherwise
 * bucket by `age = referenceTimeMs - eventTimeMs`:
 *   [0, 2h) fresh · [2h, 24h) same_day · [24h, 3d) recent · [3d, 7d) aging · [7d, ∞) stale.
 */
export function recencyBucketFor(
  eventTimeMs: number | null | undefined,
  referenceTimeMs: number,
): RecencyBucket {
  if (eventTimeMs === null || eventTimeMs === undefined || !Number.isFinite(eventTimeMs)) {
    return "unknown";
  }
  if (!Number.isFinite(referenceTimeMs)) {
    return "unknown";
  }
  if (eventTimeMs > referenceTimeMs) {
    return "unknown";
  }

  const ageMs = referenceTimeMs - eventTimeMs;

  if (ageMs < 2 * HOUR_MS) return "fresh_0_2h";
  if (ageMs < 24 * HOUR_MS) return "same_day_2_24h";
  if (ageMs < 3 * DAY_MS) return "recent_1_3d";
  if (ageMs < 7 * DAY_MS) return "aging_3_7d";
  return "stale_over_7d";
}
