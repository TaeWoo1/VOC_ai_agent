/**
 * **Reply-submission surface decisions (pure, ISOLATED).**
 *
 * The shared decision core both the fixture driver and the live driver run, so they can never
 * disagree. Pure string/struct-in, struct-out — NEVER raw HTML or selectors cross this boundary; the
 * driver extracts SANITIZED structural signals in-page and passes them here.
 */
import { createHash } from "node:crypto";

/** One-way opaque 16-hex signature of a located composer. Never reversible to a selector or content. */
export function composerSigFor(parts: readonly (string | number)[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16);
}

/** Sanitized structural signals about the reply composer — counts + a salted fingerprint, never raw. */
export interface ReplyComposerSignals {
  composerCandidateCount: number;
  /** Structural, non-reversible parts used to sign the single composer (never raw selector/text). */
  composerSignatureParts?: readonly (string | number)[];
}

/**
 * Read-only locate decision: how many candidate composers, and the opaque signature of the one (when
 * exactly one). Fail-closed 0/many is the engine's job; this only reports counts + sig. It NEVER
 * returns raw content — only a count and a hashed signature.
 */
export function replyComposerLocateDecision(signals: ReplyComposerSignals): { count: number; sig?: string } {
  const count = signals.composerCandidateCount;
  if (count === 1 && signals.composerSignatureParts && signals.composerSignatureParts.length > 0) {
    return { count, sig: composerSigFor(signals.composerSignatureParts) };
  }
  return { count };
}

/* ────────────────────────── Guided review-row targeting (privacy-safe) ────────────────────────── */

/** Coarse recency bucket derived (backend/host-side) from a KST date-only value — never a raw timestamp. */
export type RecencyBucket = "TODAY" | "THIS_WEEK" | "OLDER";

/**
 * The PRIVACY-SAFE metadata used to locate the ONE review row an approved reply targets. Deliberately
 * minimal: a coarse rating, a coarse recency bucket, and a ONE-WAY fingerprint of the already-sanitized
 * body. It carries NO raw body, NO raw timestamp, NO author (there is no such backend field), NO product
 * name, and NO channel-side id. It is a driver-side matching input and an engine-side plan selector —
 * it is NEVER emitted on the wire or persisted; only the opaque row `sig` derived here ever surfaces.
 */
export interface ReplyTargetHint {
  /** Coarse star rating, 1..5. */
  rating: number;
  /** Coarse recency bucket (from KST date-only), never a raw date/timestamp. */
  recencyBucket: RecencyBucket;
  /** One-way hash over the already-PII-tokenized redactedBody/safePreview — never reversible to text. */
  bodyFingerprint: string;
}

/** Sanitized per-row signals a driver extracts read-only in-page — the same shape a hint matches against. */
export interface ReviewRowSignal {
  rating: number;
  recencyBucket: RecencyBucket;
  bodyFingerprint: string;
}

/**
 * Read-only row locate decision: how many rows match the hint, and the opaque signature of the one (when
 * exactly one). The match keys are `rating` + `recencyBucket` + `bodyFingerprint` (the fingerprint is the
 * strong key; rating/bucket pre-filter). Fail-closed 0/many is the engine's job; this only reports counts
 * + sig. The signature is over the matched row's structural POSITION only (`["row", matchedIndex]`) — an
 * observable page fact, NEVER a hint field (rating), the fingerprint, or any raw content. (A hint field in
 * the sig would be brute-forceable off the wire AND redundant for drift detection, since a unique match
 * pins all hint fields.) Mirrors {@link replyComposerLocateDecision} so fixture and live drivers agree.
 */
export function reviewRowLocateDecision(
  hint: ReplyTargetHint,
  rows: readonly ReviewRowSignal[],
): { count: number; sig?: string } {
  let count = 0;
  let onlyIndex = -1;
  rows.forEach((row, i) => {
    if (
      row.rating === hint.rating &&
      row.recencyBucket === hint.recencyBucket &&
      row.bodyFingerprint === hint.bodyFingerprint
    ) {
      count += 1;
      onlyIndex = i;
    }
  });
  if (count === 1) {
    return { count, sig: composerSigFor(["row", onlyIndex]) };
  }
  return { count };
}
