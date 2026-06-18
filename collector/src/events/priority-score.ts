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
 * NO recency / dedup / cluster / AI factor (all deferred — see priority-score-model.md).
 * No I/O, no network, no fs, no browser, no env, no current-time read.
 */

import type {
  AttentionSignalCode,
  AttentionSignalSeverity,
} from "./attention-signals";
import { attentionSignalsFor } from "./attention-signals";
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

/**
 * Compute the priority score + explanation for a single event. Deterministic: the same
 * event yields the same result every call (no time, no randomness, no external state).
 */
export function priorityScoreFor(event: SellerOpsEvent): PriorityScoreExplanation {
  const signals = attentionSignalsFor(event);
  const codes = signals.map((s) => s.code);

  if (signals.length === 0) {
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

  explanationCodes.push("band_assigned");

  return { score, band: bandFor(score), signals: codes, explanationCodes };
}
