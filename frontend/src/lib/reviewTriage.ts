import type { ReviewTriageTier } from "./types";

/**
 * How a triage tier reads on screen.
 *
 * The backend sends a tier name; the words and the colour are chosen here, so a copy change never
 * needs a backend release and the API never carries Korean the operator might not see.
 *
 * **확인 필요 is emphasised; the other two are not.** A palette where every tier had its own colour
 * would make the list look like a status board and spend the operator's attention evenly across
 * rows that do not deserve it evenly. 지켜보기 and 참고 are deliberately quiet.
 *
 * These are not reused from `Chip`, whose palette is deliberately two-tone: it exposes no
 * status colours precisely so a chip cannot imply a health claim. A tier is not a health claim, but
 * widening `Chip` to make that argument would remove the fence for everyone else.
 */
export const TRIAGE_TIER_LABEL: Record<ReviewTriageTier, string> = {
  NEEDS_ATTENTION: "확인 필요",
  WATCH: "지켜보기",
  FYI: "참고",
};

export const TRIAGE_TIER_CLASS: Record<ReviewTriageTier, string> = {
  NEEDS_ATTENTION: "bg-warn/10 text-warn",
  WATCH: "bg-canvas text-muted",
  FYI: "bg-canvas text-muted",
};

/** The filter controls, in the order they are read — worst first, matching the default sort. */
export const TRIAGE_TIERS: ReviewTriageTier[] = ["NEEDS_ATTENTION", "WATCH", "FYI"];

/**
 * The one sentence that keeps the issue tags honest.
 *
 * The tags come from `item_analyses.category`, a stored keyword classification whose accuracy has
 * never been measured — the label seed in `contracts/review-eval/naver/v1/labels.json` is empty. So
 * the surface says so once, plainly, where the tags are, rather than leaving the seller to assume a
 * verdict.
 *
 * The nearest written rule is product-scope §1.7's carve-out, which requires **issue-memory**
 * judgements always be worded as 검증되지 않은 이슈 후보. That clause is scoped to a different
 * mechanism (`reviewissue`'s aspect+problem signatures), so it is the precedent here rather than the
 * authority — the same posture applied to the same kind of unmeasured output.
 */
export const TRIAGE_TAG_DISCLOSURE =
  "분류는 본문 키워드로 자동 분류한 것이라 정확하지 않을 수 있습니다. 확인 필요 여부는 별점과 본문 유무로만 판단합니다.";

/**
 * The pilot's mark, RUBRIC v2 §13.7 — and the sentence that keeps it honest.
 *
 * `AI 확인 필요` is rendered as its own chip BESIDE the rules tier, never in its place, so the seller
 * can always tell which mechanism spoke. It is a candidate's suggestion: the rule did not call this
 * review 확인 필요, a frozen classifier did, and the disclosure says so in one line. The chip uses
 * the same emphasis as 확인 필요 because it sorts with 확인 필요; the wording carries the difference.
 */
export const AI_TRIAGE_MARK_LABEL = "AI 확인 필요";
export const AI_TRIAGE_MARK_CLASS = "bg-warn/10 text-warn ring-1 ring-warn/40";
export const AI_TRIAGE_DISCLOSURE =
  "별점·본문 유무 기준으로는 확인 필요가 아니지만, AI 분류가 판매자가 확인할 내용이 있다고 판단한 상품평입니다. 틀렸다면 아래에서 바로잡아 주세요.";

/**
 * The correction controls' words — the seller's own judgment, in the same three words the tier chips
 * use.
 *
 * **Three, since T-07.** This was two ("확인 필요가 맞아요" / "확인할 필요 없어요") on the reasoning
 * that the WATCH/FYI split is the rule's and the pilot does not own it. That was right about the
 * PILOT and wrong about the SELLER: a seller looking at a 지켜보기 chip and disagreeing has no way to
 * say whether they meant 참고, and the product answered for them.
 *
 * The words are `TRIAGE_TIER_LABEL`'s, deliberately — the seller is choosing among the things the
 * screen already calls these reviews, and a second vocabulary for the same three states would make
 * "확인할 필요 없어요" and "참고" look like different answers.
 */
export const TRIAGE_CORRECTION_LABEL: Record<ReviewTriageTier, string> = TRIAGE_TIER_LABEL;

/** What the correction block asks, and what it says once the seller has answered. */
export const TRIAGE_CORRECTION_COPY = {
  prompt: "판매자님 판단은 어떠신가요?",
  withdraw: "수정 되돌리기",
  systemPrefix: "시스템 판단",
  sellerPrefix: "판매자 수정",
  /**
   * The one sentence that keeps the control honest. A seller who corrects a review and watches the
   * list stay exactly as it was deserves to know that is the design, not a failure.
   */
  disclosure:
    "판매자님 판단은 시스템 판단을 덮어쓰지 않고 함께 기록됩니다. 목록 순서는 바뀌지 않으며, 다음 분류 기준을 검토할 때 근거로 씁니다. 마켓플레이스에는 아무것도 전송되지 않습니다.",
} as const;

/** The action controls' words. Unchanged — these are statements about what the seller did off-screen. */
export const TRIAGE_FEEDBACK_LABEL = {
  started: "조치 시작",
  completed: "조치 완료",
  actionNotNeeded: "조치 불필요",
} as const;
