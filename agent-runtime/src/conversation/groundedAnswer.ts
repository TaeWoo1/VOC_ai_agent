/**
 * <b>What a model-written sentence must look like before a seller reads it.</b>
 *
 * Grounded Conversation Lane v1 §3. This lane is the first place in the conversation runtime where the
 * sentence a seller reads is written by a model rather than composed from tokens, so it is the first
 * place that needs the check every other model seam already has in its own shape: the report narrative
 * refuses a claim with no fact id, the draft refuses a forbidden phrase, and this refuses prose that is
 * not seller-facing.
 *
 * <b>Refusal costs the older answer, never the turn.</b> Every rejection here falls back to the
 * deterministic composer — the one that shipped before this package — so the failure direction is
 * «narrower», exactly as an unavailable capability is.
 *
 * <b>It checks SHAPE, not truth.</b> Whether a sentence is true is what the fact sheet is for; a guard
 * that tried to verify claims would be a second model. What is checkable is whether our internal words
 * leaked, whether the answer is document-shaped, and whether it is long enough to be a repeat of the
 * card this package removed.
 */

/** Longer than this is a document, and 「짧고 scan 가능하게」 is the requirement this lane was given. */
export const MAX_ANSWER_CHARS = 1200;

/**
 * Words that are ours and not the seller's.
 *
 * <b>The screaming-snake pattern is the load-bearing one</b> — every closed token in this runtime is
 * shaped that way ({@code NOT_SUPPORTED}, {@code EXPLAIN_CAPABILITY}, {@code API_EXECUTION}), and a
 * seller reading one is the defect `docs/reviewnary_design.md` names about raw enum exposure. It
 * deliberately does not match {@code AI}, {@code API} or {@code URL}, which are ordinary Korean-business
 * loanwords.
 */
const INTERNAL_PATTERNS: readonly RegExp[] = [
  /[A-Z][A-Z0-9]*_[A-Z0-9_]+/,
  /\b(?:get|list|search|resolve)_[a-z_]{3,}/,
  /\bsellerops\b/i,
  /\bcapabilityAspect\b|\bWorldState\b|\bartifact\b|\bworking ?set\b/i,
  /\bLangGraph\b|\bplanner\b|\bprompt\b/i,
];

/** Document furniture. A chat answer that draws a table or a heading is answering the wrong question. */
const DOCUMENT_PATTERNS: readonly RegExp[] = [/^#{1,6}\s/m, /\|\s*-{3,}/, /^\s*\|.*\|\s*$/m];

export interface GroundedVerdict {
  readonly ok: boolean;
  /** Why it was refused — logged, never shown. */
  readonly reason?: "EMPTY" | "TOO_LONG" | "INTERNAL_WORD" | "DOCUMENT_SHAPE";
  /** The answer, whitespace-normalised, when it is usable. */
  readonly text?: string;
}

export function checkGroundedAnswer(raw: string | null | undefined): GroundedVerdict {
  const text = (raw ?? "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length === 0) return { ok: false, reason: "EMPTY" };
  if (text.length > MAX_ANSWER_CHARS) return { ok: false, reason: "TOO_LONG" };
  if (INTERNAL_PATTERNS.some((p) => p.test(text))) return { ok: false, reason: "INTERNAL_WORD" };
  if (DOCUMENT_PATTERNS.some((p) => p.test(text))) return { ok: false, reason: "DOCUMENT_SHAPE" };
  return { ok: true, text };
}
