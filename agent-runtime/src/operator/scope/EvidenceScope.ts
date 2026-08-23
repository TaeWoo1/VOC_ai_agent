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
 *  3. <b>temporal</b> — when the seller named a period, an undated total has not proven the period.
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

/** What a claim is ABOUT. A closed set; the three levels a seller's question can sit at. */
export type EntityScope = "ORG" | "PRODUCT" | "ITEM";

/**
 * What a piece of evidence IS, as a shape.
 *
 * `ISSUE_SIGNAL` is its own value rather than a `COUNT`: an issue row carries a severity and a
 * signature as well as a tally, so it answers a "반복되는 문제가 있는가" need that a bare count does
 * not — and it does NOT answer a "그 근거가 이 상품의 것인가" need, which is what `ISSUE_EVIDENCE`
 * would be if any reachable tool produced it today. None does (`get_issue_evidence_summary` exists in
 * the catalogue and no specialist invokes it — `docs/agent_real_validation_v1.md` §5 P4), so the value
 * is named here and never emitted. Naming it is the point: the gap is visible instead of implied.
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
  /** The need names a period; this evidence carries no date of its own. Temporal axis. */
  | "TEMPORAL_UNPROVEN"
  /** A count offered for a list/detail need, and the like. Invariant 4. */
  | "GRANULARITY_MISMATCH";

export interface NeedScope {
  readonly needId: string;
  readonly entity: EntityScope;
  /** Every product this run actually resolved. Empty with `entity: "PRODUCT"` ⇒ invariant 1 bites. */
  readonly productIds: readonly string[];
  readonly channelCode: string | null;
  /** True when the plan named a period, so undated evidence cannot answer this need. */
  readonly periodNamed: boolean;
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
  INBOX_COUNT: "COUNT",
  PRODUCT_SIGNAL: "COUNT",
  REVIEW_ISSUE: "ISSUE_SIGNAL",
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
  REVIEW_SIGNAL: ["ISSUE_SIGNAL", "ISSUE_EVIDENCE", "COUNT", "DETAIL"],
  CUSTOMER_HISTORY: ["LIST", "DETAIL"],
  ORDER_HISTORY: ["LIST", "DETAIL", "COUNT"],
  PRODUCT_FACT: ["DETAIL", "GAP"],
  PRODUCT_LISTING: ["DETAIL", "GAP"],
  PRODUCT_VARIANT: ["DETAIL", "GAP"],
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
  observedOn: string | null;
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
    observedOn: ref.observedOn,
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
  const namesProduct = mentions.some((m) => m.kind === "PRODUCT")
    || resolved.some((r) => r.kind === "PRODUCT");
  const namesItem = mentions.some((m) => m.kind === "INQUIRY" || m.kind === "ORDER")
    || resolved.some((r) => r.kind === "INQUIRY" || r.kind === "ORDER");
  const entity: EntityScope = namesProduct ? "PRODUCT" : namesItem ? "ITEM" : "ORG";

  const channelMention = mentions.find((m) => m.kind === "CHANNEL")?.mention
    ?? resolved.find((r) => r.kind === "CHANNEL")?.label
    ?? null;

  const declared = plan.evidenceRequirements.find((r) => r.needId === need.id);
  const fromPlan = declared ? granularitiesOfKinds(declared.acceptableKinds) : [];

  return {
    needId: need.id,
    entity,
    productIds: resolved.filter((r) => r.kind === "PRODUCT").map((r) => r.id),
    channelCode: channelMention ? normalizeChannel(channelMention) : null,
    periodNamed: mentions.some((m) => m.kind === "PERIOD")
      || resolved.some((r) => r.kind === "PERIOD"),
    granularities: fromPlan.length > 0 ? fromPlan : KIND_FLOOR[need.kind] ?? [],
  };
}

/**
 * The run's scope with no need attached — for a finding whose `needId` nothing set.
 *
 * The entity, channel and temporal axes still apply, because they are properties of what the SELLER
 * asked; only the granularity axis goes quiet, because granularity is a property of the need and there
 * is no need to read it from. An unattributed finding is therefore still unable to answer a product
 * question with an org total, which is the failure that matters.
 */
export function planScopeOf(plan: InvestigationPlan, resolved: readonly ResolvedEntity[]): NeedScope {
  const anyNeed: InformationNeed = {
    id: "", question: "", kind: "REVIEW_SIGNAL", why: "", required: false,
  };
  return { ...needScopeOf(plan, anyNeed, resolved), needId: "", granularities: [] };
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

  if (need.periodNamed && ev.observedOn == null) {
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
      return `기간이 표시되지 않은 총계여서 ${named}이 물은 기간의 근거로는 쓸 수 없습니다.`;
    case "GRANULARITY_MISMATCH":
      return `${named}이 필요로 하는 형태의 근거가 아니어서 사용하지 않았습니다.`;
  }
}
