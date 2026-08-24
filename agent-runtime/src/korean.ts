/**
 * Korean particle agreement, for sentences composed from a name the runtime did not choose.
 *
 * <b>This is not cosmetic, and the repository has now paid for it three times.</b> "쿠팡는"
 * (Cross-Channel v1), "쿠팡가 매출의 60%" (Demo Core Experience, backend) and, in this file's first
 * caller, the literal placeholder "은(는)" printed straight at a seller — each one a particle glued to
 * data without looking at the data. A sentence with the wrong particle reads as machine output, which
 * is precisely the impression an operations assistant cannot afford.
 *
 * <b>Shared, not per-module.</b> It lived inside `group/ChannelCoverage.ts` and inflected only channel
 * names, so the specialist writing product sentences reached for a placeholder instead. One rule, one
 * home, every caller.
 *
 * The rule: a Hangul syllable is `0xAC00 + 초성×588 + 중성×28 + 종성`, so `(code − 0xAC00) % 28 === 0`
 * means no final consonant. A name ending in anything else — a digit, a Latin letter — keeps the
 * open-syllable form, which is what a reader supplies for a foreign word anyway.
 */

function hasFinalConsonant(noun: string): boolean {
  const trimmed = noun.trim();
  if (trimmed.length === 0) {
    return false;
  }
  const code = trimmed.charCodeAt(trimmed.length - 1);
  if (code < 0xac00 || code > 0xd7a3) {
    return false;
  }
  return (code - 0xac00) % 28 !== 0;
}

/** "쿠팡" → "쿠팡은"; "네이버 스마트스토어" → "네이버 스마트스토어는". Topic particle. */
export function withTopic(noun: string): string {
  return noun.trim().length === 0 ? "" : `${noun}${hasFinalConsonant(noun) ? "은" : "는"}`;
}

/** "쿠팡" → "쿠팡이"; "스토어" → "스토어가". Subject particle. */
export function withSubject(noun: string): string {
  return noun.trim().length === 0 ? "" : `${noun}${hasFinalConsonant(noun) ? "이" : "가"}`;
}
