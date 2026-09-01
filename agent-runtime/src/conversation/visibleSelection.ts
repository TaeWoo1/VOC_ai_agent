/**
 * Deterministic selection over the VISIBLE working set (Agent Interaction Model v2 §2/§4).
 *
 * The seller looks at the rows the previous turn showed and names one of them — 「배송 문의 봐줘」,
 * 「종이컵 문의」, 「네이버 배송 문의」, 「배송 후 분실 건」. That is a SELECT/INSPECT over objects already
 * on the table, not a question about the business, so no planner runs and no org read happens here.
 *
 * <b>How a sentence is read — closed classes, never per-sentence branches.</b>
 * <ol>
 *   <li>The sentence must be selection-shaped: a noun phrase with an optional viewing verb at the end
 *       (봐줘 · 보여줘 · 자세히 …), and none of the closed EXCLUDE cues that mean it asks for an action,
 *       a list, or a filter (답변 · 준비 · 목록 · 전부 · 관련 …). Anything else is the planner's.</li>
 *   <li>Its content words become constraints: a channel name (closed 3-channel map), a topic family
 *       (the SAME closed table the workload filter uses — no third copy), and literal tokens matched
 *       against the rows' own title/product text. Every named constraint must hold on a row.</li>
 *   <li>A literal token that matches NO row means the seller named something outside the visible set —
 *       the lane declines (NONE) and the planner answers, instead of guessing.</li>
 * </ol>
 *
 * Exactly one row ⇒ SELECTED. Several ⇒ AMBIGUOUS with the matching rows, never a silent pick.
 * None ⇒ NONE (the planner's). The ids returned are the rows' own — a model never invents one.
 */
import { TOPIC_WORDS } from "../operator/tools/inquiryWorkload";
import type { WorkloadTopic } from "../operator/tools/inquiryWorkload";
import { namesContent } from "./reference";

export interface VisibleRow {
  readonly id: string;
  readonly title: string | null;
  readonly productName: string | null;
  readonly channelCode: string | null;
  readonly channelNameKo: string | null;
}

export type VisibleSelection =
  | { readonly kind: "SELECTED"; readonly id: string }
  | { readonly kind: "AMBIGUOUS"; readonly ids: readonly string[] }
  | { readonly kind: "NONE" };

/** The seller-visible channel set — the same three the product shows (`ProductChannels`). */
const CHANNEL_WORDS: ReadonlyArray<{ readonly code: string; readonly words: readonly string[] }> = [
  { code: "NAVER", words: ["네이버", "스마트스토어"] },
  { code: "COUPANG", words: ["쿠팡"] },
  { code: "CAFE24", words: ["카페24", "카페이십사", "자사몰"] },
];

/**
 * A sentence carrying one of these is NOT a selection: it asks for an action (the PREPARE/SEND lanes),
 * a list or filter (the planner's QuerySpec), or something else entirely. Deliberately broad — a missed
 * selection falls to the planner, which is the safe direction.
 */
const EXCLUDE_CUES: readonly string[] = [
  "답변", "답장", "준비", "초안", "보내", "전송", "승인", "등록", "저장", "말투", "부드럽", "짧게", "정중",
  "목록", "전부", "모두", "관련", "정리", "요약", "몇 건", "몇건", "개만", "건만", "리스트",
  "주문", "매출", "알려", "찾아", "검색", "수집", "몇 개", "몇개", "왜",
];

/** The viewing verb a selection sentence may end with. Optional — a bare noun phrase also selects. */
export const SELECT_TAIL = /(봐\s?줘요?|봐\s?주세요|보여\s?줘요?|보여\s?주세요|볼래요?|볼게요?|보자|열어\s?줘요?|열어\s?봐|자세히(\s?(봐줘|보여줘|볼래))?|확인해\s?줘요?|확인해\s?볼래|확인해\s?주세요)\s*[.!]?$/u;

/**
 * The object noun the phrase may carry (dropped from matching): 문의 · 건 · 거 · 것 — and, since
 * Conversation Contract Correctness v2, every other word class that POINTS instead of naming.
 *
 * <b>Why this became a shared table.</b> 「배송이 너무 늦습니다 이거 보여줘」 quotes a row's own subject
 * line and points at it. 이거 was not in the private list here, so it became a literal every row had to
 * contain; no row did, the lane declined, and the planner answered by re-printing the whole list. The
 * seller named exactly one row and got fifteen. A demonstrative refers to what is already on the table;
 * it can never be a constraint on it — `conversation/reference.ts` owns that judgement for every lane.
 */
const OBJECT_NOUNS = new Set(["문의", "문의건", "거", "것", "건", "내용"]);

/** Trailing single-syllable particles stripped from a token when what remains is still a word. */
const PARTICLES = ["은", "는", "이", "가", "을", "를", "도", "만", "요"];

const MAX_SELECTION_CHARS = 30;
const AMBIGUOUS_MAX = 3;

function stripParticle(token: string): string {
  for (const p of PARTICLES) {
    if (token.length >= 3 && token.endsWith(p)) return token.slice(0, -1);
  }
  return token;
}

function normalize(text: string | null | undefined): string {
  return (text ?? "").toLowerCase();
}

/** The topic families the sentence names — read from the SAME closed table the workload filter uses. */
function topicsOf(text: string): WorkloadTopic[] {
  return (Object.keys(TOPIC_WORDS) as WorkloadTopic[])
    .filter((t) => t !== "OTHER")
    .filter((t) => TOPIC_WORDS[t].some((w) => text.includes(w.toLowerCase())));
}

function rowMatchesTopic(topic: WorkloadTopic, row: VisibleRow): boolean {
  const haystack = `${normalize(row.title)}\n${normalize(row.productName)}`;
  return TOPIC_WORDS[topic].some((w) => haystack.includes(w.toLowerCase()));
}

/**
 * The row(s) the sentence points at inside the visible set — or NONE when the sentence is not a
 * selection, names nothing the set holds, or names something the set cannot distinguish.
 */
export function visibleSelectionOf(text: string, rows: readonly VisibleRow[]): VisibleSelection {
  const t = text.trim();
  if (t.length === 0 || t.length > MAX_SELECTION_CHARS || rows.length === 0) return { kind: "NONE" };
  const lower = t.toLowerCase();
  if (EXCLUDE_CUES.some((cue) => lower.includes(cue.toLowerCase()))) return { kind: "NONE" };

  // The noun phrase = the sentence minus its viewing verb. A verb is optional; a question is never a selection.
  if (/[?？]\s*$/.test(t)) return { kind: "NONE" };
  const phrase = t.replace(SELECT_TAIL, "").trim();
  if (phrase.length === 0) return { kind: "NONE" };

  const phraseLower = phrase.toLowerCase();
  const channels = CHANNEL_WORDS.filter((c) => c.words.some((w) => phraseLower.includes(w.toLowerCase())));
  if (channels.length > 1) return { kind: "NONE" };
  const channel = channels[0] ?? null;
  const topics = topicsOf(phraseLower);

  // Literal tokens: what remains once channel words, topic words, object nouns and particles are removed.
  const consumed = new Set<string>([
    ...(channel ? channel.words : []),
    ...topics.flatMap((topic) => TOPIC_WORDS[topic] as string[]),
  ].map((w) => w.toLowerCase()));
  const literals = phrase
    .split(/[\s,·]+/)
    .map((token) => stripParticle(token.trim()))
    .filter((token) => token.length >= 2)
    .map((token) => token.toLowerCase())
    .filter((token) => !OBJECT_NOUNS.has(token) && namesContent(token))
    .filter((token) => !consumed.has(token) && ![...consumed].some((w) => token.includes(w)));

  // Nothing named at all (「문의 봐줘」) is not a selection over the set — the planner decides what it is.
  if (!channel && topics.length === 0 && literals.length === 0) return { kind: "NONE" };

  // A literal that matches NO row names something outside the set: decline rather than guess.
  const rowText = (row: VisibleRow) => `${normalize(row.title)}\n${normalize(row.productName)}`;
  for (const literal of literals) {
    if (!rows.some((row) => rowText(row).includes(literal))) return { kind: "NONE" };
  }

  const matched = rows.filter((row) => {
    if (channel && (row.channelCode ?? "").toUpperCase() !== channel.code) return false;
    if (topics.length > 0 && !topics.every((topic) => rowMatchesTopic(topic, row))) return false;
    return literals.every((literal) => rowText(row).includes(literal));
  });
  if (matched.length === 1) return { kind: "SELECTED", id: matched[0]!.id };
  if (matched.length >= 2) return { kind: "AMBIGUOUS", ids: matched.slice(0, AMBIGUOUS_MAX).map((r) => r.id) };
  return { kind: "NONE" };
}

/**
 * 「이 문의」 / 「이 고객」 / 「아까 그 문의」 / 「이 문의 자세히」 — the anchored object, inspected. True only
 * when the WHOLE sentence is the pronoun phrase (optionally with a viewing verb); a pronoun inside a
 * longer request (「이 고객한테 뭐라고 답하면 좋을까」) belongs to the lane that owns that request.
 */
const PRONOUN_INSPECT = /^(이|아까\s?그|그|방금\s?그) ?(문의|고객|건|거)( ?(내용|상세))? ?(자세히)? ?(봐\s?줘요?|보여\s?줘요?|볼래|볼게|확인해\s?줘요?)? ?[.!]?$/u;

export function pronounInspectOf(text: string): boolean {
  return PRONOUN_INSPECT.test(text.trim());
}

/**
 * 「답변 준비해줘」 / 「초안 만들어줘」 said while ONE inquiry is the anchor — an INSTRUCTION to produce
 * the draft through the product's own draft path, with no planner (Agent Interaction Model v2 §13).
 * Closed cues; a sentence that also draws a list (「답변 안 한 문의만 보여줘」) or names a different
 * object is the planner's.
 *
 * <b>Advisory questions are NOT here.</b> 「뭐라고 답하면 좋을까」 / 「어떻게 답하지」 ask for advice
 * about the object and belong to the ANALYZE lane (`taskInterpreter.analyzeIntentOf`) — only the
 * imperative families below are subject to the actionability gate (Conversation Core v1).
 */
const PREPARE_CUES = [
  /답변\s?(준비|작성|만들|달아|써)/u,
  /답\s?(해\s?줘|해줘|을\s?준비)/u,
  /초안\s?(준비|만들|작성|써)/u,
];
// A sentence that names ANOTHER object (an ordinal, a channel, a topic word) is a targeted PREPARE —
// the planner's `target` rules resolve it against the shown list; this lane only serves the anchor.
const PREPARE_EXCLUDES = [
  "보여", "목록", "몇", "만 ", "말투", "부드럽", "짧게", "정중", "보내자", "전송", "승인",
  "번째", "네이버", "쿠팡", "카페24", "배송 문의", "반품 문의", "교환 문의", "리뷰",
];
const PREPARE_MAX_CHARS = 40;

export function prepareIntentOf(text: string): boolean {
  const t = text.trim();
  if (t.length === 0 || t.length > PREPARE_MAX_CHARS) return false;
  if (PREPARE_EXCLUDES.some((cue) => t.includes(cue))) return false;
  return PREPARE_CUES.some((re) => re.test(t));
}
