/**
 * <b>When the sentence says it is NOT about the product on screen.</b>
 *
 * A screen hint answers 「what is the seller looking at」, and on a product page that is a product — so
 * every send from that panel carries its id and every read is scoped to it. That is right for 「이 상품
 * 문제 보여줘」 and wrong for the sentence that leaves: measured live 2026-09-07 on the product panel,
 * 「이 상품은 됐고 전체에서 가장 반복되는 문제는?」 and 「전체에서 가장 반복되는 문제는?」 both came back
 * with the same three product-scoped rows, word for word. The seller asked the shop a question and was
 * answered about the product they had just set aside.
 *
 * <b>This is the rule the service already had, applied to the other input.</b> An anchored inquiry's
 * product has travelled only when the sentence points at it since Conversation Object Integrity v1, for
 * exactly this failure ("sent on every turn, the anchor's product turned 「최근 문의 8개 보여줘」 into a
 * product-scoped read"). The screen hint had no such gate.
 *
 * <b>It only ever removes a narrowing.</b> A phrase not in the table leaves the hint exactly as it is
 * today, so this file cannot narrow anything — and it cannot widen a question that named the product in
 * view either, because 「전체」 modifying that product is not a widening.
 */

/** The seller's ways of saying 「not this one — all of them」. Closed and deliberately narrow. */
const EVERY_PRODUCT: readonly string[] = [
  "전체 상품", "상품 전체", "모든 상품", "전 상품", "상품별", "다른 상품",
  "전체에서", "전체적으로", "전체 기준", "전사",
];

/**
 * 「이 상품 전체 리뷰」 — 전체 modifying the product in view is that product, not the catalogue.
 *
 * Without this the widening words would fire on a sentence that names the product twice, and the answer
 * would jump to the org while the panel header still says 「이 상품 · …」.
 */
const MODIFIES_THE_PRODUCT = /[이그저]\s*상품\s*(?:의\s*)?(?:전체|전부)/u;

/** Does this sentence put the question to the whole catalogue rather than to the product on screen? */
export function namesEveryProduct(text: string | null | undefined): boolean {
  const t = (text ?? "").toLowerCase();
  if (MODIFIES_THE_PRODUCT.test(t)) return false;
  return EVERY_PRODUCT.some((w) => t.includes(w));
}
