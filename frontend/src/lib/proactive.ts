import type { ProactiveCaseView } from "./types";

/**
 * The seller-facing vocabulary of 「AI가 먼저 확인한 일」, and the one routing decision the card makes.
 *
 * Kept out of the component so the words can be read in one place and tested without rendering. The
 * rule behind every label here: say what SellerOps DID, never what it concluded. "답변 초안까지
 *준비했습니다" is a fact about a file; "이 문의는 이렇게 답하면 됩니다" would be a claim about a
 * customer, and the seller has not approved it yet.
 */

/**
 * The one badge a card wears — what SellerOps DID, in the seller's words, with the tone that means it.
 *
 * The card used to wear the PRIORITY (「먼저 확인」/「확인 권장」) and then say what was prepared three
 * lines down in grey, beside an evidence count and a knowledge gap. Priority is SellerOps's ranking of
 * its own list; what the seller decides from is whether an answer is ready to look at. So the badge
 * became the prepared action, priority became the sort order it always was, and the evidence count
 * moved to the draft screen where the passages themselves are (Executive-friendly UX Redesign v1).
 *
 * `attention` and `accent` are not decoration: 파랑 means SellerOps prepared something, 주황 means the
 * seller has to look. Both carry the word, never the colour alone.
 */
export function preparedBadge(view: ProactiveCaseView): { label: string; tone: "accent" | "attention" } {
  if (view.preparedAction === "DRAFT_PREPARED") {
    return { label: "답변 준비됨", tone: "accent" };
  }
  return { label: "확인 필요", tone: "attention" };
}

/**
 * Where [확인하기] goes — always an EXISTING screen.
 *
 * An inquiry opens the response flow it already has; a review opens <b>that review's</b> decision screen — the
 * canonical mutation surface for a review (Review Decision Workspace v1). It used to open the bare list, so a card
 * that named one review handed back a page of every review and left the seller to find it again.
 *
 * There is no proactive-only detail page, on purpose: a second place to read the same inquiry is a second place
 * for the seller to lose track of what they have already answered.
 */
export function caseTarget(view: ProactiveCaseView): string {
  if (view.subjectKind === "INQUIRY") {
    return `/inquiries/${view.subjectId}`;
  }
  return `/reviews/reply/${view.subjectId}`;
}

/** `inquiry` / `review` — the only prop the analytics event carries. Never the subject's content. */
export function analyticsKind(view: ProactiveCaseView): "inquiry" | "review" {
  return view.subjectKind === "INQUIRY" ? "inquiry" : "review";
}
