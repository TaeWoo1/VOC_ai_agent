/**
 * The planner. There is exactly one, and it reaches a model.
 *
 * <b>There is no deterministic sibling, no fallback and no test double at this seam.</b> The keyword
 * planner that used to sit underneath this one is deleted (`docs/sellerops_operator_graph_v2.md` §12.1):
 * with it present, every property this class is supposed to have could be satisfied by it instead, and
 * a deployment could believe it was running an agent while a table answered. `plannerFence.test.ts`
 * asserts that {@link Planner} has exactly one implementation and that its `kind` is `LLM`.
 *
 * <b>Tests fake the TRANSPORT, not the strategy.</b> A test supplies a {@link PlanBackend} whose
 * `planGoal` replays a plan a real model actually produced (`test/support/recordedPlans/`). That keeps
 * CI runnable with no vendor key while leaving the only planning strategy in the process the real one.
 *
 * <b>Failure is failure.</b> Capability off, no endpoint, transport error, off-schema after one
 * repair — every one of them throws {@link PlannerUnavailableError}. The run ends FAILED with no
 * findings. Nothing here composes a smaller answer, because a smaller answer is what a fallback is.
 *
 * <b>The payload floor is unchanged from v1.</b> The operator's own sentence plus a static tool
 * catalogue plus the closed need/entity vocabularies. No seller row, no id, no org, no customer text —
 * asserted on the backend's serialized bytes by `AgentPlanPayloadFloorTest`.
 */
import type { GoalRequest } from "../../goal/parseGoal";
import type { AgentPlanView } from "../../spring/types";
import type { InvestigationPlan, RiskClass } from "./InvestigationPlan";
import type { SpecialistName } from "../state/OperatorState";
import { validatePlan, PlanRejectedError } from "./PlanValidator";
import { scopeToken, withOperationalDefaults } from "../defaults/OperationalDefaults";
import type { PlanLimits } from "./PlanValidator";
import { log } from "../../log";

export interface Planner {
  /** Always `"LLM"`. The union has one member so a second strategy cannot be added quietly. */
  readonly kind: "LLM";
  /**
   * Interpret a goal, or fail.
   *
   * @param priorContext present on a re-plan: what has been satisfied and what has not, in closed
   *     vocabulary. Never evidence content, never a customer sentence.
   * @throws PlannerUnavailableError when no usable plan can be produced
   */
  plan(request: PlanInput): Promise<InvestigationPlan>;
}

export interface PlanInput {
  readonly request: GoalRequest;
  readonly catalogue: readonly string[];
  readonly limits: PlanLimits;
  readonly priorContext?: string;
}

/** Why no plan exists. Every value ends the run; none of them selects an alternative planner. */
export type PlannerFailure =
  | "CAPABILITY_OFF"
  | "NO_ENDPOINT"
  | "TRANSPORT"
  | "OFF_SCHEMA"
  | "EMPTY_GOAL"
  | "PLAN_REJECTED";

export class PlannerUnavailableError extends Error {
  readonly failure: PlannerFailure;
  /** Set when the validator refused a structurally-invalid plan; names which rule. */
  readonly rejection?: string;

  constructor(failure: PlannerFailure, message: string, rejection?: string) {
    super(message);
    this.name = "PlannerUnavailableError";
    this.failure = failure;
    if (rejection) {
      this.rejection = rejection;
    }
  }
}

/** The backend call this planner needs. Structural, so any client that has it fits. */
export interface PlanBackend {
  planGoal?(request: {
    goalText: string;
    toolCatalogue: string[];
    priorContext?: string;
  }): Promise<AgentPlanView>;
}

export class LlmInvestigationPlanner implements Planner {
  readonly kind = "LLM" as const;

  constructor(private readonly backend: PlanBackend) {}

  async plan(input: PlanInput): Promise<InvestigationPlan> {
    const goalText = (input.request.text ?? "").trim();
    if (goalText.length === 0) {
      throw new PlannerUnavailableError("EMPTY_GOAL", "no goal sentence to interpret");
    }
    if (typeof this.backend.planGoal !== "function") {
      throw new PlannerUnavailableError("NO_ENDPOINT", "the backend exposes no planner endpoint");
    }

    let view: AgentPlanView;
    try {
      view = await this.backend.planGoal({
        goalText,
        toolCatalogue: [...input.catalogue],
        ...(input.priorContext ? { priorContext: input.priorContext } : {}),
      });
    } catch {
      // The error is not inspected or logged: a backend error can quote the request.
      log("operator_plan", { plannerKind: "LLM", modelAnswered: false, reason: "TRANSPORT" });
      throw new PlannerUnavailableError("TRANSPORT", "the planner capability could not be reached");
    }

    if (!view.available) {
      // `providerVersion` present ⇒ the capability is ON and the model declined. Absent ⇒ it is off for
      // this org. Both end the run; they are distinguished only so the screen can say which.
      const failure: PlannerFailure = view.providerVersion ? "OFF_SCHEMA" : "CAPABILITY_OFF";
      log("operator_plan", { plannerKind: "LLM", modelAnswered: false, reason: failure });
      throw new PlannerUnavailableError(failure, "the planner produced no plan");
    }

    const raw = toPlan(view, goalText);
    try {
      // The capability audit runs BEFORE validation, and the order is load-bearing: V8 strips every
      // specialist from a plan that asks a question, so a clarification the contracts already answer
      // has to be resolved while the plan still knows what it was going to do. After the audit, every
      // need carries the scope it will actually be pursued under.
      const audited = withOperationalDefaults(raw, goalText);
      const validated = validatePlan(audited, { catalogue: input.catalogue, limits: input.limits });
      log("operator_plan", {
        plannerKind: "LLM",
        modelAnswered: true,
        supported: validated.supported,
        needs: validated.informationNeeds.length,
        specialists: validated.specialistTargets.length,
        tools: validated.candidateTools.length,
        // WHETHER a period was named, never WHICH — the mention is the seller's own words. This one
        // boolean is what made the 2026-08-23 divergence diagnosable: two runs of one sentence took
        // different temporal paths and no log said which had named a period.
        periodNamed: validated.entities.unresolved.some((e) => e.kind === "PERIOD"),
        // Whether the model asked, and whether the audit let the question through. The gap between the
        // two is exactly the A4 defect, and without both numbers it is invisible in a log.
        modelAskedToClarify: view.clarificationNeeded === true,
        clarifies: validated.clarificationNeeded,
        scopes: validated.appliedDefaults
          .map((d) => `${d.source}:${scopeToken(d.scope)}`)
          .join(","),
      });
      return validated;
    } catch (err) {
      if (err instanceof PlanRejectedError) {
        log("operator_plan", { plannerKind: "LLM", modelAnswered: true, reason: err.rejection });
        throw new PlannerUnavailableError("PLAN_REJECTED", "the plan did not satisfy the contract", err.rejection);
      }
      throw err;
    }
  }
}

/**
 * The wire view → the plan shape.
 *
 * <b>Missing fields become empty, never defaults with content.</b> An absent `informationNeeds` array
 * arrives as `[]` and the validator then rejects the plan; substituting a plausible need here would be
 * this function doing the planning.
 */
function toPlan(view: AgentPlanView, goalText: string): InvestigationPlan {
  const risk: RiskClass =
    view.riskClass === "REFUSE" || view.riskClass === "SENSITIVE" ? view.riskClass : "ROUTINE";
  return {
    supported: view.supported,
    userGoal: (view.userGoal ?? goalText).trim(),
    entities: {
      // Always empty on the way in. The validator refuses a plan that filled it, and the run fills it
      // from tool results only.
      resolved: [],
      unresolved: (view.unresolvedEntities ?? [])
        .filter((e) => e && typeof e.mention === "string" && e.mention.trim().length > 0)
        .map((e) => ({ kind: normalizeEntityKind(e.kind), mention: e.mention.trim() })),
    },
    informationNeeds: (view.informationNeeds ?? []).map((n, index) => ({
      id: n.id && n.id.trim().length > 0 ? n.id.trim() : `n${index + 1}`,
      question: (n.question ?? "").trim(),
      kind: normalizeNeedKind(n.kind),
      why: (n.why ?? "").trim(),
      required: n.required !== false,
    })),
    specialistTargets: (view.specialists ?? []) as SpecialistName[],
    candidateTools: view.tools ?? [],
    retrievalStrategy: {
      order: view.retrievalOrder ?? [],
      parallelizable: view.retrievalParallel ?? [],
      stopWhen: view.retrievalStopWhen ?? null,
    },
    evidenceRequirements: (view.evidenceRequirements ?? []).map((r) => ({
      needId: (r.needId ?? "").trim(),
      minEvidence: typeof r.minEvidence === "number" ? r.minEvidence : 1,
      acceptableKinds: r.acceptableKinds ?? [],
    })),
    riskClass: risk,
    stoppingCriteria: {
      maxIterations: view.maxIterations ?? 0,
      maxToolCalls: view.maxToolCalls ?? 0,
      enough: view.stopWhenEnough ?? null,
    },
    // The model's own flag, kept verbatim here. `withOperationalDefaults` decides whether it survives
    // the capability audit — this function must not, because it has not seen the contracts yet.
    clarificationNeeded: view.clarificationNeeded === true,
    clarificationReason: view.clarificationReason ?? null,
    // Empty until the capability audit fills it. A model-supplied value would be a guessed default.
    appliedDefaults: [],
    rationale: view.rationale ?? null,
    plannerVersion: view.providerVersion ?? "agent-plan/unknown",
  };
}

/** An unrecognised entity kind becomes PRODUCT — the only kind a specialist can resolve today. */
function normalizeEntityKind(kind: string | undefined): import("./InvestigationPlan").EntityKind {
  const known = ["PRODUCT", "CHANNEL", "ORDER", "INQUIRY", "ISSUE", "PERIOD"];
  return (known.includes(kind ?? "") ? kind : "PRODUCT") as import("./InvestigationPlan").EntityKind;
}

/**
 * An unrecognised need kind becomes REVIEW_SIGNAL.
 *
 * Chosen because it is the kind whose specialist reads the LEAST — a mislabelled need should cost one
 * cheap read, not send the product specialist resolving a mention it does not have.
 */
function normalizeNeedKind(kind: string | undefined): import("./InvestigationPlan").NeedKind {
  const known = [
    "PRODUCT_FACT", "PRODUCT_LISTING", "PRODUCT_VARIANT", "POLICY", "CUSTOMER_HISTORY",
    "REVIEW_SIGNAL", "INQUIRY_VOLUME", "REPEAT_PATTERN", "ORDER_HISTORY",
  ];
  return (known.includes(kind ?? "") ? kind : "REVIEW_SIGNAL") as import("./InvestigationPlan").NeedKind;
}
