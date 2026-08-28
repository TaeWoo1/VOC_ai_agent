/**
 * Evidence scope integrity — does this evidence prove what this need asked about?
 *
 * <b>Why this file exists.</b> On 2026-08-23 the Operator was asked, by name, whether a specific
 * product had customer complaints. It answered that the product had three HIGH-severity issues. The
 * product had **zero** rows in `review_issue_evidence`; the three issues belonged to other products
 * and their evidence predated the product's entire review window. Nothing warned, because every check
 * in the chain asked the same insufficient question — *does this finding have evidence attached?* —
 * and the answer was yes. It was the wrong evidence. Full record:
 * `docs/agent_real_validation_v1.md` §3 Q4.
 *
 * <b>What it adds.</b> One question, asked before a finding is assembled into a run: is the scope the
 * evidence PROVES the same as the scope the need ASKED about? Four axes, each explicit rather than
 * implied:
 *
 *  1. <b>entity</b> — ORG / PRODUCT / ITEM. Org-wide evidence cannot answer a product question.
 *  2. <b>channel</b> — when the seller named one, evidence that cannot say which channel it came from
 *     has not proven it came from that one.
 *  3. <b>temporal</b> — a question about how things STAND is answered by a fresh observation; a
 *     question about what HAPPENED in a period is answered only by rows with their own dates. The two
 *     are different facts and `EvidenceTime.ts` keeps them apart.
 *  4. <b>granularity</b> — COUNT / LIST / DETAIL / ISSUE_SIGNAL / GAP. A count is not a list.
 *
 * <b>What it deliberately is NOT.</b> Not a retrieval feature: it adds no tool, reads nothing, and
 * cannot make an answer better. Its only power is to withhold. When it fires, the need stays
 * unsatisfied and the answer says why — which is the whole point, because the failure it exists for is
 * a confident wrong answer, and a confident wrong answer is worse than an empty one.
 *
 * <b>Why the checks are conservative in both directions.</b> Every "cannot prove" verdict here rejects.
 * That will sometimes withhold evidence that a human would have accepted (an undated count really was
 * about today; a channel-less row really was Cafe24). That direction is the correct one to be wrong in:
 * this component can only make the Operator quieter, never bolder — the same rule the rule judge
 * follows.
 */
import type { EvidenceKind, EvidenceRef } from "../state/OperatorState";
import type { InformationNeed, InvestigationPlan, ResolvedEntity } from "../plan/InvestigationPlan";
import type { EventRange, TemporalDemand } from "./EvidenceTime";
import { hasEventTime, temporalDemandOf } from "./EvidenceTime";
import { isInstance } from "../plan/EntityRole";

/** What a claim is ABOUT. A closed set; the three levels a seller's question can sit at. */
export type EntityScope = "ORG" | "PRODUCT" | "ITEM";

/**
 * What a piece of evidence IS, as a shape.
 *
 * `ISSUE_SIGNAL` is its own value rather than a `COUNT`: an issue row carries a severity and a
 * signature as well as a tally, so it answers a "반복되는 문제가 있는가" need that a bare count does
 * not — and it does NOT answer a "그 근거가 이 상품의 것인가" need. That second question is
 * `ISSUE_EVIDENCE`, and it was named here before anything could produce it: the tool that answers it
 * sat in the catalogue with no caller for as long as the gap existed (`docs/agent_real_validation_v1.md`
 * §5 P4). Since A5 (2026-08-23) `ReviewOps` reaches `get_review_issue_evidence_summary` for a resolved
 * product and the value is emitted — the vocabulary did not change, the reachability did.
 */
export type Granularity = "COUNT" | "LIST" | "DETAIL" | "ISSUE_SIGNAL" | "ISSUE_EVIDENCE" | "GAP";

/**
 * Why one piece of evidence may not support one need. Closed vocabulary — a surface, a log line and a
 * test can all name the same reason, and an unnamed reason cannot silently mean "fine".
 */
export type ScopeMismatch =
  /** The need is about a product and the run never resolved one. Invariant 1. */
  | "NO_RESOLVED_PRODUCT"
  /** The need is about a product; this evidence is about the whole org. Invariant 2. */
  | "ORG_EVIDENCE_FOR_PRODUCT_NEED"
  /** Both are product-scoped, and they are different products. Invariant 3. */
  | "PRODUCT_MISMATCH"
  /** The need names a channel; this evidence came from another one. Invariant 3. */
  | "CHANNEL_MISMATCH"
  /** The need names a channel; this evidence cannot say which channel it is from. Invariant 3. */
  | "CHANNEL_UNPROVEN"
  /** The need is about events in a period; this evidence cannot say when its rows happened. */
  | "TEMPORAL_UNPROVEN"
  /** The need is about the current state; this evidence cannot say when it was read. */
  | "OBSERVATION_TIME_UNKNOWN"
  /** A count offered for a list/detail need, and the like. Invariant 4. */
  | "GRANULARITY_MISMATCH";

export interface NeedScope {
  readonly needId: string;
  readonly entity: EntityScope;
  /** Every product this run actually resolved. Empty with `entity: "PRODUCT"` ⇒ invariant 1 bites. */
  readonly productIds: readonly string[];
  readonly channelCode: string | null;
  /**
   * What this need requires of time — nothing, a fresh observation, or real event dates.
   *
   * Derived from the need's KIND plus whether the seller named a period, so the verdict does not move
   * when the planner rephrases the same question. See {@link temporalDemandOf}.
   */
  readonly temporal: TemporalDemand;
  /**
   * The shapes of evidence that would answer this need.
   *
   * Sourced from the plan's own `evidenceRequirements.acceptableKinds` when the planner declared them
   * — a field the planner has always emitted and nothing has ever read — and otherwise from the need's
   * {@link InformationNeed.kind}. The planner's declaration wins because it is about THIS question;
   * the kind floor is what remains when it said nothing.
   */
  readonly granularities: readonly Granularity[];
}

/** One rejected citation, with the reason a human and a test can both read. */
export interface RejectedEvidence {
  readonly evidenceId: string;
  readonly reason: ScopeMismatch;
}

/**
 * What each evidence kind proves, as a shape.
 *
 * Derived from the kind rather than from the tool, because the kind is what the judge and the answer
 * card show; two tools producing the same kind must be interchangeable to a need or the vocabulary is
 * lying.
 */
const GRANULARITY_OF: Record<EvidenceKind, Granularity> = {
  // A coverage verdict is a statement about a channel as a whole — the same granularity as any
  // other org-level count, and never a per-row list.
  CHANNEL_COVERAGE: "COUNT",
  INBOX_COUNT: "COUNT",
  PRODUCT_SIGNAL: "COUNT",
  REVIEW_ISSUE: "ISSUE_SIGNAL",
  ISSUE_EVIDENCE: "ISSUE_EVIDENCE",
  // A tally of one product's negative reviews. A COUNT in shape — its product-scoping is carried on
  // the entity axis (the locator's `productId`), which is where scope belongs.
  NEGATIVE_REVIEW: "COUNT",
  REPEATED_INQUIRY: "LIST",
  CUSTOMER_MEMORY: "LIST",
  REVIEW: "DETAIL",
  INQUIRY: "DETAIL",
  PAST_REPLY: "DETAIL",
  ITEM_ANALYSIS: "DETAIL",
  PRODUCT_FACT: "DETAIL",
  PRODUCT_LISTING: "DETAIL",
  PRODUCT_VARIANT: "DETAIL",
  PRODUCT_KNOWLEDGE_GAP: "GAP",
  // A quoted passage is a DETAIL: it is one identifiable thing a reader can go and check, which is
  // exactly what separates grounding from a summary.
  PRODUCT_KNOWLEDGE_DOC: "DETAIL",
  GROUPING_GAP: "GAP",
  // Agentic Operating Workspace v2: rows are a LIST, a window total is a COUNT, a missing human step
  // is a GAP — the same three shapes the rest of the table already uses.
  REVIEW_LIST: "LIST",
  ORDER_SUMMARY: "COUNT",
  HUMAN_ACTION: "GAP",
};

/**
 * What each need kind will accept when the planner declared nothing.
 *
 * <b>Deliberately generous.</b> This is a floor, not a specification: it exists so that a plan with no
 * `evidenceRequirements` is not gated on a guess about what the seller meant. The tight case — "첫
 * 페이지 목록" typed as an `INQUIRY_VOLUME` need — is caught by the planner's own declaration, and the
 * honest consequence of it declaring nothing is that this axis stays quiet.
 */
const KIND_FLOOR: Record<InformationNeed["kind"], readonly Granularity[]> = {
  INQUIRY_VOLUME: ["COUNT", "LIST", "DETAIL"],
  REPEAT_PATTERN: ["LIST", "ISSUE_SIGNAL", "ISSUE_EVIDENCE", "COUNT"],
  REVIEW_SIGNAL: ["ISSUE_SIGNAL", "ISSUE_EVIDENCE", "COUNT", "DETAIL", "LIST"],
  CUSTOMER_HISTORY: ["LIST", "DETAIL"],
  ORDER_HISTORY: ["LIST", "DETAIL", "COUNT"],
  PRODUCT_FACT: ["DETAIL", "GAP"],
  PRODUCT_LISTING: ["DETAIL", "GAP"],
  PRODUCT_VARIANT: ["DETAIL", "GAP"],
  PRODUCT_KNOWLEDGE_DOC: ["DETAIL", "GAP"],
  POLICY: ["DETAIL", "GAP"],
};

/** `acceptableKinds` speaks the EvidenceKind vocabulary; map it onto shapes. Unknown names are ignored. */
function granularitiesOfKinds(kinds: readonly string[]): Granularity[] {
  const out: Granularity[] = [];
  for (const k of kinds) {
    const g = GRANULARITY_OF[k as EvidenceKind];
    if (g && !out.includes(g)) out.push(g);
  }
  return out;
}

export function granularityOf(kind: EvidenceKind): Granularity {
  return GRANULARITY_OF[kind] ?? "DETAIL";
}

/**
 * What one piece of evidence proves, read off the ref alone.
 *
 * <b>Absence is not scope.</b> A locator with no `productId` is org-wide evidence, not
 * product-evidence-whose-product-we-forgot-to-write-down. That reading is the one thing this whole
 * file turns on: Q4's three issue rows had no `productId`, and treating that as "unknown, probably
 * fine" is exactly how they became a claim about one product.
 */
export function evidenceScopeOf(ref: EvidenceRef): {
  entity: EntityScope;
  productId: string | null;
  channelCode: string | null;
  granularity: Granularity;
  asOf: string | null;
  events: EventRange | null;
} {
  const loc = ref.locator;
  const productId = loc.productId ?? null;
  const item = loc.inquiryId ?? loc.workItemId ?? loc.reviewActionRef ?? null;
  const entity: EntityScope = productId ? "PRODUCT" : item ? "ITEM" : "ORG";
  return {
    entity,
    productId,
    channelCode: loc.channelCode ?? null,
    granularity: granularityOf(ref.kind),
    asOf: ref.asOf,
    events: ref.events,
  };
}

/**
 * What one need asks about.
 *
 * <b>The entity axis is a property of the RUN, not of the sentence.</b> If the seller named a product
 * anywhere in the goal, every need in that plan is read as being about that product — because that is
 * what the seller means, and because the alternative is inferring per-need intent from Korean prose,
 * which is the kind of guess this repository refuses elsewhere. The cost is a false negative on a
 * genuinely mixed question ("이 상품 어때? 그리고 전체 미답변은?"), where the org half is withheld and
 * said to be withheld. That is the safe direction.
 */
export function needScopeOf(
  plan: InvestigationPlan,
  need: InformationNeed,
  resolved: readonly ResolvedEntity[],
): NeedScope {
  const mentions = plan.entities.unresolved;
  // <b>Only an INSTANCE narrows.</b> A category mention is a kind of thing, not one of them: "미답변
  // 문의" cannot be resolved to an inquiry by any tool, and reading it as one is what made a run refuse
  // its own correct org-wide count and answer nothing (A9 — `plan/EntityRole.ts`). Note that the
  // narrowing does NOT wait for resolution: an unresolved instance still puts the need in product scope
  // and is then answered by nothing, which is invariant 1 and stays exactly as it was.
  const named = mentions.filter(isInstance);
  const namesProduct = named.some((m) => m.kind === "PRODUCT")
    || resolved.some((r) => r.kind === "PRODUCT");
  const namesItem = named.some((m) => m.kind === "INQUIRY" || m.kind === "ORDER")
    || resolved.some((r) => r.kind === "INQUIRY" || r.kind === "ORDER");
  const entity: EntityScope = namesProduct ? "PRODUCT" : namesItem ? "ITEM" : "ORG";

  const channelMention = named.find((m) => m.kind === "CHANNEL")?.mention
    ?? resolved.find((r) => r.kind === "CHANNEL")?.label
    ?? null;

  const declared = plan.evidenceRequirements.find((r) => r.needId === need.id);
  const fromPlan = declared ? granularitiesOfKinds(declared.acceptableKinds) : [];

  return {
    needId: need.id,
    entity,
    productIds: resolved.filter((r) => r.kind === "PRODUCT").map((r) => r.id),
    channelCode: channelMention ? normalizeChannel(channelMention) : null,
    temporal: temporalDemandOf(need.kind, periodNamedIn(plan, resolved)),
    granularities: fromPlan.length > 0 ? fromPlan : KIND_FLOOR[need.kind] ?? [],
  };
}

/**
 * Which single channel this run is scoped to, or null.
 *
 * <b>Exported for the same reason {@link periodNamedIn} is.</b> A specialist has to know which channel
 * a scoped run is about — to read that channel's coverage and to say what it could not see — and a
 * specialist re-deriving it from the sentence would be a second reading of the same plan, free to
 * disagree with the gate that will judge its evidence.
 *
 * <b>Only an INSTANCE scopes.</b> "채널별" names the axis, not a channel; reading it as a scope would
 * narrow a run to a channel called "채널별" and answer nothing.
 */
export function channelScopeOf(
  plan: InvestigationPlan,
  resolved: readonly ResolvedEntity[] = plan.entities.resolved,
): string | null {
  const named = plan.entities.unresolved.filter(isInstance);
  const mention = named.find((m) => m.kind === "CHANNEL")?.mention
    ?? resolved.find((r) => r.kind === "CHANNEL")?.label
    ?? null;
  return mention ? normalizeChannel(mention) : null;
}

/**
 * Did the seller name a period at all?
 *
 * <b>Every PERIOD mention counts, whatever its role.</b> The role gates the ENTITY axis — which thing a
 * claim is about — and time is not an identity: "최근" names no period instance and still means the
 * seller asked about a span. A4's `resolveScope` reads PERIOD the same way, and the two must not
 * disagree about whether a period was named.
 *
 * Exported because a specialist has to be able to say what it could NOT date. It is the same question
 * the gate asks, asked once — a specialist deciding for itself whether a period was named would be a
 * second reading of the same plan.
 */
export function periodNamedIn(
  plan: InvestigationPlan,
  resolved: readonly ResolvedEntity[] = plan.entities.resolved,
): boolean {
  return plan.entities.unresolved.some((m) => m.kind === "PERIOD")
    || resolved.some((r) => r.kind === "PERIOD");
}

/**
 * The run's scope with no need attached — for a finding whose `needId` nothing set.
 *
 * The entity and channel axes still apply, because they are properties of what the SELLER asked. The
 * granularity axis goes quiet, because granularity is a property of the need. The temporal axis falls
 * back to `CURRENT_STATE`: without a need there is no honest way to tell whether the seller asked how
 * things stand or what happened, and guessing `PERIOD_EVENTS` would withhold true state facts on the
 * strength of a coin flip. The claim-side rule in the judge is what catches an event claim here —
 * {@link assertsEventOccurrence} reads the sentence, which is the one thing this function cannot.
 *
 * An unattributed finding is therefore still unable to answer a product question with an org total,
 * which is the failure that matters.
 */
export function planScopeOf(plan: InvestigationPlan, resolved: readonly ResolvedEntity[]): NeedScope {
  const anyNeed: InformationNeed = {
    id: "", question: "", kind: "REVIEW_SIGNAL", why: "", required: false,
  };
  const scope = needScopeOf(plan, anyNeed, resolved);
  return {
    ...scope,
    needId: "",
    granularities: [],
    temporal: scope.temporal === "NONE" ? "NONE" : "CURRENT_STATE",
  };
}

/**
 * Channel names as the seller writes them, folded onto the codes the evidence carries.
 *
 * Deliberately tiny and deliberately not fuzzy: an unrecognized mention normalizes to itself upper-cased
 * and will simply not match any evidence, which withholds rather than mis-matches.
 */
function normalizeChannel(mention: string): string {
  const t = mention.trim().toUpperCase();
  if (t.includes("네이버") || t.includes("NAVER") || t.includes("스마트스토어")) return "NAVER";
  if (t.includes("쿠팡") || t.includes("COUPANG")) return "COUPANG";
  if (t.includes("카페24") || t.includes("CAFE24")) return "CAFE24";
  return t;
}

/**
 * May this evidence support this need? `null` means yes.
 *
 * The order of the checks is the order of how badly a mismatch misleads: an unresolved product first,
 * because that is the one that produced a wrong answer about a real product.
 */
export function checkEvidence(need: NeedScope, ref: EvidenceRef): ScopeMismatch | null {
  const ev = evidenceScopeOf(ref);

  if (need.entity === "PRODUCT") {
    // Invariant 1. No canonical product, no product claim — whatever else the evidence looks like.
    if (need.productIds.length === 0) return "NO_RESOLVED_PRODUCT";
    // Invariant 2. Org-wide evidence never narrows to one product by being cited next to it.
    if (ev.entity === "ORG") return "ORG_EVIDENCE_FOR_PRODUCT_NEED";
    // Invariant 3. Item evidence must still say which product it belongs to.
    if (!ev.productId) return "ORG_EVIDENCE_FOR_PRODUCT_NEED";
    if (!need.productIds.includes(ev.productId)) return "PRODUCT_MISMATCH";
  }

  if (need.entity === "ITEM" && ev.entity === "ORG") {
    return "ORG_EVIDENCE_FOR_PRODUCT_NEED";
  }

  if (need.channelCode) {
    if (!ev.channelCode) return "CHANNEL_UNPROVEN";
    if (ev.channelCode.toUpperCase() !== need.channelCode) return "CHANNEL_MISMATCH";
  }

  // The temporal axis. `CURRENT_STATE` asks only that we know WHEN we looked; `PERIOD_EVENTS` asks
  // that the rows themselves are dated, and an observation time never stands in for that — a count read
  // today proves nothing about when the things in it arrived.
  if (need.temporal === "CURRENT_STATE" && ev.asOf == null) {
    return "OBSERVATION_TIME_UNKNOWN";
  }
  if (need.temporal === "PERIOD_EVENTS" && !hasEventTime(ev.events)) {
    return "TEMPORAL_UNPROVEN";
  }

  // Invariant 4. An empty acceptable set means the need declared nothing and the floor had nothing to
  // say — not that everything is acceptable by proof.
  if (need.granularities.length > 0 && !need.granularities.includes(ev.granularity)) {
    return "GRANULARITY_MISMATCH";
  }

  return null;
}

/** Split one need's citations into what may be used and what may not, with reasons. */
export function partitionEvidence(
  need: NeedScope,
  refs: readonly EvidenceRef[],
): { accepted: EvidenceRef[]; rejected: RejectedEvidence[] } {
  const accepted: EvidenceRef[] = [];
  const rejected: RejectedEvidence[] = [];
  for (const ref of refs) {
    const reason = checkEvidence(need, ref);
    if (reason) rejected.push({ evidenceId: ref.evidenceId, reason });
    else accepted.push(ref);
  }
  return { accepted, rejected };
}

/** The seller-facing sentence for a reason. Closed vocabulary in, plain Korean out. */
export function reasonSentence(reason: ScopeMismatch, subject?: string): string {
  const named = subject ? `「${subject}」` : "이 질문";
  switch (reason) {
    case "NO_RESOLVED_PRODUCT":
      return `${named}에 해당하는 상품을 찾지 못해, 상품 단위로 확인할 수 있는 근거가 없습니다.`;
    case "ORG_EVIDENCE_FOR_PRODUCT_NEED":
      return `${named}에 대해 확인한 것은 전체 집계뿐이라, 이 상품의 근거로는 쓸 수 없습니다.`;
    case "PRODUCT_MISMATCH":
      return `${named}이 아닌 다른 상품의 근거여서 사용하지 않았습니다.`;
    case "CHANNEL_MISMATCH":
      return `${named}에서 물은 채널과 다른 채널의 근거여서 사용하지 않았습니다.`;
    case "CHANNEL_UNPROVEN":
      return `어느 채널의 기록인지 확인할 수 없어 ${named}의 근거로는 쓸 수 없습니다.`;
    case "TEMPORAL_UNPROVEN":
      return `언제 일어난 일인지 확인할 수 없는 근거여서 ${named}이 물은 기간의 근거로는 쓸 수 없습니다.`;
    case "OBSERVATION_TIME_UNKNOWN":
      return `언제 확인한 값인지 알 수 없어 ${named}의 현재 상태를 말할 근거로는 쓸 수 없습니다.`;
    case "GRANULARITY_MISMATCH":
      return `${named}이 필요로 하는 형태의 근거가 아니어서 사용하지 않았습니다.`;
  }
}
