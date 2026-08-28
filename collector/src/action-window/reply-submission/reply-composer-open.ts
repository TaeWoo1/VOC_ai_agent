/**
 * **Composer open — the ONE module in the reply runtime allowed to click a page control.**
 *
 * Product-owner correction, 2026-08-28 (Acceptance Closure §2): after the exact review row is verified, the
 * Agent — not the seller — presses the row's NON-SUBMIT "답글 작성" control so the composer opens, then fills
 * it and stops. The seller's remaining act is the final submit. The click is confined here on purpose: the
 * source-guard test permits `.click(` in THIS file only, and forbids in this file — as everywhere — every token
 * that types or submits (`.fill(`, `.type(`, `.press(`, `keyboard`, `dispatchEvent`, `.submit(`, `.value =`).
 *
 * **What may be clicked is decided elsewhere and read-only.** `reply-row-composer-inpage.ts` tags at most ONE
 * element inside the verified row's own scope with `data-aw-reply-open-target`, and only when its wording is
 * an OPEN word (답글/답변/댓글/reply) and NOT a submit word (등록/저장/제출/전송/완료/submit/post/send). This
 * module clicks exactly that marker or nothing: a count other than 1 is `AMBIGUOUS`, and the run falls back to
 * the seller opening the composer themselves — the minimum step, asked only when the page made it necessary.
 */

/** The one control this module will press: the read-only marker the in-page tagger set inside the matched row. */
export const OPEN_TARGET_SELECTOR = "[data-aw-reply-open-target]";

/** The narrowest page surface an open needs: a locator that can count and click. Never a fill, never a key. */
export interface ComposerOpenPageLike {
  locator(selector: string): { count(): Promise<number>; click(): Promise<void> };
}

export type ComposerOpenResult =
  | { opened: true }
  | { opened: false; reason: "AMBIGUOUS" | "NOT_FOUND" | "NOT_SUPPORTED" };

/**
 * Press the single tagged open control. Re-counts the marker at the moment of pressing — the tag was set a
 * moment earlier and the page is the seller's — and refuses anything but exactly one. Throws nothing outward:
 * a page that moved reads as `NOT_FOUND`, and the run asks the seller for that one step instead.
 */
export async function openComposer(page: ComposerOpenPageLike): Promise<ComposerOpenResult> {
  try {
    const target = page.locator(OPEN_TARGET_SELECTOR);
    const count = await target.count();
    if (count > 1) return { opened: false, reason: "AMBIGUOUS" };
    if (count === 0) return { opened: false, reason: "NOT_FOUND" };
    await target.click();
    return { opened: true };
  } catch {
    return { opened: false, reason: "NOT_FOUND" };
  }
}
