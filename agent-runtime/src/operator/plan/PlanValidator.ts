/**
 * The plan validator: safety and contract only.
 *
 * <b>What it must never do is the whole design.</b> It does not add a missing information need, pick a
 * specialist for an empty list, suggest a tool, or fill a blank strategy. The moment it does any of
 * those it IS a second planner — a deterministic one, sitting exactly where invariant I2 says none may
 * exist — and every divergence test would then be measuring the validator's defaults rather than the
 * model's understanding. So a plan that fails a structural rule is REPAIRED ONCE (drop the invalid
 * parts and re-check) and then REJECTED. A rejected plan fails the run; it never becomes a small plan.
 *
 * <b>Repair means removal, never substitution.</b> An unknown specialist is dropped, a tool outside the
 * catalogue is dropped, an evidence requirement pointing at a need that does not exist is dropped, and
 * a stopping criterion above the system budget is clamped DOWN. Nothing is ever added.
 */
import type {
  EvidenceRequirement,
  InformationNeed,
  InvestigationPlan,
  RetrievalStrategy,
} from "./InvestigationPlan";
import type { SpecialistName } from "../state/OperatorState";
import { productResolvingSpecialists } from "../tools/ToolReachability";
import { namesInstance } from "./EntityRole";

const ALL_SPECIALISTS: readonly SpecialistName[] =
  ["PRODUCT_OPS", "REVIEW_OPS", "INQUIRY_OPS", "ORDER_OPS", "REPORT_OPS"];

/** v3: the actions a plan may request. Anything else becomes NONE — a default, never a rejection. */
const REQUESTED_ACTIONS: readonly string[] =
  ["NONE", "PREPARE_INQUIRY_DRAFT", "REQUEST_SEND_APPROVAL", "OPEN_WORKSPACE", "LIST_ACTIONS", "EXPLAIN_CAPABILITY"];

/** Why a plan was refused. Surfaced to the run, never to a vendor. */
export type PlanRejection =
  | "NO_SPECIALIST"
  | "NO_INFORMATION_NEED"
  | "PLANNER_FABRICATED_ENTITY_ID"
  | "EMPTY_GOAL"
  /**
   * The plan names a product it has not resolved, and dispatches nobody who could resolve it.
   *
   * <b>Defect A8, and the reason it is a REJECTION rather than a fix.</b> Measured over ten live runs
   * of one sentence, the planner dispatched the product specialist six times; the other four planned
   * product-scoped needs and sent only the org-wide specialists, so the run read the whole org, the
   * scope gate refused every row, and the seller was told nothing about the product they had named.
   * The obvious repair — have the validator add PRODUCT_OPS — is exactly the deterministic second
   * planner invariant I2 forbids, and it would make every divergence test measure this file's defaults.
   * So the plan is refused with a reason the PLANNER can act on, and the planner re-plans once.
   */
  | "PRODUCT_UNRESOLVABLE";

/**
 * Rejections a re-plan can actually fix, and therefore the only ones worth spending a model call on.
 *
 * <b>Everything else here is already repaired by removal or is unfixable by asking again.</b> A plan
 * with no information need, or one that minted an entity id, would be asked the same question with the
 * same input and answer it the same way — a retry loop that buys nothing. This one is different: the
 * plan is missing a CAPABILITY the planner can add, and naming which one is new information.
 */
export const REPLANNABLE_REJECTIONS: readonly PlanRejection[] = ["PRODUCT_UNRESOLVABLE"];

export class PlanRejectedError extends Error {
  readonly rejection: PlanRejection;

  constructor(rejection: PlanRejection, message: string) {
    super(message);
    this.name = "PlanRejectedError";
    this.rejection = rejection;
  }
}

export interface PlanLimits {
  readonly maxIterations: number;
  readonly maxToolCalls: number;
}

export interface PlanValidatorDeps {
  /** Every tool name the registry knows. A plan may name no other. */
  readonly catalogue: readonly string[];
  /** The system budget. A plan may lower its own ceiling; it may never raise it. */
  readonly limits: PlanLimits;
}

/**
 * Validate, repairing once by removal.
 *
 * @throws PlanRejectedError when the plan cannot stand after that one repair
 */
export function validatePlan(plan: InvestigationPlan, deps: PlanValidatorDeps): InvestigationPlan {
  // V6 — no repair, ever. A planner that can mint an entity id can mint a plausible wrong one, and a
  // tool reading it would return an honest empty answer about a product nobody looked at.
  if (plan.entities.resolved.length > 0) {
    throw new PlanRejectedError(
      "PLANNER_FABRICATED_ENTITY_ID",
      "plan carried resolved entities: entity resolution is a tool's job, never the planner's",
    );
  }
  if (plan.userGoal.trim().length === 0) {
    throw new PlanRejectedError("EMPTY_GOAL", "plan restated no goal");
  }

  // V10 (v3) — `requestedAction` is a closed set; an unknown value is NONE. Never a rejection: the
  // action axis is additive to a plan that already stands, and refusing a plan over it would fail a
  // read the seller asked for because of a word the model chose for the second half.
  if (!REQUESTED_ACTIONS.includes(plan.requestedAction ?? "NONE")) {
    plan = { ...plan, requestedAction: "NONE" };
  }

  // V7 — a refusal is an answer. It is passed through unchanged so the run can say so honestly.
  if (!plan.supported || plan.riskClass === "REFUSE") {
    return { ...plan, supported: false, specialistTargets: [], candidateTools: [] };
  }
  // V8 — a clarification runs no specialist. The answer is the question.
  if (plan.clarificationNeeded) {
    return { ...plan, specialistTargets: [], candidateTools: [] };
  }

  // V11 (v3) — a navigation-only plan runs no specialist either. 「문의 화면 열어줘」 asks for a screen,
  // not for facts; refusing it for having nothing to find out would send the seller to a failure card
  // for the one request that needs no investigation at all.
  const explainOrOpen = (plan.requestedAction ?? "NONE") === "OPEN_WORKSPACE" || (plan.requestedAction ?? "NONE") === "EXPLAIN_CAPABILITY";
  if (explainOrOpen && plan.informationNeeds.filter((n) => isUsableNeed(n)).length === 0) {
    return { ...plan, specialistTargets: [], candidateTools: [] };
  }

  // V1 — unknown specialist names removed.
  const specialists = plan.specialistTargets.filter(
    (s): s is SpecialistName => (ALL_SPECIALISTS as readonly string[]).includes(s),
  );
  if (specialists.length === 0) {
    throw new PlanRejectedError("NO_SPECIALIST", "plan named no known specialist");
  }

  // V9 (A8) — a plan that names a product must be able to REACH it.
  //
  // The entity axis of every scope check turns on a resolved product (`scope/EvidenceScope.ts`
  // invariant 1), so a plan that leaves a product mention with no resolver has already decided that
  // every product-scoped need in it will be refused. Better to say so here, while the planner can
  // still be asked again, than to run four reads whose every row the gate will throw away.
  //
  // <b>An INSTANCE, not any product word.</b> "상품별 최근 문제를 알려줘" names no product to reach, and
  // demanding PRODUCT_OPS for it would make this rule a deterministic planner for a question that never
  // needed one (`plan/EntityRole.ts`).
  const resolvers = productResolvingSpecialists();
  const namesProduct = namesInstance(plan, ["PRODUCT"], []);
  if (namesProduct && !specialists.some((s) => resolvers.includes(s))) {
    throw new PlanRejectedError(
      "PRODUCT_UNRESOLVABLE",
      `plan named a product mention but dispatched none of ${resolvers.join("/")}, `
        + "the only specialists that can resolve one",
    );
  }

  // V3 — a supported plan with nothing to find out is not a plan.
  const needs = plan.informationNeeds.filter((n) => isUsableNeed(n));
  if (needs.length === 0) {
    throw new PlanRejectedError("NO_INFORMATION_NEED", "plan declared no information need");
  }

  // V2 — tools outside the catalogue removed. The registry refuses them again at invocation; removing
  // them here only keeps a hallucinated name out of a plan a human reads.
  const known = new Set(deps.catalogue);
  const candidateTools = plan.candidateTools.filter((t) => known.has(t));

  // V4 — evidence requirements pointing at needs that do not exist removed.
  const needIds = new Set(needs.map((n) => n.id));
  const evidenceRequirements: EvidenceRequirement[] = plan.evidenceRequirements
    .filter((r) => needIds.has(r.needId))
    .map((r) => ({ ...r, minEvidence: Math.max(1, Math.min(r.minEvidence, 10)) }));

  // V5 — the strategy may only reference real needs, and a need the planner forgot to order is
  // appended rather than dropped: it declared the need, and silently not pursuing it would be the
  // validator quietly editing the plan's substance.
  const ordered = plan.retrievalStrategy.order.filter((id) => needIds.has(id));
  const missing = needs.map((n) => n.id).filter((id) => !ordered.includes(id));
  const retrievalStrategy: RetrievalStrategy = {
    order: [...ordered, ...missing],
    parallelizable: plan.retrievalStrategy.parallelizable.filter((id) => needIds.has(id)),
    stopWhen: plan.retrievalStrategy.stopWhen,
  };

  return {
    ...plan,
    specialistTargets: specialists,
    informationNeeds: needs,
    candidateTools,
    evidenceRequirements,
    retrievalStrategy,
    stoppingCriteria: {
      // Clamped DOWN only. A model that asked for more budget than the system allows gets the system's.
      maxIterations: clamp(plan.stoppingCriteria.maxIterations, deps.limits.maxIterations),
      maxToolCalls: clamp(plan.stoppingCriteria.maxToolCalls, deps.limits.maxToolCalls),
      enough: plan.stoppingCriteria.enough,
    },
  };
}

function isUsableNeed(need: InformationNeed): boolean {
  return need.id.trim().length > 0 && need.question.trim().length > 0;
}

function clamp(value: number, ceiling: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return ceiling;
  }
  return Math.min(Math.trunc(value), ceiling);
}
