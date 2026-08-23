/**
 * What the system already knows without being told — and the clarifications that are therefore not
 * clarifications.
 *
 * <b>Why this file exists.</b> On 2026-08-23, three of six live questions were answered with a question.
 * "반복해서 비슷한 문의가 들어오는 상품이 있어?" came back as "어떤 기간(예: 지난 7일/30일/분기)을
 * 기준으로 볼지 확인이 필요하다" — while `list_repeated_inquiries` has had a declared 28-day window all
 * along. Zero tools ran. The seller was asked to supply a parameter the backend was about to supply
 * itself (`docs/agent_real_validation_v1.md` §3 Q2·Q3·Q6, defect A4).
 *
 * <b>The fix is an audit, not a policy.</b> Nothing here decides that "최근" means 28 days. It reads what
 * each capability ALREADY declares about its own scope and writes that down where the run can see it.
 * Where a capability declares nothing — `ORDER_HISTORY` has no reachable tool at all — this file says so
 * and the clarification stands. Inventing a window would be the same failure as inventing a policy: an
 * answer with a number nobody chose.
 *
 * <b>The priority is the seller's, then the capability's, then a question.</b>
 *
 *  1. the scope the seller named — a `PERIOD` mention always wins;
 *  2. the scope the capability declares — a trailing window, or an explicitly period-free current-state
 *     read;
 *  3. only when neither exists, ask.
 *
 * <b>And the audit's uncomfortable finding: rule 1 currently reaches nothing.</b> No READ tool accepts a
 * seller-phrased range. `list_repeated_inquiries` takes `windowDays` — a NUMBER — and turning "최근" or
 * "요즘" into one would be a guess, whoever makes it. So today a named period never changes what is
 * retrieved; it changes what must be SAID. When the seller names a period and the capability cannot
 * apply it, the run proceeds under the declared default and discloses the gap, because the alternative
 * is either a silent mismatch or a question the system cannot use the answer to.
 *
 * <b>What this does NOT change: what evidence must prove.</b> A default query window is a RETRIEVAL
 * scope, and `scope/EvidenceTime.ts` is about EVIDENCE time. Asking the backend for 28 days does not
 * date a single row; only the rows' own `firstSeenOn`/`lastSeenOn` do, and a period claim still rests on
 * those. The two must never be confused — that is exactly the substitution §2.3 of
 * `docs/sellerops_operator_graph_v2.md` forbids, and the reason no value here is ever written into an
 * `EvidenceRef`.
 */
import type { InformationNeed, InvestigationPlan, NeedKind } from "../plan/InvestigationPlan";
import { OPERATOR_TOOL } from "../tools/OperatorTools";

/**
 * How a need's scope came to be settled.
 *
 * `NONE` is the only value that keeps a clarification alive, and it is deliberately hard to reach: it
 * means the audit found no contract at all, not that a contract was inconvenient.
 */
export type ScopeSource =
  /**
   * Retrieval used the range the seller named.
   *
   * <b>Nothing reaches this value today, and naming it is the point.</b> No READ tool accepts a
   * seller-phrased range, so a value that cannot be produced marks the gap instead of implying it is
   * covered. It becomes reachable the day a capability takes a real date range.
   */
  | "USER"
  /** Retrieval used the scope the capability declares. */
  | "CAPABILITY"
  /** Nothing declares a scope for this need kind, so there is nothing to pursue it with. */
  | "NONE";

/**
 * The scope itself, as a closed token rather than a sentence.
 *
 * `TRAILING_DAYS` carries its number because the number is the capability's, not ours.
 */
export type ResolvedScope =
  /** The seller named it. The run does not paraphrase what they said. */
  | { readonly kind: "USER_NAMED"; readonly mention: string }
  /** A read of how things stand right now. No period is involved, so none is missing. */
  | { readonly kind: "SNAPSHOT_NOW" }
  /** The capability's declared trailing window, ending at the run's reference date. */
  | { readonly kind: "TRAILING_DAYS"; readonly days: number }
  /** Scoped by an anchor (a product, an inquiry), not by time. */
  | { readonly kind: "ANCHORED" }
  /** Nothing declares a scope for this need. */
  | { readonly kind: "UNDECLARED" };

/** One need's settled scope, recorded on the plan so an answer can be traced back to it. */
export interface AppliedDefault {
  readonly needId: string;
  readonly needKind: NeedKind;
  /** The period the seller named, in their own words. Null when they named none. */
  readonly userNamed: string | null;
  readonly source: ScopeSource;
  /** WHERE the default is declared — a capability contract path. Null when nothing declares one. */
  readonly contract: string | null;
  /** What retrieval will ACTUALLY use. Not a paraphrase of {@link userNamed}. */
  readonly scope: ResolvedScope;
  /**
   * True when retrieval does what the seller asked for.
   *
   * <b>Today it is false whenever they named a period at all</b> — see the file docblock. That is a
   * statement about the current capabilities, not a design goal, and it is surfaced rather than hidden.
   */
  readonly honoursUserScope: boolean;
}

/**
 * The repeats window, mirrored from `RepeatedInquiryService.DEFAULT_WINDOW_DAYS`.
 *
 * <b>A mirror is a liability, so it is only ever a fallback.</b> Every returned row echoes the window the
 * backend actually applied (`RepeatedInquiryView.windowDays`), and the run prefers the echo — see
 * `inquiryOps`, which logs a mismatch rather than trusting this constant. This value describes the scope
 * only when the read comes back empty and there is no echo to read.
 */
export const REPEAT_WINDOW_DAYS = 28;

interface CapabilityContract {
  readonly tool: string;
  /** The contract that declares it, precise enough to find and to check for drift. */
  readonly contract: string;
  readonly scope: ResolvedScope;
}

/**
 * The audit result, one row per need kind. <b>Every entry is a finding about existing code, not a
 * decision made here.</b>
 *
 * `REVIEW_SIGNAL` is the entry worth reading twice. `/api/review-issues` applies NO period filter: it
 * returns every non-dismissed issue, ordered severity-first then recency, and each row carries its own
 * evidence dates and a change verdict computed over windows the backend declares
 * (`ReviewIssueThresholds`). So the honest default for "최근 부정적인 리뷰" is not a window — it is the
 * current open list, and the recency the seller asked about lives in the rows rather than in the query.
 * Reading it as "no default, must ask" would have been the wrong audit answer; inventing a window to fill
 * the gap would have been worse.
 */
const CAPABILITY_DEFAULTS: Partial<Record<NeedKind, CapabilityContract>> = {
  INQUIRY_VOLUME: {
    tool: OPERATOR_TOOL.GET_TODAY_INBOX,
    contract: "inquiries/inbox:unansweredInquiries",
    scope: { kind: "SNAPSHOT_NOW" },
  },
  REVIEW_SIGNAL: {
    tool: OPERATOR_TOOL.SEARCH_REVIEW_ISSUES,
    // No period parameter exists on the list; `referenceDate` only pins the change verdicts.
    contract: "review-issues:list(dismissed=false) — 기간 필터 없음",
    scope: { kind: "SNAPSHOT_NOW" },
  },
  REPEAT_PATTERN: {
    tool: OPERATOR_TOOL.LIST_REPEATED_INQUIRIES,
    contract: "customer-memory/repeats:windowDays",
    scope: { kind: "TRAILING_DAYS", days: REPEAT_WINDOW_DAYS },
  },
  CUSTOMER_HISTORY: {
    tool: OPERATOR_TOOL.SEARCH_CUSTOMER_MEMORY,
    contract: "customer-memory/search:anchor",
    scope: { kind: "ANCHORED" },
  },
  PRODUCT_FACT: {
    tool: OPERATOR_TOOL.SEARCH_PRODUCT_FACTS,
    contract: "product-facts:current",
    scope: { kind: "SNAPSHOT_NOW" },
  },
  PRODUCT_LISTING: {
    tool: OPERATOR_TOOL.GET_PRODUCT_KNOWLEDGE,
    contract: "product-knowledge:current",
    scope: { kind: "SNAPSHOT_NOW" },
  },
  PRODUCT_VARIANT: {
    tool: OPERATOR_TOOL.GET_PRODUCT_KNOWLEDGE,
    contract: "product-knowledge:current",
    scope: { kind: "SNAPSHOT_NOW" },
  },
  POLICY: {
    // There is no policy store, and that is a complete answer rather than a missing scope: the run says
    // so (`inquiryOps` POLICY branch). A need that will be answered honestly is not a need to ask about.
    tool: OPERATOR_TOOL.GET_INQUIRY_CONTEXT,
    contract: "policy-store:UNAVAILABLE",
    scope: { kind: "SNAPSHOT_NOW" },
  },
  // ORDER_HISTORY is deliberately ABSENT. No specialist reaches an order read today, so no contract
  // declares its scope, and a plan that requires it is one the seller genuinely has to narrow.
};

/** Need kinds that cannot be served without an anchor the run must first resolve. */
const NEEDS_PRODUCT_ANCHOR: readonly NeedKind[] = [
  "PRODUCT_FACT", "PRODUCT_LISTING", "PRODUCT_VARIANT", "CUSTOMER_HISTORY",
];

/**
 * How one need's scope settles: what the seller named, and what retrieval will actually do.
 *
 * <b>Both, because they differ.</b> Recording only the seller's words would hide that nothing applied
 * them; recording only the capability's default would hide that the seller asked for something else.
 * The gap between the two is the sentence the answer owes them.
 */
export function resolveScope(
  plan: InvestigationPlan,
  need: InformationNeed,
  goalText?: string,
): AppliedDefault {
  const named = plan.entities.unresolved.find((e) => e.kind === "PERIOD")
    ?? plan.entities.resolved.find((e) => e.kind === "PERIOD");
  // <b>Only quote the seller what the seller actually wrote.</b> Live 2026-08-23 a planner emitted the
  // PERIOD mention "분석 기간 미지정" — its own note-to-self about a gap — and the answer read it back as
  // 「분석 기간 미지정」은 …, attributing to the seller a phrase they never used. A mention that does not
  // appear in the goal sentence is the model's, so it names no user scope; the basis is still stated,
  // just without the false quotation.
  const userNamed = named && (goalText == null || goalText.includes(named.mention))
    ? named.mention
    : null;
  const declared = CAPABILITY_DEFAULTS[need.kind];
  if (!declared) {
    return {
      needId: need.id, needKind: need.kind, userNamed, source: "NONE", contract: null,
      scope: { kind: "UNDECLARED" }, honoursUserScope: false,
    };
  }
  return {
    needId: need.id, needKind: need.kind, userNamed,
    source: "CAPABILITY", contract: declared.contract, scope: declared.scope,
    // False whenever the seller named a period, because no retrieval can apply one. Kept as a field
    // rather than derived at each call site so the disclosure cannot be forgotten in one of them.
    honoursUserScope: userNamed == null,
  };
}

/**
 * Can this need be pursued at all, or does answering it require something only the seller has?
 *
 * Two ways to fail, and they are different facts: no declared scope (nothing says what period to read),
 * or an anchor the plan neither resolved nor named (nothing says which product).
 */
export function isServable(plan: InvestigationPlan, need: InformationNeed): boolean {
  // Deliberately without `goalText`: whose words named the period changes what is SAID, never whether the
  // need can be pursued.
  if (resolveScope(plan, need).source === "NONE") return false;
  if (NEEDS_PRODUCT_ANCHOR.includes(need.kind)) {
    const anchored = plan.entities.unresolved.some((e) => e.kind === "PRODUCT" || e.kind === "INQUIRY")
      || plan.entities.resolved.some((e) => e.kind === "PRODUCT" || e.kind === "INQUIRY");
    if (!anchored) return false;
  }
  return true;
}

/**
 * Should the planner's clarification actually be put to the seller?
 *
 * <b>A clarification whose answer the system already holds is not a clarification.</b> It is a run that
 * did not happen. So the model's flag is honoured only when NOTHING required can be pursued — if some of
 * the work is servable, the run does that work and says plainly which needs it could not meet. Asking
 * back is reserved for the case where asking is the only move, which is what it was for in
 * "상품에 문제 있어?" and is not what it was for in "반복 문의가 있어?".
 */
export function clarificationStands(plan: InvestigationPlan): boolean {
  if (!plan.clarificationNeeded) return false;
  const required = plan.informationNeeds.filter((n) => n.required);
  const candidates = required.length > 0 ? required : plan.informationNeeds;
  if (candidates.length === 0) return true;
  return !candidates.some((n) => isServable(plan, n));
}

/**
 * Attach the audit to the plan, and drop a clarification the contracts already answer.
 *
 * Runtime-computed, never model-supplied: the planner has no field for this and could not be trusted
 * with one — a model asked to name a default would name a plausible number, which is the failure this
 * whole file exists to avoid.
 */
export function withOperationalDefaults(plan: InvestigationPlan, goalText?: string): InvestigationPlan {
  const appliedDefaults = plan.informationNeeds.map((n) => resolveScope(plan, n, goalText));
  return { ...plan, appliedDefaults, clarificationNeeded: clarificationStands(plan) };
}

/** What each need kind is about, in the seller's language. Closed vocabulary — never a plan sentence. */
const SUBJECT_OF: Partial<Record<NeedKind, string>> = {
  INQUIRY_VOLUME: "미답변 문의",
  REPEAT_PATTERN: "반복 문의",
  REVIEW_SIGNAL: "리뷰 이슈",
  CUSTOMER_HISTORY: "과거 대응 사례",
  PRODUCT_FACT: "상품 정보",
  PRODUCT_LISTING: "채널 등록 정보",
  PRODUCT_VARIANT: "옵션 정보",
  ORDER_HISTORY: "주문 이력",
  POLICY: "판매 정책",
};

/**
 * What basis this need was answered on, said plainly — or `null` when there is nothing worth saying.
 *
 * Two things are worth saying and the rest is noise: a trailing window the seller did not choose, and a
 * period the seller DID choose that retrieval could not apply. "현재 시점 기준" on a question that named
 * no period is the obvious reading of an answer, and printing it on every finding would bury the two
 * lines that carry information.
 */
export function basisSentence(applied: AppliedDefault): string | null {
  const subject = SUBJECT_OF[applied.needKind] ?? "이 항목";
  if (applied.userNamed && !applied.honoursUserScope) {
    switch (applied.scope.kind) {
      case "TRAILING_DAYS":
        return `「${applied.userNamed}」은 ${subject}의 기본 조회 기간인 최근 ${applied.scope.days}일 기준으로 확인했습니다.`;
      case "SNAPSHOT_NOW":
        // Accurate for both shapes this covers: a queue depth has no period to filter by, and the issue
        // list has one it does not accept. Either way the seller asked about a span and got a state.
        return `${subject}는 기간과 무관한 현재 시점 값이라, 「${applied.userNamed}」이 아니라 지금 상태를 확인했습니다.`;
      default:
        return null;
    }
  }
  if (applied.scope.kind === "TRAILING_DAYS") {
    return `${subject}는 최근 ${applied.scope.days}일 기준으로 확인했습니다.`;
  }
  return null;
}

/** What a scope token means for a log line — no sentence, no seller words. */
export function scopeToken(scope: ResolvedScope): string {
  switch (scope.kind) {
    case "TRAILING_DAYS": return `TRAILING_${scope.days}D`;
    case "USER_NAMED": return "USER_NAMED";
    case "SNAPSHOT_NOW": return "SNAPSHOT_NOW";
    case "ANCHORED": return "ANCHORED";
    case "UNDECLARED": return "UNDECLARED";
  }
}
