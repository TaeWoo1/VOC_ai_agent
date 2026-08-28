/**
 * The factual envelope of a reply draft — the parts a TONE change must leave byte-identical.
 *
 * <b>Style may move; facts may not.</b> A softer draft that now promises a refund, drops a delivery
 * date or changes 「3~4가닥」 to 「4가닥」 is not a tone variant, it is a different answer. The backend
 * keeps the facts section of the model turn identical between tones (`AnswerStyleDraftTest`); this
 * extractor is the runtime's independent check on the OUTPUT, so a vendor that rewrote a number is
 * caught before the seller reads the variant as "the same thing, said nicer".
 *
 * <b>Deterministic and closed.</b> Four families, each a literal pattern list: numbers (with units and
 * ranges), dates, promise words (배송/환불/보상/교환/반품 + the verbs that make them commitments) and
 * policy assertions (가능/불가/무료/유료/보증). No model, no scoring — two envelopes either match or
 * they do not, and the caller refuses the variant when they do not.
 */

export interface FactualEnvelope {
  readonly numbers: readonly string[];
  readonly dates: readonly string[];
  readonly promises: readonly string[];
  readonly policies: readonly string[];
}

const NUMBER = /\d[\d,.]*(?:\s*[~\-–]\s*\d[\d,.]*)?\s*(?:개|건|일|시간|분|원|%|mm|cm|m|kg|g|가닥|호|장|회|박스|세트|매)?/g;
const DATE = /(?:\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2})|(?:\d{1,2}월\s*\d{1,2}일)|(?:\d{1,2}\/\d{1,2})|(?:오늘|내일|모레|당일|익일|이번\s*주|다음\s*주|주말)/g;
/** A commitment about an operational outcome — the noun and the verb that promises it, together. */
const PROMISE = /(?:배송|발송|출고|환불|보상|교환|반품|재발송|재배송|회수|수거)\s*(?:을|를|이|가|은|는|도)?\s*(?:해\s*드리|드리|보내\s*드리|처리해\s*드리|진행해\s*드리|도와\s*드리|하겠|예정|가능|됩니다|드립니다|하겠습니다|해드리겠습니다)[가-힣]*/g;
/** A policy assertion — what the seller states as their rule. */
const POLICY = /(?:교환|반품|환불|배송|보증|AS|A\/S|수리|취소)\s*(?:이|가|은|는)?\s*(?:불가|가능|무료|유료|무상|유상|불가능)[가-힣]*/g;

function collect(text: string, pattern: RegExp): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(pattern)) {
    const v = m[0].replace(/\s+/g, "").trim();
    if (v.length > 0) out.push(v);
  }
  return out.sort();
}

export function extractEnvelope(text: string | null | undefined): FactualEnvelope {
  const body = (text ?? "").normalize("NFC");
  const dates = collect(body, DATE);
  // A date's digits are not also a quantity: strip matched dates before counting numbers.
  const withoutDates = body.replace(DATE, " ");
  return {
    numbers: collect(withoutDates, NUMBER),
    dates,
    promises: collect(body, PROMISE),
    policies: collect(body, POLICY),
  };
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Which families differ, in a closed vocabulary — empty ⇒ the envelopes match. */
export function envelopeDiff(a: FactualEnvelope, b: FactualEnvelope): Array<keyof FactualEnvelope> {
  const diff: Array<keyof FactualEnvelope> = [];
  for (const key of ["numbers", "dates", "promises", "policies"] as const) {
    if (!sameList(a[key], b[key])) diff.push(key);
  }
  return diff;
}

export function envelopesMatch(a: FactualEnvelope, b: FactualEnvelope): boolean {
  return envelopeDiff(a, b).length === 0;
}

export const ENVELOPE_FAMILY_LABEL: Record<keyof FactualEnvelope, string> = {
  numbers: "숫자",
  dates: "날짜",
  promises: "약속",
  policies: "정책",
};
