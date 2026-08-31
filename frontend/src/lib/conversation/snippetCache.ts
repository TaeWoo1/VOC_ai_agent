/**
 * What the customer wrote, remembered for THIS page's lifetime only.
 *
 * <b>Why this exists.</b> The row's snippet is transient by contract: the runtime strips it before the
 * conversation is stored, because a thread must not accumulate a second copy of the customer's words.
 * That is right, and it has one visible cost — a refine of the rows on screen (「그중 답변 안 한 것만」)
 * is composed from the PERSISTED rows, so the same inquiry that was readable one turn ago comes back as
 * a title alone, and the conversation appears to forget what it just showed.
 *
 * <b>What this is, and what it is not.</b> A module-level map filled by rows the browser already
 * rendered, read by later rows of the same page. It is not storage: nothing is written to disk or to
 * `localStorage`, nothing is sent anywhere, and a reload starts empty — after one, a row is read back
 * from the inquiry's own detail, exactly as before. Cleared when the session or the org changes, so one
 * tenant's rows can never be read under another's.
 */
const bodies = new Map<string, string>();

/** Remember what a rendered row carried. A row with no snippet never overwrites one that had it. */
export function rememberSnippet(inquiryId: string, snippet: string | null | undefined): void {
  if (!inquiryId || !snippet) return;
  bodies.set(inquiryId, snippet);
}

/** What this page has already shown for that inquiry, or null. */
export function recallSnippet(inquiryId: string): string | null {
  return bodies.get(inquiryId) ?? null;
}

/** A session or org change ends the page's memory of every customer sentence it drew. */
export function forgetSnippets(): void {
  bodies.clear();
}
