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
