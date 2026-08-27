/**
 * Seller-facing words for closed backend vocabulary that reaches a finding SENTENCE.
 *
 * <b>Why this file exists.</b> Contextual Agent Workspace QA (2026-08-27) read an Agent answer that
 * said 「… COUPANG에 등록돼 있습니다 (가격 14500KRW), 판매상태 ACTIVE」. None of that was the model's
 * doing: the sentence is assembled deterministically in `graph/productOps.ts` from a listing row, and
 * the row's fields are the backend's enum tokens. So the fix is a presentation mapping at the point of
 * assembly — never a regex over prose after the fact, which would also rewrite a product whose name
 * happened to contain the token.
 *
 * <b>Closed and small.</b> Every map here mirrors a vocabulary the frontend already renders
 * (`frontend/src/lib/productVocabulary.ts`), so an Agent sentence and the product screen say the
 * same words for the same state. An unknown token is NOT mapped to a guess: the caller omits the
 * clause, because "판매상태 ACTIVE" told the seller nothing and "판매상태 알 수 없음" would assert a
 * state this runtime does not know.
 */

const SELLING_STATUS: Record<string, string> = {
  SELLING: "판매중",
  SUSPENDED: "판매중지·품절",
  ENDED: "판매종료",
};

/** A listing's selling state in seller words, or null when the token is not one this file knows. */
export function sellingStatusLabel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return SELLING_STATUS[raw] ?? null;
}

/**
 * A price for a sentence: 「14,500원」 for KRW, 「14,500 USD」 otherwise, the bare number with no
 * currency. Grouping only — no rounding, no unit scaling; the number the channel reported is the
 * number the seller reads.
 */
export function moneyLabel(amount: number, currency: string | null | undefined): string {
  const grouped = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }).format(amount);
  if (!currency) return grouped;
  return currency === "KRW" ? `${grouped}원` : `${grouped} ${currency}`;
}

/** The channel's Korean name when the row carries one; the code is the fallback, never a guess. */
export function channelLabel(row: { channelCode: string; channelNameKo?: string | null }): string {
  return row.channelNameKo ?? row.channelCode;
}
