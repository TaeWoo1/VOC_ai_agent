/**
 * Scope override by PLAN FIELDS — the two cases where 「WORKING_SET」 cannot mean what the planner said.
 *
 * <b>No keyword is read.</b> The planner marks a sentence as a follow-up over the previous set; this
 * function only checks whether that set can carry the follow-up: a set with nothing in it cannot be
 * filtered, and a sentence that names a DIFFERENT period is asking a new question of the org, not a
 * narrower one of the rows on screen (R7: 「오늘」 with 0 rows, then 「지난 7일」 planned as a
 * follow-up answered 「방금 본 0건 중 0건」 instead of the 23 rows the week held). Both are closed
 * tokens on the plan and the set; the override is logged with its reason.
 */
import type { InvestigationPlan } from "./InvestigationPlan";
import { conversationAxisOf } from "./InvestigationPlan";
import type { WorkingSetView } from "../../conversation/contract";
import { log } from "../../log";

export type ScopeOverrideReason = "NEW_PERIOD" | "EMPTY_SET" | "NEW_LIMIT";

export function scopeOverrideOf(
  plan: InvestigationPlan, workingSet: WorkingSetView | null,
): ScopeOverrideReason | null {
  const { filters } = conversationAxisOf(plan);
  if (filters.scope !== "WORKING_SET") return null;
  if (!workingSet) return "EMPTY_SET";
  // A new period is the stronger reading and is checked first: a sentence naming another period is a
  // new question whatever the previous set held (or did not).
  const previous = workingSet.filters.period?.token ?? null;
  if (filters.period != null && previous != null && filters.period !== previous) return "NEW_PERIOD";
  // A row count LARGER than the set on screen cannot be a refine of it — filtering 5 rows can never
  // show 8 (Agent Interaction Model v2, found live: an anchored thread turned 「최근 문의 8개 보여줘」
  // into 「방금 본 5건 중 5건」). A limit within the set stays a refine (「그중 3개만」).
  if (filters.limit != null && workingSet.kind !== "ORDERS" && filters.limit > workingSet.ids.length) return "NEW_LIMIT";
  // An ORDERS set holds no ids by nature — its anchor is its window and channel, so "empty" does not apply.
  if (workingSet.kind !== "ORDERS" && workingSet.ids.length === 0 && workingSet.workItemIds.length === 0) return "EMPTY_SET";
  return null;
}

/** The plan's conversation axis with the override applied. Logs once when asked to. */
export function effectiveAxisOf(
  plan: InvestigationPlan, workingSet: WorkingSetView | null, emitLog = false,
): ReturnType<typeof conversationAxisOf> {
  const axis = conversationAxisOf(plan);
  const reason = scopeOverrideOf(plan, workingSet);
  if (!reason) return axis;
  if (emitLog) log("operator_scope_override", { from: "WORKING_SET", to: "ORG", reason });
  return { ...axis, filters: { ...axis.filters, scope: "ORG" } };
}
