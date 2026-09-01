/**
 * The SUBJECT the seller named — the axis the closed topic families could never carry.
 *
 * <b>The defect this closes.</b> A question's subject had exactly one representation: `filters.topic`,
 * a closed five-family enum (배송 · 교환반품 · 규격 · 사용법 · 기타). A seller who asks about 현금영수증,
 * 세금계산서, 파손, 색상 or A/S names a subject none of those families holds, so the planner had nothing
 * to put it in, the word was dropped, and 「현금영수증 관련 문의 중 가장 최근 문의」 was answered with the
 * org's newest inquiry — a *different* question, answered confidently. Patching the enum with one more
 * family would repeat the defect at the next word a seller says.
 *
 * <b>Deterministic, and the seller's own word.</b> Nothing here is a model call and nothing invents a
 * subject: the term is a literal substring of the sentence the seller typed, taken only when the
 * sentence marks it AS the subject — 「X 관련」·「X에 대한」·「X 문의」. Everything the query language
 * already has its own axis for (a channel, a period, an order, a status, a topic family) is refused
 * here, so a term never re-says a token, and a word the tables cannot vouch for produces `null` — the
 * behaviour before this file existed. The failure direction is "no narrowing", never "wrong narrowing".
 *
 * <b>What is done with it.</b> The rows read narrows on it (`GET /api/inquiries/rows?q=`, one bounded
 * LIKE over the subject line and the customer's message); the visible-set FILTER lane matches it against
 * the rows already on screen. Either way the answer SAYS the word it narrowed by, so a zero is a zero
 * about that subject and never a silent widening.
 */
import { TOPIC_WORDS } from "../operator/tools/inquiryWorkload";
import type { WorkloadTopic } from "../operator/tools/inquiryWorkload";
import { namesContent, stripParticles } from "./reference";

/** The longest word this accepts as a subject. A phrase is not a subject; it is declined, not cut. */
export const SUBJECT_TERM_MAX = 12;
const SUBJECT_TERM_MIN = 2;

/**
 * Words that already have their own axis, or that name no subject at all. A term equal to one of these
 * would either duplicate a token the spec carries or narrow by a word that means nothing on a row.
 */
const NOT_A_SUBJECT: ReadonlySet<string> = new Set([
  // channels — `filters.channel`
  "네이버", "스마트스토어", "쿠팡", "카페24", "자사몰",
  // order / period — `filters.order`, `filters.period`
  "최근", "최신", "요즘", "오래된", "오래전", "예전", "이전", "오늘", "어제", "그제", "이번주", "지난주",
  "이번달", "지난달", "금주", "당일",
  // status / work state — `filters.status`, the row's own group
  "미답변", "미응답", "답변", "무응답", "신규", "새로운", "대기", "처리", "완료", "진행",
  // objects and quantifiers the sentence is ABOUT, not narrowed by
  "고객", "구매자", "손님", "전체", "모든", "모두", "우리", "저희", "해당", "관련", "일반", "기타",
  "각종", "여러", "다른", "이런", "그런", "무슨", "어떤", "이번", "중요", "급한", "시급", "문제",
  "리뷰", "주문", "상품", "채널", "문의", "내용", "목록", "정리", "확인",
]);

/** Every word the closed topic families already own — those keep their axis (`filters.topic`). */
const TOPIC_OWNED: ReadonlySet<string> = new Set(
  (Object.keys(TOPIC_WORDS) as WorkloadTopic[]).flatMap((t) => TOPIC_WORDS[t].map((w) => w.toLowerCase())),
);

/** Trailing particles a captured noun may carry. Stripped only when a word remains. */
const PARTICLES = ["은", "는", "이", "가", "을", "를", "의", "에", "도", "만", "과", "와", "로"];

/**
 * The subject marker patterns. Each one requires the sentence itself to say that the captured span is
 * what the question is ABOUT; a bare leftover word is never promoted to a filter here.
 *
 * <b>The capture is a SPAN, not one token.</b> 「재입고 언제 되냐는 문의」 marks a subject grammatically,
 * and the token beside the marker is the relative clause's verb (되냐는) — read as the subject it became
 * `q=되냐`, which matched nothing and answered 「그런 문의는 없습니다」 about an inquiry that exists. The
 * modifier can be several tokens long, so the whole noun phrase is captured and {@link scanForSubject}
 * walks it.
 */
const SUBJECT_PATTERNS: readonly RegExp[] = [
  /((?:[^\s]+\s+){0,3}[^\s]{2,12})\s*에\s*(?:대한|관한|대해서?|관해서?)/gu,
  /((?:[^\s]+\s+){0,3}[^\s]{2,12})\s*(?:관련|관한|얘기|이야기)/gu,
  /((?:[^\s]+\s+){0,3}[^\s]{2,12})\s*(?:문의|질문|건들|건에|건은|건만)/gu,
];

/** Object nouns that END a noun phrase: a scan that reaches one has left the phrase it started in. */
const PHRASE_BOUNDARY: ReadonlySet<string> = new Set([
  "문의", "질문", "리뷰", "상품", "주문", "고객", "채널", "건", "것", "거",
]);

/**
 * The subject inside a marked noun phrase — the NEAREST content word to the head noun.
 *
 * <b>Nearest, because Korean puts the head last.</b> 「무선 청소기 관련 문의」 is about 청소기, not 무선;
 * 「케이블 커버에 전선 몇 가닥 들어가는지 물어본 문의」 is about 가닥, and everything between it and the
 * marker is the clause's predicate. So the walk goes right to left and takes the first token the shared
 * grammar accepts as content (`reference.ts`) — a verb form, an interrogative, a quantity or a word with
 * its own axis is stepped over, and a noun that closes a previous phrase stops the walk rather than
 * letting it reach into another clause. Nothing found ⇒ null, which is no narrowing.
 */
function scanForSubject(span: string): string | null {
  const tokens = span.trim().split(/\s+/).filter((t) => t.length > 0);
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const raw = tokens[i]!.toLowerCase();
    // The boundary test comes first and runs on the token with its particles removed: 「문의에서도」 is
    // the end of a previous noun phrase, and a scan that reads it as a noun has left the phrase the
    // marker opened — which is how 「문의에서도 비슷한 얘기 있어?」 acquired the subject 「문의에서」.
    if (PHRASE_BOUNDARY.has(stripParticles(raw))) return null;
    const term = usableTerm(raw);
    if (term) return term;
  }
  return null;
}

/** Is this word usable as a subject on its own? */
export function usableTerm(raw: string): string | null {
  let token = raw.trim().toLowerCase();
  // Reference · quantity · measure · interrogative · verb form — the classes that point, count or ask
  // instead of naming (`reference.ts`). One shared table, so 「하나」 cannot be a subject in one lane and
  // not another. Tested TWICE, and the first time matters: 는 is both a topic particle and the present
  // adnominal ending, so stripping it first would turn 되냐는 into the "noun" 되냐.
  if (!namesContent(token)) return null;
  for (const p of PARTICLES) {
    if (token.length >= SUBJECT_TERM_MIN + 1 && token.endsWith(p)) {
      token = token.slice(0, -1);
      break;
    }
  }
  if (token.length < SUBJECT_TERM_MIN || token.length > SUBJECT_TERM_MAX) return null;
  if (/^[\d,.\s]+$/.test(token)) return null;
  if (NOT_A_SUBJECT.has(token)) return null;
  // A word the topic families own keeps its own axis — two narrowings for one noun would be one
  // narrowing said twice, and the topic label is the one the seller reads back.
  if (TOPIC_OWNED.has(token) || [...TOPIC_OWNED].some((w) => token.includes(w))) return null;
  // …and again on what remains, so a reference word wearing a particle (「이거를」) is caught too.
  if (!namesContent(token)) return null;
  return token;
}

/**
 * The subject word this sentence names, or null. Never throws, never calls anything, never guesses:
 * the first marker that matches a usable word wins, and nothing else in the sentence is read.
 */
export function subjectTermOf(text: string | null | undefined): string | null {
  const t = (text ?? "").trim();
  if (t.length === 0) return null;
  for (const pattern of SUBJECT_PATTERNS) {
    // Every occurrence, not the first: 「최근 문의 중 현금영수증 문의」 marks two words as subjects and
    // only the second is one — reading the first and giving up would drop the sentence's real subject.
    for (const match of t.matchAll(pattern)) {
      const term = scanForSubject(match[1]!);
      if (term) return term;
    }
  }
  return null;
}
