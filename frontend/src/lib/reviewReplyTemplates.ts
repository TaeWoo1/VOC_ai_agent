import type { ReviewReplyTemplateView } from "./types";

/**
 * <b>Korean names for the review reply templates — the whole reason the settings screen is readable.</b>
 *
 * The backend addresses these by the category string it has always reported (`positive_reply`,
 * `delivery_reply`, …). Those are storage keys, and a person who runs a manufacturing company should
 * never have to see one. This map is where each becomes a name they would use themselves, plus one
 * line saying WHEN reviewnary uses it — because a settings screen that cannot say when a setting
 * applies is asking the seller to guess.
 *
 * The order the backend sends is the order the product actually decides in — the five issue types
 * first, in the order they are tried, then the two the rating decides — and the screen keeps it:
 * reading the list top to bottom is reading the rule.
 */
export interface ReviewReplyTemplateLabel {
  /** The name on screen. A noun phrase a seller would say out loud. */
  readonly name: string;
  /** When this template is used, in one sentence. Never mentions a key, a rule or a provider. */
  readonly when: string;
}

const LABELS: Record<string, ReviewReplyTemplateLabel> = {
  quality_reply: {
    name: "불량 · 파손 리뷰",
    when: "상품이 불량이거나 깨지고 고장 났다는 리뷰에 씁니다.",
  },
  delivery_reply: {
    name: "배송 리뷰",
    when: "배송이나 발송이 늦었다는 리뷰에 씁니다.",
  },
  packaging_reply: {
    name: "포장 리뷰",
    when: "포장이나 박스 상태를 지적한 리뷰에 씁니다.",
  },
  product_info_reply: {
    name: "상품 설명과 다르다는 리뷰",
    when: "설명이나 사진과 실제가 다르다는 리뷰에 씁니다.",
  },
  pricing_reply: {
    name: "가격 리뷰",
    when: "가격이 비싸다거나 가성비를 말한 리뷰에 씁니다.",
  },
  positive_reply: {
    name: "칭찬 리뷰",
    when: "별점이 4~5점이고 위 유형의 낱말이 없는 리뷰에 씁니다. 낱말이 하나라도 있으면 별점이 높아도 그 유형의 문구를 씁니다.",
  },
  general_reply: {
    name: "그 밖의 리뷰",
    when: "위 유형의 낱말이 없고 별점도 높지 않은 리뷰에 씁니다.",
  },
};

/**
 * The name for a template. A key with no label is not rendered at all rather than shown raw — a
 * seller must never read `positive_reply` on this screen, and a backend that grew a category before
 * this map did is a bug in this file, not a reason to leak the key.
 */
export function templateLabel(key: string): ReviewReplyTemplateLabel | null {
  return LABELS[key] ?? null;
}

/** Only the templates this build can name, in the order the backend sent them. */
export function labelledTemplates(
  templates: readonly ReviewReplyTemplateView[],
): Array<{ template: ReviewReplyTemplateView; label: ReviewReplyTemplateLabel }> {
  return templates.flatMap((template) => {
    const label = templateLabel(template.key);
    return label ? [{ template, label }] : [];
  });
}

/** Every key this build can name — the test uses it to prove the backend's set is covered. */
export const LABELLED_TEMPLATE_KEYS = Object.keys(LABELS);
