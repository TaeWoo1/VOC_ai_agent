/**
 * Example sentences per surface — prompts, not capabilities. A chip is a sentence the seller sends
 * to the planner; nothing here resolves to a tool or a screen. At most three per surface.
 */
export const HOME_PROMPTS: readonly string[] = [
  "오늘 리뷰 뭐 들어왔어?",
  "어제 온 문의 중 내가 답해야 할 거?",
  "이번 주 매출 왜 이래?",
  "요즘 문제 생기는 상품 있어?",
];

/**
 * What an empty thread offers a seller who has connected NOTHING.
 *
 * {@link HOME_PROMPTS} are all questions about rows — 「오늘 리뷰 뭐 들어왔어?」 — and before the first
 * connection there are no rows and cannot be: every one of them is an example the product would answer
 * with a zero. These two are the questions that org can actually have answered today, and the connect
 * step itself is the screen's own primary button, not a sentence to type.
 */
export const FIRST_USE_PROMPTS: readonly string[] = [
  "이 서비스로 뭘 할 수 있어?",
  "어떻게 시작하면 돼?",
];

const BY_SURFACE: Record<string, readonly string[]> = {
  product: ["이 상품에 반복되는 문제가 있어?", "이 상품 미답변 문의 정리해줘", "이 상품 리뷰 최근에 어때?"],
  products: ["요즘 문제 생기는 상품 있어?", "미답변 문의가 많은 상품은?"],
  inquiries: ["오늘 내가 답해야 할 문의 정리해줘", "배송 관련부터 보여줘", "첫 번째 거 답변 준비해줘"],
  reviews: ["오늘 새로 달린 리뷰 보여줘", "안 좋은 것만 봐줘", "문의에서도 같은 얘기 있어?"],
  orders: ["지난주보다 왜 매출이 떨어졌어?", "카페24만 봐봐", "그때 리뷰나 문의에도 변화 있었어?"],
  home: HOME_PROMPTS.slice(0, 3),
};

export function promptsFor(surface: string | null | undefined): readonly string[] {
  return (surface ? BY_SURFACE[surface] : undefined) ?? HOME_PROMPTS.slice(0, 3);
}

/** The empty-box placeholder, naming the object in view. */
export function placeholderFor(label: string | null | undefined): string {
  return label ? `${label}에 대해 무엇이든 물어보세요` : "무엇이든 물어보세요";
}
