/**
 * Conversation Core v1 — the ConversationTask contract and its DETERMINISTIC interpreters.
 *
 * <b>Why this file exists.</b> PO QA (2026-08-31) found two convergence defects: a semantic FILTER over
 * the visible set (「배송 관련 문의만 봐줘」) re-ran the previous read and printed the same rows, and an
 * ADVISORY question over the selected inquiry (「이 고객한테 뭐라고 답하면 좋을까?」) was read as
 * PREPARE_REPLY and refused by the actionability gate. Both are the same missing distinction: the
 * conversation had workflow intents but no task vocabulary — what the seller wants DONE (mode) and what
 * they want it done TO (scope) were inferred per-lane instead of decided once.
 *
 * <b>The contract.</b> A turn is one {@link ConversationTask}:
 *   mode  = ANSWER | LIST | FILTER | INSPECT | ANALYZE | PREPARE | REVISE | EXECUTE
 *   scope = ORG | VISIBLE_SET | SELECTED_ENTITY
 * plus verified target refs, closed filters, and the seller's own sentence as the goal. Only INSPECT /
 * FILTER / ANALYZE / PREPARE / REVISE over objects ALREADY on the table are decided here, from closed
 * vocabularies — everything else (ANSWER, LIST, org-scoped FILTER, EXECUTE routing) stays the LLM
 * planner's, exactly as `sellerops_operator_graph_v2.md` requires. No per-sentence branch: every rule
 * below is a closed table (cue families, the SAME `TOPIC_WORDS` the workload filter uses, the product's
 * 3-channel map), and a sentence any table cannot fully consume falls through to the planner.
 *
 * <b>The actionability gate belongs to PREPARE/EXECUTE only.</b> ANALYZE is advice about an object —
 * an already-answered inquiry is a perfectly good subject for 「뭐라고 답하면 좋을까」; what it cannot
 * take is a new draft, and only the sentence that ASKS for one is told so.
 */
import { TOPIC_WORDS } from "../operator/tools/inquiryWorkload";
import type { WorkloadTopic } from "../operator/tools/inquiryWorkload";
import { subjectTermOf, usableTerm } from "./subjectTerm";

export type TaskMode = "ANSWER" | "LIST" | "FILTER" | "INSPECT" | "ANALYZE" | "PREPARE" | "REVISE" | "EXECUTE";
export type TaskScope = "ORG" | "VISIBLE_SET" | "SELECTED_ENTITY";

/** The closed filter axes a deterministic FILTER may carry — a subset of the planner's `PlanFilters`. */
export interface VisibleFilter {
  readonly channel: "NAVER" | "COUPANG" | "CAFE24" | null;
  readonly topic: WorkloadTopic | null;
  /**
   * The seller's own subject word, when the sentence narrowed by one the closed topic families do not
   * hold (「그중 현금영수증만」). Matched literally against the rows on screen — a word that matches no
   * row answers 「…는 없습니다」, which is the truth about the visible set and never a silent widening.
   */
  readonly term: string | null;
  readonly status: "UNANSWERED" | "ANSWERED" | null;
  readonly limit: number | null;
  readonly order: "NEWEST" | "OLDEST" | null;
  /** PRIORITIZE over the rows on screen: order them by how long the customer has waited. */
  readonly urgency: boolean;
}

/** The seller's word for each topic family — the FILTER lane's honest label for what it narrowed by. */
export const TOPIC_LABEL: Record<WorkloadTopic, string> = {
  SHIPPING: "배송 관련",
  EXCHANGE_RETURN: "교환·반품 관련",
  PRODUCT_SPEC: "규격 관련",
  USAGE: "사용법 관련",
  OTHER: "기타",
};

/* ───────────────────────────── ANALYZE — advisory cues ─────────────────────────────
 *
 * A question about HOW to respond, not an instruction to produce the draft. Closed families; the
 * caller gates on an anchored (selected) inquiry. For a DRAFTABLE anchor the best advice IS a draft
 * and the caller may prepare one; for a non-draftable anchor the lane advises from the seller's own
 * knowledge instead of refusing — that difference is the caller's, not this table's.
 */
const ANALYZE_CUES: readonly RegExp[] = [
  /뭐라고\s?(답|답변|답장|말|보내|하)/u,
  /어떻게\s?(답|답변|대응|응대|말)/u,
  /(답변|대응|응대)\s?방향/u,
  /뭐라\s?(답|하)/u,
];
/** A sentence that also asks to LIST, REVISE or SEND is not an advisory question. */
const ANALYZE_EXCLUDES = ["보여", "목록", "번째", "말투", "부드럽", "짧게", "정중", "보내자", "전송", "승인", "준비해"];
const ANALYZE_MAX_CHARS = 60;

export function analyzeIntentOf(text: string): boolean {
  const t = text.trim();
  if (t.length === 0 || t.length > ANALYZE_MAX_CHARS) return false;
  if (ANALYZE_EXCLUDES.some((cue) => t.includes(cue))) return false;
  return ANALYZE_CUES.some((re) => re.test(t));
}

/* ───────────────────────────── PRIORITIZE — which of these first ─────────────────────────────
 *
 * 「가장 시급한 건」 · 「급한 것부터」 · 「뭐부터 봐야 해」 — a question about ORDER, not about which rows
 * exist. Over rows already on screen it is answered with no read and no model call; over the org it is
 * the planner's `inquiryIntent=PRIORITY`. The criterion (waiting time) is stated by the answer itself —
 * see `conversation/urgency.ts` for why there is exactly one.
 */
const URGENCY_CUES: readonly RegExp[] = [
  /시급/u,
  /급한\s?(것|거|건|순)/u,
  /(먼저|우선|제일\s?먼저)\s?(볼|봐야|처리|해야|하는)/u,
  /(뭐|무엇|어떤\s?것?)\s?부터/u,
  /우선순위/u,
];
/** A sentence that also asks to draft, send or open something is not a ranking question. */
const URGENCY_EXCLUDES = ["준비", "초안", "보내", "전송", "승인", "말투", "번째", "화면"];
const URGENCY_MAX_CHARS = 50;

/**
 * Words that give a sentence a scope of its OWN. 「미응답 문의 중 가장 시급한 건?」 asks about the org's
 * unanswered queue, not about whatever rows happen to be on screen — answering it from the visible set
 * would silently narrow the question, which is the defect this whole package exists to close.
 */
const OWN_SCOPE_WORDS = [
  "네이버", "스마트스토어", "쿠팡", "카페24", "자사몰",
  "미답변", "미응답", "답변 안", "답변안", "무응답", "답변한", "답변함",
  "오늘", "어제", "이번 주", "이번주", "지난주", "최근", "전체", "전부", "모든",
];

/**
 * Is this ranking question about the rows the seller is LOOKING AT? True when the sentence points back
 * at them (「그중」·「여기서」·「방금 본」) or names no scope of its own. Otherwise the planner answers it.
 */
export function visiblePriorityOf(text: string): boolean {
  if (!priorityIntentOf(text)) return false;
  if (/그중|이\s?중|여기서|방금\s?본|중에서/u.test(text)) return true;
  return !OWN_SCOPE_WORDS.some((w) => text.includes(w));
}

/** Does this sentence ask which of the things on the table to do FIRST? */
export function priorityIntentOf(text: string): boolean {
  const t = text.trim();
  if (t.length === 0 || t.length > URGENCY_MAX_CHARS) return false;
  if (URGENCY_EXCLUDES.some((cue) => t.includes(cue))) return false;
  return URGENCY_CUES.some((re) => re.test(t));
}

/* ───────────────────────────── FILTER — a refine of the visible set ─────────────────────────────
 *
 * 「배송 관련 문의만」 · 「네이버 것만」 · 「답변 안 한 것만」 · 「그중 최근 2개」 — and their combinations.
 * The parse is consume-everything: closed axis vocabularies (channel / topic / status / limit / order)
 * plus closed filler words must account for EVERY content token, or the sentence is not this lane's
 * (a leftover token means the seller said something these tables cannot read — the planner's job).
 * At least one axis must be named; a bare 「보여줘」 filters nothing. And the sentence must SAY it is
 * a refine — 「~만」·「그중」·「중에서」·「여기서」·「방금 본」: an explicit new-list request
 * (「최근 문의 7개 보여줘」) is a fresh ORG question and never a narrowing of the rows on screen.
 */
const FILTER_CHANNELS: ReadonlyArray<{ readonly code: VisibleFilter["channel"] & string; readonly words: readonly string[] }> = [
  { code: "NAVER", words: ["네이버", "스마트스토어"] },
  { code: "COUPANG", words: ["쿠팡"] },
  { code: "CAFE24", words: ["카페24", "자사몰"] },
];

/** Sentences carrying these ask for something other than a narrowing of the rows on screen. */
const FILTER_EXCLUDES = [
  "준비", "초안", "보내", "전송", "승인", "등록", "저장", "말투", "부드럽", "정중",
  "주문", "매출", "정리", "요약", "왜", "뭐라고", "어떻게", "번째",
];

/** Status phrases, removed from the sentence as a span so 「답변 안 한」 never leaves 「답변」 behind. */
const UNANSWERED_RE = /(답변|답)\s?(안\s?(한|된)|않은|없는|못\s?한)|미답변|무응답/u;
const ANSWERED_RE = /답변\s?(한|된|완료된?|끝난)\s?(것|거|건)?|답변함/u;

/** 「N개」 「2건」 「한 개」 — the limit, with the count word consumed. */
const LIMIT_RE = /(\d{1,2}|한|두|세|네|다섯)\s?(개|건)\s?(만)?/u;
const COUNT_WORD: Record<string, number> = { 한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5 };
/**
 * The bare native numeral — 「하나만」 · 「둘만」. It is the same LIMIT axis said the short way, and it
 * belongs to no other: read as a leftover content word it became a SUBJECT, and 「그중 제일 오래된 거
 * 하나만」 was answered 「방금 본 문의 1건 중 하나 관련 문의는 없습니다」 (PO QA regression corpus, G12.4).
 */
const BARE_COUNT_RE = /(?:^|\s)(하나|둘|셋|넷|다섯)(?:\s?만)?(?=\s|$)/u;
const BARE_COUNT: Record<string, number> = { 하나: 1, 둘: 2, 셋: 3, 넷: 4, 다섯: 5 };

const ORDER_WORDS: ReadonlyArray<{ readonly order: NonNullable<VisibleFilter["order"]>; readonly words: readonly string[] }> = [
  { order: "NEWEST", words: ["최근", "최신"] },
  { order: "OLDEST", words: ["오래된", "오래전", "예전"] },
];

/** Words a filter sentence may carry that name nothing: markers, object nouns, viewing verbs. */
const FILTER_FILLERS = [
  "그중에서", "그중", "이중에서", "이 중에서", "중에서", "그 중", "여기서", "방금 본", "방금",
  "문의만", "문의들", "문의", "리뷰만", "리뷰", "관련된", "관련", "관한",
  "것만", "거만", "건만", "것들", "것", "거", "건", "내용",
  "보여주세요", "보여줘요", "보여줘", "보여 줘", "봐주세요", "봐줘요", "봐줘", "봐 줘", "볼래", "볼게", "보자",
  "추려줘", "골라줘", "걸러줘", "필터해줘", "주세요", "해줘", "줘",
  "가장", "제일", "좀", "다시", "만",
];
const FILTER_MAX_CHARS = 50;

/**
 * The deterministic FILTER a sentence asks for over the visible set — or null when the sentence is
 * not one (and the planner decides what it is). Zero model calls, zero reads.
 */
export function visibleFilterOf(text: string): VisibleFilter | null {
  const t = text.trim();
  if (t.length === 0 || t.length > FILTER_MAX_CHARS) return null;
  if (FILTER_EXCLUDES.some((cue) => t.includes(cue))) return null;
  if (/[?？]\s*$/.test(t)) return null;

  let rest = t.toLowerCase().replace(/[.,!·]/g, " ");

  // Status spans first — they contain words (답변) other rules must not see as leftovers.
  let status: VisibleFilter["status"] = null;
  if (UNANSWERED_RE.test(rest)) {
    status = "UNANSWERED";
    rest = rest.replace(UNANSWERED_RE, " ");
  } else if (ANSWERED_RE.test(rest)) {
    status = "ANSWERED";
    rest = rest.replace(ANSWERED_RE, " ");
  }

  let limit: number | null = null;
  const limitMatch = LIMIT_RE.exec(rest);
  if (limitMatch) {
    const parsed = COUNT_WORD[limitMatch[1]!] ?? Number.parseInt(limitMatch[1]!, 10);
    if (Number.isFinite(parsed) && parsed >= 1) {
      limit = parsed;
      rest = rest.replace(LIMIT_RE, " ");
    }
  }
  if (limit == null) {
    const bare = BARE_COUNT_RE.exec(rest);
    if (bare) {
      limit = BARE_COUNT[bare[1]!]!;
      rest = rest.replace(BARE_COUNT_RE, " ");
    }
  }

  // FILTER is a REFINE and only refine wording enters this lane (New-list Scope Integrity, PO QA
  // 2026-08-31): 「그중 최근 2개」 narrows the rows on screen; 「최근 문의 7개 보여줘」 asks the org a
  // new question and is the planner's, whatever axes it names. The marker is read AFTER the status
  // and limit spans are consumed, so the 만 of 「7개만」 (a count, not a narrowing) never counts —
  // only 「~만」 on a named thing (「네이버만」·「것만」), 「그중」·「중에서」·「여기서」·「방금 본」.
  if (!/만|그중|중에서|여기서|방금\s?본/u.test(rest)) return null;

  let order: VisibleFilter["order"] = null;
  for (const family of ORDER_WORDS) {
    for (const word of family.words) {
      if (rest.includes(word)) {
        order = family.order;
        rest = rest.split(word).join(" ");
      }
    }
  }

  let channel: VisibleFilter["channel"] = null;
  for (const ch of FILTER_CHANNELS) {
    for (const word of ch.words) {
      if (rest.includes(word.toLowerCase())) {
        if (channel && channel !== ch.code) return null; // two channels name a comparison, not a filter
        channel = ch.code;
        rest = rest.split(word.toLowerCase()).join(" ");
      }
    }
  }

  let topic: VisibleFilter["topic"] = null;
  for (const key of Object.keys(TOPIC_WORDS) as WorkloadTopic[]) {
    if (key === "OTHER") continue;
    for (const word of TOPIC_WORDS[key]) {
      if (rest.includes(word.toLowerCase())) {
        if (topic && topic !== key) return null; // two topics — the planner's question
        topic = key;
        rest = rest.split(word.toLowerCase()).join(" ");
      }
    }
  }

  // Everything the axis tables did not consume. ONE leftover word MAY be the SUBJECT the seller narrowed
  // by (「그중 현금영수증만」) — the axis the closed topic families cannot hold.
  //
  // <b>But a leftover is not evidence of a subject.</b> "these tables could not read this token" and
  // "the seller narrowed by this word" are different claims, and this lane used to treat the first as
  // the second: 「그중 제일 오래된 거 하나만」 left 하나 unconsumed and answered 「하나 관련 문의는
  // 없습니다」 — a narrowing by a word nobody said, in a lane whose stated failure direction is *no*
  // narrowing. So the leftover is promoted only when the SENTENCE MARKS it as the thing it narrows by:
  // the delimitative 만 on the word itself (「그중 현금영수증만」), or a subject marker the one extractor
  // that owns that question recognises (`subjectTerm.ts`). An unread token narrows nothing.
  for (const filler of FILTER_FILLERS) rest = rest.split(filler).join(" ");
  const leftovers = rest
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
  if (leftovers.length > 1) return null;
  const candidate = topic || leftovers.length === 0 ? null : usableTerm(leftovers[0]!);
  const lowered = t.toLowerCase();
  const marked = candidate != null
    && (lowered.includes(`${candidate}만`) || subjectTermOf(t) === candidate);
  const term = marked ? candidate : null;
  if (leftovers.length === 1 && !term) return null;

  if (!channel && !topic && !term && !status && limit == null && order == null) return null;
  // 「최근 5개」 alone: an order+limit refine. 「최근」 alone names no narrowing — decline.
  if (!channel && !topic && !term && !status && limit == null && order != null) return null;

  return { channel, topic, term, status, limit, order, urgency: false };
}
