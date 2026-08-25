import type { ProactiveCaseView } from "./types";

/**
 * The seller-facing vocabulary of 「AI가 먼저 확인한 일」, and the one routing decision the card makes.
 *
 * Kept out of the component so the words can be read in one place and tested without rendering. The
 * rule behind every label here: say what SellerOps DID, never what it concluded. "답변 초안까지
 *준비했습니다" is a fact about a file; "이 문의는 이렇게 답하면 됩니다" would be a claim about a
 * customer, and the seller has not approved it yet.
 */

export const PREPARED_ACTION_LABEL: Record<ProactiveCaseView["preparedAction"], string> = {
  DRAFT_PREPARED: "답변 초안 준비됨",
  RECOMMENDATION_ONLY: "확인할 내용 정리됨",
  NONE: "준비 중단됨",
};

export const PRIORITY_LABEL: Record<ProactiveCaseView["priority"], string> = {
  HIGH: "먼저 확인",
  NORMAL: "확인 권장",
};

/**
 * What the evidence line says.
 *
 * `GROUNDED` is the only state that claims a source, and it says how many passages rather than which
 * — the passages themselves are on the draft screen, cited beside the text they produced. The other
 * three name the gap, because each is a different thing for the seller to do about it.
 */
export function evidenceLabel(view: ProactiveCaseView): string | null {
  if (view.subjectKind === "REVIEW") {
    return view.evidenceCount > 0 ? "반복 문제 확인됨" : null;
  }
  switch (view.evidenceState) {
    case "GROUNDED":
      return `근거 ${view.evidenceCount}건 사용`;
    case "NO_MATCH":
      return "해당하는 근거 없음";
    case "NO_LIBRARY":
      return "상품 지식 없음";
    // NO_PRODUCT deliberately says nothing here. The card already carries a product line reading
    // 상품 미지정, and the knowledge-gap sentence below already explains what that costs the draft —
    // an evidence label repeating the same two words made the card stutter ("상품 미지정 … · 상품
    // 미지정"), which is how a seller learns to stop reading a line that usually matters.
    case "NO_PRODUCT":
    default:
      return null;
  }
}

/**
 * Where [확인하기] goes — always an EXISTING screen.
 *
 * An inquiry opens the response flow it already has; a review opens the review list. There is no
 * proactive-only detail page, on purpose: a second place to read the same inquiry is a second place
 * for the seller to lose track of what they have already answered.
 */
export function caseTarget(view: ProactiveCaseView): string {
  if (view.subjectKind === "INQUIRY") {
    return `/inquiries/${view.subjectId}`;
  }
  return "/reviews";
}

/** `inquiry` / `review` — the only prop the analytics event carries. Never the subject's content. */
export function analyticsKind(view: ProactiveCaseView): "inquiry" | "review" {
  return view.subjectKind === "INQUIRY" ? "inquiry" : "review";
}
