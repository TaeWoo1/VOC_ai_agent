/**
 * **Composer fill — the ONE module in the reply runtime allowed to put text into the page.**
 *
 * Product-owner decision, 2026-08-28: a GUIDED reply run may set the approved draft into the composer the
 * seller opened, so the seller reviews and presses 등록 instead of copying and pasting. This reverses the
 * no-typing rule the reply driver was written under, and the reversal is confined here on purpose: the
 * source-guard test permits `.fill(` in THIS file only, and forbids in this file — as everywhere — every
 * token that submits (`.click(`, `.press(`, `keyboard`, `dispatchEvent`, `.submit(`, `requestSubmit`). Setting
 * the text and sending it are different acts, and only the first one lives in this repository.
 *
 * **The gate is pure and it fails closed.** `composerFillDecision` says whether a fill may happen from four
 * facts the driver already establishes for the guided run: the row matched the target hint EXACTLY ONCE, the
 * review-id fingerprint matched EXACTLY ONCE (or was deliberately not asserted — see below), exactly ONE
 * composer is open, and an approved draft exists. Any count other than 1 is `AMBIGUOUS` and nothing is
 * typed; a missing fact is `NOT_FILLABLE` and nothing is typed. A run that cannot fill still continues to the
 * submit barrier as it always has — the seller pastes — so "could not fill" is never "could not reply".
 *
 * **Review-id assertion.** The channel review id is the strongest identity the surface exposes, and when the
 * backend holds a fingerprint for the review the gate REQUIRES the in-page ladder to find it exactly once.
 * When no verdict is available (`UNAVAILABLE`) nothing is typed (Acceptance Closure §3): the hint match is
 * enough to highlight a row for a person to look at, not enough to put words into a box under that row. A
 * ladder that found it twice, or found it on a different row than the hint matched, is ambiguity — not a tie
 * to break.
 *
 * What goes into the box is the approved draft byte for byte. The seller may edit it in NAVER's own UI
 * before submitting, which is why `COMPOSER_FILLED` never promotes anything (see the engine).
 */

export type ReviewIdMatchVerdict =
  /** The backend holds a fingerprint and the ladder found it on exactly one row. */
  | { kind: "MATCHED"; rowIndex: number }
  /** The backend holds a fingerprint and the ladder found it 0 or ≥2 times. */
  | { kind: "AMBIGUOUS"; matchCount: number }
  /** The backend holds no fingerprint for this review; identity rests on the hint match alone. */
  | { kind: "UNAVAILABLE" };

export interface ComposerFillGate {
  /** How many rows matched the target hint, and which one (index) when exactly one did. */
  readonly rowMatchCount: number;
  readonly matchedRowIndex: number | null;
  readonly reviewId: ReviewIdMatchVerdict;
  /** How many composers are open on the page. */
  readonly composerCount: number;
  /** Whether an approved draft body exists (never the body itself — the gate does not need it). */
  readonly hasDraft: boolean;
}

export type ComposerFillDecision =
  | { fill: true }
  | { fill: false; reason: "AMBIGUOUS" | "NOT_FILLABLE" };

export function composerFillDecision(gate: ComposerFillGate): ComposerFillDecision {
  if (!gate.hasDraft) return { fill: false, reason: "NOT_FILLABLE" };
  if (gate.rowMatchCount !== 1 || gate.matchedRowIndex === null) return { fill: false, reason: "AMBIGUOUS" };
  if (gate.composerCount !== 1) return { fill: false, reason: "AMBIGUOUS" };
  switch (gate.reviewId.kind) {
    case "MATCHED":
      // The ladder and the hint must agree on WHICH row. Two identities pointing at two rows is not a match.
      return gate.reviewId.rowIndex === gate.matchedRowIndex ? { fill: true } : { fill: false, reason: "AMBIGUOUS" };
    case "AMBIGUOUS":
      return { fill: false, reason: "AMBIGUOUS" };
    case "UNAVAILABLE":
      // Acceptance Closure §3: a hint-only match is a highlight, not an identity strong enough to type under.
      // Without a review-id verdict the run reaches the barrier unfilled and the seller pastes.
      return { fill: false, reason: "NOT_FILLABLE" };
  }
}

/** The one composer element this module will write into: the read-only marker the highlight already set. */
export const FILL_TARGET_SELECTOR = "[data-aw-reply-target]";

/** The narrowest page surface a fill needs: a locator that can count and set text. Never a click. */
export interface ComposerFillPageLike {
  locator(selector: string): { count(): Promise<number>; fill(value: string): Promise<void> };
}

export type ComposerFillResult =
  | { filled: true }
  | { filled: false; reason: "AMBIGUOUS" | "NOT_FILLABLE" };

/**
 * Set `draftBody` into the single highlighted composer. Re-counts the target at the moment of writing — the
 * gate was decided a moment earlier and the page is the seller's — and refuses anything but exactly one.
 * Throws nothing outward: a page that moved reads as `NOT_FILLABLE`, and the run continues to the barrier.
 */
export async function fillComposer(page: ComposerFillPageLike, draftBody: string): Promise<ComposerFillResult> {
  if (draftBody.length === 0) return { filled: false, reason: "NOT_FILLABLE" };
  try {
    const target = page.locator(FILL_TARGET_SELECTOR);
    const count = await target.count();
    if (count !== 1) return { filled: false, reason: "AMBIGUOUS" };
    await target.fill(draftBody);
    return { filled: true };
  } catch {
    return { filled: false, reason: "NOT_FILLABLE" };
  }
}
