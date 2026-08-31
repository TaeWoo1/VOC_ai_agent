/**
 * Two closed intent contracts the conversation lane resolves WITHOUT the planner (Conversation Object
 * Integrity v1, 2026-08-30) — because both are about the object already on the table, not about the
 * seller's business, and a plan for them is a plan for nothing.
 *
 * <b>Tone revision.</b> While a draft is on the table (`pendingPrepared`), 「조금 더 부드럽게」 / 「더 짧게」 /
 * 「조금 정중하게」 are a request to REVISE THAT DRAFT's style: same inquiry, same evidence, same facts,
 * one new version. Found live: the sentence without its trailing verb was planned as a workload read —
 * nine READ calls, the org queue listed into the chat, the working set replaced — and even the exact chip
 * text ran a plan beside the revision. The contract is the same three tokens the planner and the
 * backend already speak (`ToneHint`); what is closed here is the CUES for each token. This is not a
 * per-sentence branch: a cue table is data, one family must match and no other, and the lane runs only
 * when there is a draft to revise. Anything else still goes to the planner.
 *
 * <b>Ordinal selection.</b> 「첫 번째 거」 / 「두 번째 문의」 as a whole sentence over the list the seller was
 * just shown selects that row — by position in the set, never by a model's reading of the sentence.
 * A sentence that carries more than the ordinal (「첫 번째 거 답변 준비해줘」) is the planner's: it names an
 * action, and the planner's `target` already resolves the position.
 */
import type { ToneHint } from "./contract";

interface ToneFamily {
  readonly tone: ToneHint;
  readonly cues: readonly string[];
}

/** The cue table — the ONLY place a tone word lives. Order is irrelevant: exactly one family must match. */
export const TONE_FAMILIES: readonly ToneFamily[] = [
  { tone: "SOFTER", cues: ["부드럽", "부드러", "친절하", "친근하", "따뜻하", "덜 딱딱"] },
  { tone: "MORE_FORMAL", cues: ["정중", "격식", "공손", "예의 바르", "격식 있"] },
  { tone: "SHORTER", cues: ["짧게", "짧은", "간결", "간단하게", "줄여", "짧아"] },
];

/** A sentence that asks to READ or LIST something is never a revision, whatever tone word it also carries. */
const READ_CUES = ["보여", "목록", "정리해", "확인해", "찾아", "알려", "몇 건", "몇건", "리뷰", "주문", "매출"];

/** The most characters a tone-revision sentence may have — longer sentences carry more than a style. */
const TONE_SENTENCE_MAX = 40;

/**
 * The tone the sentence asks for, when it asks for exactly one and nothing else. `null` ⇒ the planner's.
 * Callers gate this on a draft being on the table; the function itself knows nothing about state.
 */
export function toneIntentOf(text: string): ToneHint | null {
  const t = text.trim();
  if (t.length === 0 || t.length > TONE_SENTENCE_MAX) return null;
  if (READ_CUES.some((cue) => t.includes(cue))) return null;
  const matched = TONE_FAMILIES.filter((f) => f.cues.some((cue) => t.includes(cue)));
  return matched.length === 1 ? matched[0]!.tone : null;
}

const ORDINAL_WORD: Record<string, number> = {
  "첫": 1, "두": 2, "세": 3, "네": 4, "다섯": 5, "여섯": 6, "일곱": 7, "여덟": 8, "아홉": 9, "열": 10,
};

/**
 * The whole sentence is an ordinal + an optional object noun + an optional particle — and, since
 * Conversation UX v2, an optional VIEWING verb (「두 번째 거 자세히 보여줘」). Asking to see the row one
 * named is still a selection: before this, the trailing verb made the sentence the planner's, and the
 * planner re-read the org queue and printed the whole list again under a 「선택한 문의」 card — PO QA read
 * that as 「선택해도 본문이 바로 보이지 않는다」. An ordinal with an ACTION verb (답변 준비·보내·말투) is
 * still the planner's: the tail below is a closed viewing family and nothing else matches it.
 */
const ORDINAL_SENTENCE = /^(첫|두|세|네|다섯|여섯|일곱|여덟|아홉|열|[1-9]\d?)\s*번째\s*(거|것|문의|리뷰|건)?\s*(요|이요|은|는|을|를|이|가)?\s*(자세히)?\s*(봐\s?줘요?|봐\s?주세요|보여\s?줘요?|보여\s?주세요|볼래요?|볼게요?|보자|열어\s?줘요?|확인해\s?줘요?|확인해\s?주세요)?\s*[.!?]?$/u;

/** 1-based position when the sentence is a bare ordinal selection; `null` otherwise. */
export function ordinalSelectionOf(text: string): number | null {
  const m = ORDINAL_SENTENCE.exec(text.trim());
  if (!m) return null;
  const word = m[1]!;
  const index = ORDINAL_WORD[word] ?? Number.parseInt(word, 10);
  return Number.isFinite(index) && index >= 1 ? index : null;
}
