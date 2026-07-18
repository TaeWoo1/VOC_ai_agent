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
