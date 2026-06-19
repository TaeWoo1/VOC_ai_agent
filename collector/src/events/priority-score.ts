/**
 * Single-event priority score (offline, deterministic, AI-free).
 *
 * `priorityScoreFor(event)` answers "how much should the seller look at THIS event?"
 * by combining the event's deterministic attention signals (severity weights +
 * co-occurrence bonus + a coarse high-sales bonus) into a typed, self-explaining
 * score. It reads ONLY `attentionSignalsFor` (which reads only sanitized summaries),
 * so it cannot leak raw content, reference codes, exact amounts/counts, or identity.
 *
 * This slice is single-event only. There is NO `prioritizeEvents` / ranking here, and
 * NO dedup / cluster / AI factor (deferred — see priority-score-model.md). Recency is a
 * small, capped, secondary tie-breaker (Phase 3 — see recency-scoring-policy.md): it is
 * applied ONLY from an explicit caller `referenceTimeMs`, never from a wall-clock read.
 * No I/O, no network, no fs, no browser, no env, no current-time read.
 */

import type {
  AttentionSignalCode,
  AttentionSignalSeverity,
} from "./attention-signals";
import { attentionSignalsFor } from "./attention-signals";
import type { RecencyBucket, SanitizedSummaryOptions } from "./recency-bucket";
import { sanitizedSummaryFor } from "./sanitized-summary";
import type { SellerOpsEvent } from "./types";

export type PriorityBand = "low" | "medium" | "high" | "urgent";

/**
 * A priority score with its audit trail. `signals` are the contributing signal codes;
 * `explanationCodes` are fixed strings naming which weights/bonuses applied. Neither
 * carries raw content, refs, amounts, or identity.
 */
export interface PriorityScoreExplanation {
  score: number;
  band: PriorityBand;
  signals: AttentionSignalCode[];
  explanationCodes: string[];
}

/** Base weight per signal severity. */
const SEVERITY_WEIGHTS: Record<AttentionSignalSeverity, number> = {
  high: 70,
  medium: 40,
  low: 10,
};

/** Co-occurrence bonus thresholds (high/medium signals on the same event). */
const COOCCURRENCE_BONUS_2 = 10;
const COOCCURRENCE_BONUS_3 = 20;

/** Coarse high-sales-context bonus (derived from the `amountBucket`-based signal only). */
const HIGH_SALES_CONTEXT_BONUS = 15;

/**
 * Recency contribution per coarse `recencyBucket` (Phase 3 — see recency-scoring-policy.md).
 * A small, capped (+8 max) SECONDARY tie-breaker — well below a single high-severity
 * signal (70), so it nudges ordering among similar-severity events but can never overcome
 * a severity band gap. No negative penalty; `unknown`/aging/stale → `+0` (missing/old
 * timestamps are never punished). Derived only from the coarse bucket — never the exact
 * time or elapsed duration.
 */
const RECENCY_BUCKET_POINTS: Record<RecencyBucket, number> = {
  fresh_0_2h: 8,
  same_day_2_24h: 5,
  recent_1_3d: 2,
  aging_3_7d: 0,
  stale_over_7d: 0,
  unknown: 0,
};

/** Band thresholds (draft, per the spec). */
const BAND_URGENT = 100;
const BAND_HIGH = 70;
const BAND_MEDIUM = 40;

function bandFor(score: number): PriorityBand {
  if (score >= BAND_URGENT) return "urgent";
  if (score >= BAND_HIGH) return "high";
  if (score >= BAND_MEDIUM) return "medium";
  return "low";
}

/** The coarse recency bucket of an event, from an explicit reference time. Missing
 * bucket field (`sales_context`) or no reference time → `"unknown"`. */
function recencyBucketOf(event: SellerOpsEvent, opts: SanitizedSummaryOptions): RecencyBucket {
  const summary = sanitizedSummaryFor(event, opts);
  return "recencyBucket" in summary ? summary.recencyBucket : "unknown";
}

/**
 * Compute the priority score + explanation for a single event. Deterministic: the same
 * event + same `opts.referenceTimeMs` yields the same result every call (no wall-clock,
 * no randomness, no external state).
 *
 * `opts.referenceTimeMs` (explicit, never the wall clock) enables a small capped recency
 * contribution (Phase 3). Omitted → recency resolves to `unknown` → `+0`, so the score,
 * band, and explanation are identical to the pre-recency behavior.
 */
export function priorityScoreFor(
  event: SellerOpsEvent,
  opts: SanitizedSummaryOptions = {},
): PriorityScoreExplanation {
  const signals = attentionSignalsFor(event);
  const codes = signals.map((s) => s.code);

  if (signals.length === 0) {
    // No attention signal → no priority. Recency never invents priority from nothing.
    return { score: 0, band: "low", signals: [], explanationCodes: ["no_attention_signals", "band_assigned"] };
  }

  const explanationCodes: string[] = ["severity_weight_applied"];

  // Base: sum of severity weights.
  let score = signals.reduce((sum, s) => sum + SEVERITY_WEIGHTS[s.severity], 0);

  // Co-occurrence: count high/medium signals; conservative, non-cumulative bonus.
  const significant = signals.filter((s) => s.severity === "high" || s.severity === "medium").length;
  if (significant >= 3) {
    score += COOCCURRENCE_BONUS_3;
    explanationCodes.push("signal_cooccurrence_bonus");
  } else if (significant >= 2) {
    score += COOCCURRENCE_BONUS_2;
    explanationCodes.push("signal_cooccurrence_bonus");
  }

  // Coarse high-sales bonus (amountBucket-derived signal only — never an exact amount).
  if (codes.includes("high_sales_context")) {
    score += HIGH_SALES_CONTEXT_BONUS;
    explanationCodes.push("high_sales_context_bonus");
  }

  // Recency tie-breaker (capped, secondary). Only the coarse bucket is read; the fixed
  // code is recorded only when the contribution is non-zero (so its absence is meaningful).
  const recencyPoints = RECENCY_BUCKET_POINTS[recencyBucketOf(event, opts)];
  if (recencyPoints > 0) {
    score += recencyPoints;
    explanationCodes.push("recency_bucket_applied");
  }

  explanationCodes.push("band_assigned");

  return { score, band: bandFor(score), signals: codes, explanationCodes };
}
