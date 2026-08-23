/**
 * The plan a run executes — an investigation design, not an intent label.
 *
 * <b>Why the shape is this big.</b> A label cannot distinguish "폭이 몇 mm인가요?" from
 * "교환 가능한가요?": both are INQUIRY, both would run the same specialist over the same tools in the
 * same order, and the answer to the first would be assembled from evidence that has nothing to do with
 * the question. {@link InformationNeed} is what makes the two plans structurally different, and
 * `planDivergence` is the test that holds them apart.
 *
 * <b>The planner never mints an id.</b> {@link ResolvedEntity} is produced by TOOLS during the run;
 * a plan arrives with `entities.resolved` empty and the validator refuses it otherwise (V6, the one
 * rule with no repair). A model that could emit a productId would emit a plausible one, the tool would
 * read it, find nothing, and the Operator would report calm about a product that was never looked at.
 */
import type { SpecialistName } from "../state/OperatorState";
import type { AppliedDefault } from "../defaults/OperationalDefaults";
import type { AttentionCoverage } from "../../spring/types";
import type { EntityRole } from "./EntityRole";

/** What kind of thing a mention refers to. Closed — an unknown kind is dropped by the validator. */
export type EntityKind = "PRODUCT" | "CHANNEL" | "ORDER" | "INQUIRY" | "ISSUE" | "PERIOD";

/** A thing the seller named, in the seller's own words. No id — see the file docblock. */
export interface EntityMention {
  readonly kind: EntityKind;
  readonly mention: string;
  /**
   * Whether those words name one thing or a kind of thing.
   *
   * <b>Runtime-computed, never model-supplied</b>, and required so that no mention can enter a plan
   * with the question unanswered. Assigned once at the wire boundary by
   * {@link import("./EntityRole").mentionOf}; the validator, the capability audit and the scope gate
   * all read this field rather than re-reading the string. A CATEGORY mention narrows nothing and is
   * handed to no resolver — see `plan/EntityRole.ts` for why the burden of proof sits on that value.
   */
  readonly role: EntityRole;
}

/**
 * A mention a TOOL resolved to a real row. Only the run can produce one.
 *
 * It carries no {@link EntityRole}: a row exists, so it is an instance by construction. That is also
 * why {@link import("./EntityRole").namesInstance} counts every resolved entity unconditionally.
 */
export interface ResolvedEntity {
  readonly kind: EntityKind;
  readonly mention: string;
  readonly id: string;
  readonly label: string;
  /** Which tool resolved it — provenance, so a finding can name how the entity was found. */
  readonly resolvedBy: string;
  /** True when more than one row matched and the first was used. Reported, never hidden. */
  readonly ambiguous?: boolean;
}

/**
 * The kinds of information a need can ask for.
 *
 * <b>They are evidence kinds, not tool names.</b> A need says what must be KNOWN; the retrieval
 * strategy and the specialist decide what to CALL. Naming a tool here would make the plan a script and
 * the divergence test meaningless — three questions could then "differ" only by tool order.
 */
export type NeedKind =
  | "PRODUCT_FACT"
  | "PRODUCT_LISTING"
  | "PRODUCT_VARIANT"
  | "POLICY"
  | "CUSTOMER_HISTORY"
  | "REVIEW_SIGNAL"
  | "INQUIRY_VOLUME"
  | "REPEAT_PATTERN"
  | "ORDER_HISTORY";

export interface InformationNeed {
  readonly id: string;
  /** What must be answered, phrased as a question. Read by a human on the answer card. */
  readonly question: string;
  readonly kind: NeedKind;
  readonly why: string;
  /** A required need that ends unsatisfied is SAID so; an optional one is quietly skipped. */
  readonly required: boolean;
}

/** How a need is satisfied during the run. Merged by id; never silently dropped. */
export type NeedStatus = "PENDING" | "SATISFIED" | "UNSATISFIABLE";

export interface NeedState {
  readonly id: string;
  readonly status: NeedStatus;
  readonly evidenceIds: readonly string[];
  /** Present on UNSATISFIABLE: why this could not be answered, in the seller's language. */
  readonly reason?: string;
  /**
   * How well the source behind this outcome could see the scope the need asked about.
   *
   * <b>The axis that decides whether "없습니다" survives.</b> A zero read under `COVERED` is a measured
   * zero and answers the question; the same zero under any `UNCERTAIN_*` value is a blind spot wearing
   * the same shape. Absent means the specialist could not say, which ranks between the two.
   */
  readonly coverage?: AttentionCoverage;
  /**
   * False when the read behind this outcome was bounded — a capped sweep, a truncated list, a partial
   * page. A complete read of a small set beats a capped read of a big one, whatever either found.
   */
  readonly complete?: boolean;
  /** Which specialist settled it. Provenance for the merge and for a trace; never shown to a seller. */
  readonly settledBy?: SpecialistName;
}

/**
 * The order the needs are pursued in — the part a fixed specialist sequence used to decide.
 *
 * `stopWhen` is advisory prose the planner writes for itself on a re-plan; nothing executes it. It is
 * carried because a re-plan that cannot see its own earlier reasoning re-derives it, and re-derivation
 * under a different sample is how a bounded loop starts oscillating.
 */
export interface RetrievalStrategy {
  readonly order: readonly string[];
  readonly parallelizable: readonly string[];
  readonly stopWhen: string | null;
}

export interface EvidenceRequirement {
  readonly needId: string;
  readonly minEvidence: number;
  /** Evidence kinds that would satisfy this need. Empty = any kind. */
  readonly acceptableKinds: readonly string[];
}

/**
 * How much caution the answer needs.
 *
 * `REFUSE` is a real answer, not an error: the model understood and judged the goal out of scope. It
 * is honoured rather than second-guessed, which is what the keyword table's `UnrecognizedGoalError`
 * used to do and the only property of it worth keeping.
 */
export type RiskClass = "ROUTINE" | "SENSITIVE" | "REFUSE";

export interface StoppingCriteria {
  readonly maxIterations: number;
  readonly maxToolCalls: number;
  /** The planner's own words for "this is enough". Advisory; the budget is the enforcement. */
  readonly enough: string | null;
}

export interface InvestigationPlan {
  readonly supported: boolean;
  readonly userGoal: string;
  readonly entities: {
    readonly resolved: readonly ResolvedEntity[];
    readonly unresolved: readonly EntityMention[];
  };
  readonly informationNeeds: readonly InformationNeed[];
  readonly specialistTargets: readonly SpecialistName[];
  readonly candidateTools: readonly string[];
  readonly retrievalStrategy: RetrievalStrategy;
  readonly evidenceRequirements: readonly EvidenceRequirement[];
  readonly riskClass: RiskClass;
  readonly stoppingCriteria: StoppingCriteria;
  readonly clarificationNeeded: boolean;
  readonly clarificationReason: string | null;
  readonly rationale: string | null;
  /** Which model produced this plan. Never a hardcoded label — the `draftKindLabel` rule. */
  readonly plannerVersion: string;
  /**
   * How each need's scope was settled — the seller's words, a capability contract, or nothing.
   *
   * <b>Runtime-computed, never model-supplied.</b> The planner has no field for this and must not: a
   * model asked to name a default would name a plausible number. It is filled from the capability audit
   * in `defaults/OperationalDefaults.ts` after validation, which is also what decides whether a
   * clarification the model asked for actually reaches the seller.
   */
  readonly appliedDefaults: readonly AppliedDefault[];
}

/** The needs assigned to one specialist, in the strategy's order. */
export function needsInOrder(plan: InvestigationPlan, kinds: readonly NeedKind[]): InformationNeed[] {
  const wanted = new Set<string>(kinds);
  const byId = new Map(plan.informationNeeds.map((n) => [n.id, n]));
  const ordered: InformationNeed[] = [];
  for (const id of plan.retrievalStrategy.order) {
    const need = byId.get(id);
    if (need && wanted.has(need.kind)) {
      ordered.push(need);
      byId.delete(id);
    }
  }
  // A need the strategy forgot to order still runs — a planner omission must not silently drop work
  // the same planner declared required.
  for (const need of byId.values()) {
    if (wanted.has(need.kind)) {
      ordered.push(need);
    }
  }
  return ordered;
}
