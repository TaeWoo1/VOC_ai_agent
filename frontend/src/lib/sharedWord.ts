/**
 * A word every row carries is not a distinction between rows.
 *
 * <b>The rule is one rule, and it applies to lists wherever they are drawn.</b> It was written for the
 * conversation's two artifacts (`lib/conversation/sharedWord.ts`) and stayed there, so the workspace
 * lists kept the shape it exists to remove. Measured on the real org, 2026-09-04: `/inquiries` printed
 * 「답변 필요」 in warn colour beside **twenty of twenty-one** rows and 「카페24 자사몰」 beside the same
 * twenty — the loudest repeated marks on a screen whose content is what the customers wrote — and
 * `/products` printed 「반복 문제」 beside eight of ten. A word carried by every row is a fact about the
 * list, said once in the list's own caption, and not a mark on the rows.
 *
 * Re-exported by `lib/conversation/sharedWord.ts` so the two lanes cannot drift into two rules.
 */
export function onlySharedWord(words: readonly (string | null)[]): string | null {
  if (words.length < 2) return null;
  const first = words[0] ?? null;
  return first && words.every((w) => w === first) ? first : null;
}
