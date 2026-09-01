/**
 * A word every row carries is not a distinction between rows.
 *
 * Measured before this existed: a list the seller asked for as 「답변 안 한 문의」 printed 「답변 필요」 in
 * warn colour beside all twelve rows, and a list asked for as 「별점 낮은 리뷰」 printed 「부정」 beside all
 * eight — the strongest repeated colour on the screen carrying zero information, because the thing it
 * marked was the thing every row had in common. It is said once, where it belongs (the list's own
 * caption), or not at all when the sentence above the list already said it.
 *
 * The rule is general and lives here so the two lists cannot drift into two rules.
 */
export function onlySharedWord(words: readonly (string | null)[]): string | null {
  if (words.length < 2) return null;
  const first = words[0] ?? null;
  return first && words.every((w) => w === first) ? first : null;
}
