/**
 * Two times, and they are not the same fact.
 *
 * <b>Why this file exists.</b> On 2026-08-23 the same question — "답변이 필요한 문의를 우선순위대로
 * 정리해줘" — was run twice against the same data. In one run the planner named no period and the
 * Operator reported the unanswered total; in the other it named "오늘" as a `PERIOD` mention and the
 * scope gate withheld the SAME true number as `TEMPORAL_UNPROVEN`, because the inbox count carried no
 * date. A seller therefore got a fact or an apology depending on a word the planner chose. Record:
 * `docs/agent_real_validation_v1.md` §10.4.
 *
 * <b>The fix is not a date stamp.</b> Writing today onto the inbox count would have made both runs
 * answer — and would have made the count assert something it does not know. `unansweredInquiries` is
 * the depth of a queue right now; the inquiries in it may have arrived this morning or last March, and
 * the read cannot tell. Stamping it "today" turns "현재 미답변 69건" into "오늘 들어온 문의 69건",
 * which is the invented-precision failure this repository exists to refuse, only quieter.
 *
 * <b>So evidence carries two independent times.</b>
 *
 *  1. {@link EvidenceRef.asOf} — <b>when SellerOps looked</b>. Every live read has one, because a read
 *     always happens at a time. It proves freshness and nothing else.
 *  2. {@link EvidenceRef.events} — <b>when the underlying rows actually happened</b>, and only when the
 *     source can say. `null` means unknown. It never means "now", and it is never filled in from `asOf`.
 *
 * <b>And a need declares which of the two it needs.</b> A question about the state of things is
 * answered by a fresh observation; a question about what happened in a period is answered only by rows
 * whose own dates fall in a period. {@link temporalDemandOf} decides which from the need's KIND — a
 * field the planner already emits — rather than from Korean prose, so the answer does not move when the
 * planner rephrases.
 *
 * <b>Two devices, because one cannot do it.</b> The need-level demand here cannot tell a state claim
 * from an event claim when a finding has no need attached, and it never sees the sentence. So the rule
 * judge carries {@link assertsEventOccurrence}, which reads the CLAIM: a sentence that says something
 * happened in a period, resting only on evidence with no event range, is refused whatever the need
 * said. Same vocabulary, same module, two places — the shape `docs/sellerops_operator_graph_v2.md`
 * §2.1 established.
 */
import type { NeedKind } from "../plan/InvestigationPlan";

/**
 * The span the underlying rows cover. Either bound may be unknown; both unknown is not a range at all.
 *
 * A half-known range is still a range: an issue row that knows its last evidence date but not its first
 * has proven that something happened then, which is what an event demand asks for.
 */
export interface EventRange {
  readonly from: string | null;
  readonly to: string | null;
}

/** What a need requires of time. */
export type TemporalDemand =
  /** No period was named. Time is not part of what this need asked. */
  | "NONE"
  /** How things stand — a queue depth, a current attribute. A fresh observation answers it. */
  | "CURRENT_STATE"
  /** What happened within a period. Only rows with their own dates answer it. */
  | "PERIOD_EVENTS";

/**
 * What each need kind asks of time ONCE THE SELLER HAS NAMED A PERIOD.
 *
 * <b>Read the kind, not the sentence.</b> "오늘 미답변이 몇 건이야" and "오늘 몇 건 들어왔어" are the
 * same words away from each other in Korean and a mile apart in what would prove them; the planner has
 * already made the distinction by typing the first as `INQUIRY_VOLUME` (how deep is the queue) and the
 * second as… also `INQUIRY_VOLUME`. That is the honest limit of this table, and it is why the claim-side
 * check exists: this axis is deliberately the permissive one, and {@link assertsEventOccurrence} is
 * where an intake claim actually gets refused.
 *
 * The kinds mapped to `PERIOD_EVENTS` are the ones that are definitionally about occurrences — a repeat
 * is a count of things that happened, a history is a list of them. Nothing about the current state of a
 * product or a queue is in that group.
 */
const DEMAND_OF: Record<NeedKind, TemporalDemand> = {
  INQUIRY_VOLUME: "CURRENT_STATE",
  PRODUCT_FACT: "CURRENT_STATE",
  // What the catalogue holds NOW. A registered product is a standing thing, not an event on a date.
  PRODUCT_CATALOG: "CURRENT_STATE",
  PRODUCT_LISTING: "CURRENT_STATE",
  PRODUCT_VARIANT: "CURRENT_STATE",
  // What the seller wrote about the product is a standing description, not something that happened
  // on a date. Typing it as PERIOD_EVENTS would make "지난주 사용법 알려줘" demand a passage dated
  // last week, which no library has.
  PRODUCT_KNOWLEDGE_DOC: "CURRENT_STATE",
  POLICY: "CURRENT_STATE",
  COMPANY_PROFILE: "CURRENT_STATE",
  // A remembered answer is dated by when it was sent; the need itself asks for what was said, not for a window.
  PAST_ANSWER: "CURRENT_STATE",
  REPEAT_PATTERN: "PERIOD_EVENTS",
  REVIEW_SIGNAL: "PERIOD_EVENTS",
  // An opportunity is what can be done NOW about a problem; the evidence behind it carries its own span.
  IMPROVEMENT_OPPORTUNITY: "CURRENT_STATE",
  CUSTOMER_HISTORY: "PERIOD_EVENTS",
  ORDER_HISTORY: "PERIOD_EVENTS",
};

/**
 * What this need requires of time.
 *
 * With no period named, `NONE`: the seller did not ask about time, so withholding an undated row would
 * be this component inventing a requirement — the "기간 기본값" that is explicitly not being added.
 */
export function temporalDemandOf(kind: NeedKind, periodNamed: boolean): TemporalDemand {
  if (!periodNamed) return "NONE";
  return DEMAND_OF[kind] ?? "CURRENT_STATE";
}

/** True when this evidence can say when the underlying rows happened. */
export function hasEventTime(events: EventRange | null): boolean {
  return events != null && (events.from != null || events.to != null);
}

/**
 * An event range from a source's own first/last dates. Returns `null` when it has neither.
 *
 * <b>Never derived from the query.</b> Asking for a 30-day window does not prove any row fell inside it;
 * only the rows' own dates do. A range built from the request would be the observation time wearing a
 * different name, which is the exact substitution this module exists to prevent.
 */
export function eventRange(from: string | null, to: string | null): EventRange | null {
  if (from == null && to == null) return null;
  return { from, to };
}

/** A single-dated event — a past case, a review, one occurrence. */
export function eventOn(date: string | null): EventRange | null {
  return eventRange(date, date);
}

/** The digest token for a range. Dots and hyphens only, so the backend's value charset admits it. */
export function eventRangeToken(events: EventRange): string {
  return `${events.from ?? "unknown"}..${events.to ?? "unknown"}`;
}

/**
 * Period words a seller writes.
 *
 * Deliberately short and literal. A missed word here means the claim rule stays quiet, which leaves the
 * need-level axis and the coverage rules as they were — the same failure direction the rest of this
 * package takes.
 */
const PERIOD_WORDS = [
  "오늘", "어제", "이번 주", "이번주", "금주", "지난주", "지난 주",
  "이번 달", "이번달", "이달", "지난달", "지난 달", "최근", "동안", "기간",
] as const;

/**
 * Words that say something HAPPENED, as opposed to something IS.
 *
 * "있습니다" is not here and must never be: "미답변이 69건 있습니다" is a statement about the present
 * state of a queue, and it is TRUE of a snapshot. "들어왔습니다" is a statement about arrival, and a
 * snapshot cannot prove it. That single distinction is what this whole list is for.
 */
const OCCURRENCE_WORDS = [
  "들어온", "들어왔", "들어옵", "유입", "발생한", "발생했", "발생돼", "접수된", "접수됐", "접수돼",
  "등록된", "등록됐", "올라온", "작성된", "도착한", "생긴", "반복됐", "반복된", "반복되",
] as const;

/**
 * Does this sentence claim that something happened inside a period?
 *
 * Both halves are required. A period word alone is often just context ("최근 상태"), and an occurrence
 * word alone makes no claim about when. Together they assert an intake — the one claim a snapshot must
 * never be allowed to support.
 */
export function assertsEventOccurrence(statement: string): boolean {
  return PERIOD_WORDS.some((w) => statement.includes(w))
    && OCCURRENCE_WORDS.some((w) => statement.includes(w));
}

/** The seller's calendar. A Korean seller's 「오늘」 is a KST day; a UTC day would end at 09:00 for them. */
const SELLER_TIME_ZONE = "Asia/Seoul";

/** The observation date for a run: the caller's reference date, or the seller's day the read happens on. */
export function observationDate(referenceDate?: string | null): string {
  if (referenceDate) return referenceDate;
  // en-CA formats as YYYY-MM-DD, which is the only reason that locale is named here.
  return new Intl.DateTimeFormat("en-CA", { timeZone: SELLER_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date());
}
