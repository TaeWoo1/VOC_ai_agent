/**
 * The words the 상품 screens use for a channel's own state — and the one they stopped using.
 *
 * <b>Nothing here is invented.</b> `SellingStatus` on the backend normalizes each channel's token,
 * and its own mapping table names the Korean words it collapsed: `판매중` → SELLING, `판매중지`/`품절`
 * → SUSPENDED, `판매종료` → ENDED, everything else → UNKNOWN. These labels are those words handed
 * back. SUSPENDED names both halves of what it absorbed, because calling a sold-out listing
 * 「판매중지」 would tell the seller their own listing was stopped.
 *
 * <b>`products.status` is deliberately absent.</b> It is a free-text column the catalogue writer sets
 * to the literal string `ACTIVE` and never to anything else, so on screen it was an English token
 * with no second value to distinguish it from — 「상품코드 9788639791 · ACTIVE」. A column that always
 * says one word says nothing; it was removed from the 상품 table and the detail subtitle rather than
 * given a Korean name it has not earned.
 */

const SELLING_STATUS: Record<string, string> = {
  SELLING: "판매중",
  SUSPENDED: "판매중지·품절",
  ENDED: "판매종료",
  UNKNOWN: "상태 미상",
};

/** A listing's selling state in seller words, or the raw token when a channel sends something new. */
export function sellingStatusLabel(raw: string | null | undefined): string {
  if (!raw) return "—";
  return SELLING_STATUS[raw] ?? raw;
}

/**
 * A listing price as a seller reads it.
 *
 * `22,500KRW` was the currency CODE glued to the number. Korean won gets its own character; any other
 * currency keeps its code with a space, because inventing a symbol for a currency this product has
 * never seen would be a guess about someone else's money.
 */
export function priceLabel(amount: string, currency: string | null | undefined): string {
  if (!currency) return amount;
  return currency === "KRW" ? `${amount}원` : `${amount} ${currency}`;
}
