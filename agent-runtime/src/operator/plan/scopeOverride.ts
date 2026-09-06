/**
 * Scope override by PLAN FIELDS — the two cases where 「WORKING_SET」 cannot mean what the planner said.
 *
 * <b>Four of the five read no keyword.</b> The planner marks a sentence as a follow-up over the previous
 * set; those four only check whether that set can carry the follow-up: a set with nothing in it cannot be
 * filtered, and a sentence that names a DIFFERENT period is asking a new question of the org, not a
 * narrower one of the rows on screen (R7: 「오늘」 with 0 rows, then 「지난 7일」 planned as a
 * follow-up answered 「방금 본 0건 중 0건」 instead of the 23 rows the week held). Both are closed
 * tokens on the plan and the set; the override is logged with its reason.
 *
 * <b>The fifth reads the sentence for one closed grammatical fact, and it is the rule this repository
 * already had</b> (Conversation Contract Correctness v2). `taskInterpreter.visibleFilterOf` has required
 * an explicit refine expression since Conversation Core v1 §9 — 「그중」·「여기서」·「~만」 on something that
 * can point at the rows — because "an explicit new-list request is a fresh ORG question and never a
 * narrowing of the rows on screen". The planner path had no such requirement and reached the opposite
 * conclusion on the same sentences: 「답변 안 한 문의 보여줘」, said after a topic list, was answered
 * 「방금 본 문의 중 배송 관련 답변 안 한 문의는 1건입니다」 — twelve inquiries answered with one. The
 * grammar is `conversation/reference.ts`'s, shared with the lane that has always applied it, and the
 * check is narrowed to plans that are a pure FILTER of the same domain: a follow-up that names no axis
 * at all (「상품별로 묶어줘」, 「문의에서도 같은 얘기 있어?」) is not a narrowing and is untouched.
 */
import type { InvestigationPlan, PlanFilters } from "./InvestigationPlan";
import { conversationAxisOf } from "./InvestigationPlan";
import type { WorkingSetView } from "../../conversation/contract";
import { hasRefineExpression, namesOwnObject } from "../../conversation/reference";
import { isAcquisitionRequest } from "../../conversation/acquisitionRequest";
import { subjectTermOf } from "../../conversation/subjectTerm";
import { issueSubjectOf } from "../../conversation/issueSubject";
import { log } from "../../log";

export type ScopeOverrideReason =
  | "NEW_PERIOD" | "EMPTY_SET" | "NEW_LIMIT" | "NEW_SUBJECT" | "NO_REFINE_EXPRESSION" | "ACQUISITION_REQUEST";

/**
 * What the SENTENCE says the question is about — the closed topic family the planner named and the
 * seller's own subject word the runtime read (`conversation/subjectTerm.ts`). Both are values, never
 * text to interpret; the caller supplies them because only it has the sentence.
 */
export interface SentenceSubject {
  readonly topic: PlanFilters["topic"];
  readonly term: string | null;
  /**
   * The repeated-problem NAME the sentence marked, when it marked one (`conversation/issueSubject.ts`).
   *
   * <p>Separate from {@link term} because the two narrow different corpora and their word tables differ
   * by design: 「문제」 is a subject marker on the issue memory and a customer's word on an inquiry row.
   * Read here, with the rest of the sentence, and carried as a value — never re-read downstream.
   */
  readonly issueName?: string | null;
}

/** Does the sentence name a subject, and is it a different one from the set's? */
/**
 * What the sentence says this question is about — the plan's topic token, and the seller's own word
 * only when no closed family holds it.
 *
 * <b>One definition, because there was nearly two.</b> The graph built this object inline and the
 * conversation service had its own copy of the same three lines; they agreed, and nothing made them.
 * It lives beside {@link SentenceSubject} so the type and the way it is built are one file.
 */
export function sentenceSubjectOf(plan: InvestigationPlan | null | undefined, text: string): SentenceSubject {
  const topic = plan?.filters?.topic && plan.filters.topic !== "OTHER" ? plan.filters.topic : null;
  return { topic, term: topic ? null : subjectTermOf(text), issueName: issueSubjectOf(text) };
}

function subjectChanged(subject: SentenceSubject | undefined, set: WorkingSetView): boolean {
  if (!subject) return false;
  const setTopic = set.filters.topic ?? null;
  const setTerm = set.filters.term ?? null;
  // A set with NO subject of its own can be narrowed by one — 「그중 배송 관련만」 is a real refine.
  if (setTopic == null && setTerm == null) return false;
  const asked = subject.topic ?? subject.term;
  if (asked == null) return false;
  return subject.topic != null ? subject.topic !== setTopic : subject.term !== setTerm;
}

/** Does this plan narrow by a FILTER axis at all? A grouping or cross-domain follow-up names none. */
function namesFilterAxis(filters: PlanFilters): boolean {
  return filters.channel != null || filters.status != null || filters.topic != null
    || filters.period != null || filters.rating != null || filters.limit != null;
}

export function scopeOverrideOf(
  plan: InvestigationPlan, workingSet: WorkingSetView | null, subject?: SentenceSubject,
  goalText?: string | null,
): ScopeOverrideReason | null {
  const { filters } = conversationAxisOf(plan);
  if (filters.scope !== "WORKING_SET") return null;
  if (!workingSet) return "EMPTY_SET";
  // <b>「그럼 최신화해줘」 is not a filter of the rows on screen.</b> An instruction to COLLECT is about the
  // channel, so reading it as a narrowing re-prints the same list and collects nothing — observed live
  // 2026-09-02: 「오늘 네이버 리뷰 있어?」 then 「그럼 최신화해줘」 answered 「방금 본 2건 중 리뷰는 2건입니다」.
  // Checked first because it contradicts the follow-up reading outright rather than qualifying it.
  if (goalText != null && isAcquisitionRequest(goalText, { reviewsInContext: workingSet.kind === "REVIEWS" })) {
    return "ACQUISITION_REQUEST";
  }
  // A set that IS 「파손 문의」 cannot be narrowed into 「교환 문의」: the two subjects are disjoint by
  // construction, so 「방금 본 문의 중 교환 관련은 없습니다」 is arithmetically true and operationally a
  // wrong answer — the seller asked the ORG a new question. Found live 2026-08-31.
  if (subjectChanged(subject, workingSet)) return "NEW_SUBJECT";
  // A new period is the stronger reading and is checked first: a sentence naming another period is a
  // new question whatever the previous set held (or did not).
  const previous = workingSet.filters.period?.token ?? null;
  if (filters.period != null && previous != null && filters.period !== previous) return "NEW_PERIOD";
  // A row count LARGER than the set on screen cannot be a refine of it — filtering 5 rows can never
  // show 8 (Agent Interaction Model v2, found live: an anchored thread turned 「최근 문의 8개 보여줘」
  // into 「방금 본 5건 중 5건」). A limit within the set stays a refine (「그중 3개만」).
  if (filters.limit != null && workingSet.kind !== "ORDERS" && filters.limit > workingSet.ids.length) return "NEW_LIMIT";
  // A narrowing that never SAID it was one is a new question of the org — checked after the reasons that
  // name a specific contradiction, so those keep their own name in the log.
  if (namesFilterAxis(filters) && goalText != null
      && namesOwnObject(goalText) && !hasRefineExpression(goalText)) return "NO_REFINE_EXPRESSION";
  // An ORDERS set holds no ids by nature — its anchor is its window and channel, so "empty" does not apply.
  if (workingSet.kind !== "ORDERS" && workingSet.ids.length === 0 && workingSet.workItemIds.length === 0) return "EMPTY_SET";
  return null;
}

/**
 * NEW_LIST semantics (Conversation Core v1 §9, PO QA 2026-08-31): a voided refine takes its BASE with it.
 *
 * The planner marked the turn a follow-up over the previous set, so its filter axes are that set's own
 * axes (the base it believed it was narrowing) plus whatever the sentence added. When NEW_PERIOD or
 * NEW_LIMIT proves the turn a NEW question of the org, the base must not survive into the fresh read:
 * every axis whose value EQUALS the set's is inherited, not asked for, and is dropped — an axis the
 * sentence actually named either differs from the base or was never on it. Live 2026-08-31: an anchored
 * NAVER/UNANSWERED set turned 「최근 문의 7개 보여줘」 into 「네이버 답변 안 한 가장 최근 7건」 —
 * NEW_LIMIT flipped the scope to ORG but the inherited channel and status rode into the org read.
 *
 * EMPTY_SET keeps the axes: there the sentence IS a refine (the planner read narrowing words) and the
 * inherited frame — 「오늘」, a channel — is the seller's own earlier question, not contamination; only
 * the empty set cannot carry it. Closed-token equality; no sentence is read.
 */
function inheritedAxesDropped(filters: PlanFilters, set: WorkingSetView): PlanFilters {
  const base = set.filters;
  return {
    ...filters,
    period: filters.period != null && filters.period === (base.period?.token ?? null) ? null : filters.period,
    channel: filters.channel != null && filters.channel === (base.channelCode ?? "").toUpperCase() ? null : filters.channel,
    status: filters.status != null && filters.status === (base.status ?? null) ? null : filters.status,
    topic: filters.topic != null && filters.topic === (base.topic ?? null) ? null : filters.topic,
    rating: filters.rating != null && filters.rating === (base.rating ?? null) ? null : filters.rating,
  };
}

/** The plan's conversation axis with the override applied. Logs once when asked to. */
export function effectiveAxisOf(
  plan: InvestigationPlan, workingSet: WorkingSetView | null, emitLog = false, subject?: SentenceSubject,
  goalText?: string | null,
): ReturnType<typeof conversationAxisOf> {
  const axis = conversationAxisOf(plan);
  const reason = scopeOverrideOf(plan, workingSet, subject, goalText);
  if (!reason) return axis;
  if (emitLog) log("operator_scope_override", { from: "WORKING_SET", to: "ORG", reason });
  const voided: readonly ScopeOverrideReason[] = ["NEW_LIMIT", "NEW_PERIOD", "NEW_SUBJECT", "NO_REFINE_EXPRESSION"];
  const filters = voided.includes(reason) && workingSet
    ? inheritedAxesDropped(axis.filters, workingSet)
    : axis.filters;
  return { ...axis, filters: { ...filters, scope: "ORG" } };
}
