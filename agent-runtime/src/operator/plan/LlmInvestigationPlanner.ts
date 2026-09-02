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
import type { InvestigationPlan, PlanFilters, PlanTarget, RiskClass } from "./InvestigationPlan";
import { MAX_PERIOD_DAYS } from "../../conversation/period";
import { NO_FILTERS, NO_TARGET } from "./InvestigationPlan";
import type { SpecialistName } from "../state/OperatorState";
import { validatePlan, PlanRejectedError, REPLANNABLE_REJECTIONS } from "./PlanValidator";
import type { PlanRejection } from "./PlanValidator";
import { scopeToken, withOperationalDefaults } from "../defaults/OperationalDefaults";
import { productResolvingSpecialists } from "../tools/ToolReachability";
import { mentionOf } from "./EntityRole";
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
  /** What the MODEL is shown: one `name: 설명` line per tool. */
  readonly catalogue: readonly string[];
  /**
   * What the VALIDATOR checks a plan's tool choice against: bare tool names.
   *
   * Separate from {@link catalogue} because the two are different shapes and conflating them was a
   * silent bug — V2 filtered `candidateTools` against the description lines, so every tool a planner
   * chose was dropped from every plan and `allowedTools` was only ever the specialist's own list.
   * Optional so a caller with nothing to check against keeps the old behaviour explicitly.
   */
  readonly toolNames?: readonly string[];
  readonly limits: PlanLimits;
  readonly priorContext?: string;
  /** This run's id, forwarded to the quota so one run costs one run slot however often it re-plans. */
  readonly runId?: string;
  /**
   * Permission to spend one more model call on a repair, from whoever owns the budget.
   *
   * <b>A repair is a real model call and must be charged like one.</b> The graph charges the FIRST
   * plan before calling this class; a second request made inside it would otherwise be invisible to
   * `OperatorBudget`, and a bounded loop whose bound cannot see half its own spend is not bounded.
   * Returning `false` means "no budget" and the rejection stands — which is the fail-closed direction.
   * Absent ⇒ one repair is allowed uncharged, which is the shape a unit test wants.
   */
  readonly chargeLlmCall?: () => boolean;
}

/** Why no plan exists. Every value ends the run; none of them selects an alternative planner. */
export type PlannerFailure =
  | "CAPABILITY_OFF"
  /**
   * The org's daily Agent budget is spent.
   *
   * Separate from `CAPABILITY_OFF` because the remedies are different and only one of them is the
   * seller's: "이 기능이 꺼져 있습니다" is an admin action, "오늘 몫을 다 썼습니다" is tomorrow. Both
   * arrive on the wire as `available=false`, which is exactly why the backend sends a message with the
   * second one and this failure exists to carry it.
   */
  | "QUOTA_EXHAUSTED"
  | "NO_ENDPOINT"
  | "TRANSPORT"
  | "OFF_SCHEMA"
  | "EMPTY_GOAL"
  | "PLAN_REJECTED";

export class PlannerUnavailableError extends Error {
  readonly failure: PlannerFailure;
  /**
   * A sentence the backend supplied for the seller, when it had one.
   *
   * Only the quota path sets this today. It is a separate field from {@link rejection} because that
   * one names a validator rule for a developer, and printing a rule name at a seller is how an
   * internal vocabulary escapes into the product.
   */
  sellerMessage?: string;
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
    /** The run this plan belongs to, so a re-plan does not buy a second daily run slot. */
    runId?: string;
    /** A second attempt at the same goal — the backend spends its stronger reasoning setting there. */
    retry?: boolean;
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
        ...(input.runId ? { runId: input.runId } : {}),
      });
    } catch {
      // The error is not inspected or logged: a backend error can quote the request.
      log("operator_plan", { plannerKind: "LLM", modelAnswered: false, reason: "TRANSPORT" });
      throw new PlannerUnavailableError("TRANSPORT", "the planner capability could not be reached");
    }

    if (!view.available) {
      // `providerVersion` present ⇒ the capability is ON and the model declined. Absent ⇒ it is off for
      // this org. Both end the run; they are distinguished only so the screen can say which.
      // A quota message is the backend saying WHY it refused. Checked before the version heuristic
      // because a quota refusal happens with the capability fully on, and would otherwise be reported
      // as a model that answered off-schema.
      const failure: PlannerFailure = view.quotaMessage
        ? "QUOTA_EXHAUSTED"
        : (view.providerVersion ? "OFF_SCHEMA" : "CAPABILITY_OFF");
      log("operator_plan", { plannerKind: "LLM", modelAnswered: false, reason: failure });
      const error = new PlannerUnavailableError(failure, "the planner produced no plan");
      // The backend's own sentence, whichever kind it sent. `unavailableMessage` does NOT change the
      // failure above: the capability really is off for this org, and only the sentence differs —
      // 「채널을 연결하시면…」 is a step the seller can take, 「기능이 꺼져 있습니다」 is not.
      if (view.quotaMessage) {
        error.sellerMessage = view.quotaMessage;
      } else if (view.unavailableMessage) {
        error.sellerMessage = view.unavailableMessage;
      }
      throw error;
    }

    const first = this.settle(toPlan(view, goalText), goalText, input);
    if (first.ok) {
      return first.plan;
    }

    // ── The bounded repair. Exactly one, and only for a rejection a re-plan can actually fix.
    //
    // <b>What is sent back is the RULE, not a plan.</b> The planner is told which contract its plan
    // broke and which capability would satisfy it; it decides what to do about that. Naming the
    // specialist here is naming a capability the catalogue already advertises — it is not composing a
    // plan, and nothing on this side edits the answer that comes back. The alternative, adding the
    // specialist ourselves, is the deterministic second planner invariant I2 exists to forbid (A8).
    if (!REPLANNABLE_REJECTIONS.includes(first.rejection)) {
      throw first.error;
    }
    if (input.chargeLlmCall && !input.chargeLlmCall()) {
      log("operator_plan_repair", { rejection: first.rejection, attempted: false, reason: "BUDGET" });
      throw first.error;
    }
    log("operator_plan_repair", { rejection: first.rejection, attempted: true });

    let repaired: AgentPlanView;
    try {
      repaired = await this.backend.planGoal({
        goalText,
        toolCatalogue: [...input.catalogue],
        priorContext: repairContext(first.rejection, input.priorContext),
        // <b>The one call that gets the stronger reasoning setting</b>, and the reason it is this one:
        // the plan just broke a structural contract and is being told which rule it broke. That is a
        // question with a right answer that thinking can reach.
        //
        // Two neighbouring cases were tried and measured, and neither is here. A FOLLOW-UP sentence
        // also carries `priorContext` (the conversation's working-set line) and is not hard at all —
        // treating it as one put every second sentence of a conversation at 5.6–9.6s against 3.4s. A
        // graph RE-PLAN is about the world rather than the plan: measured live 2026-09-01, one took
        // 12.6s at the stronger setting to return a plan with no needs and no specialists, on a turn
        // that had already spent 6.6s. Cost certain, benefit unobserved.
        retry: true,
      });
    } catch {
      throw new PlannerUnavailableError("TRANSPORT", "the planner capability could not be reached");
    }
    if (!repaired.available) {
      throw new PlannerUnavailableError(
        repaired.providerVersion ? "OFF_SCHEMA" : "CAPABILITY_OFF",
        "the planner produced no plan",
      );
    }
    const second = this.settle(toPlan(repaired, goalText), goalText, input);
    if (second.ok) {
      log("operator_plan_repair", { rejection: first.rejection, attempted: true, repaired: true });
      return second.plan;
    }
    // Twice is the bound. A third request would be the same question with the same input, and a loop
    // that keeps asking is how a bounded planner becomes an unbounded bill.
    log("operator_plan_repair", {
      rejection: first.rejection, attempted: true, repaired: false, again: second.rejection,
    });
    throw second.error;
  }

  /**
   * Audit, validate and log one candidate plan — the part that runs identically for a first attempt
   * and for a repair, so the two cannot drift into different contracts.
   */
  private settle(raw: InvestigationPlan, goalText: string, input: PlanInput):
    | { ok: true; plan: InvestigationPlan }
    | { ok: false; rejection: PlanRejection; error: PlannerUnavailableError } {
    try {
      // The capability audit runs BEFORE validation, and the order is load-bearing: V8 strips every
      // specialist from a plan that asks a question, so a clarification the contracts already answer
      // has to be resolved while the plan still knows what it was going to do. After the audit, every
      // need carries the scope it will actually be pursued under.
      const audited = withOperationalDefaults(raw, goalText);
      const validated = validatePlan(audited, {
        catalogue: input.toolNames ?? input.catalogue,
        limits: input.limits,
      });
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
        // WHICH KINDS were named and whether each was read as one thing or a kind of thing — the pair
        // that decides the entity axis for the whole run. Closed vocabulary on both sides: never the
        // mention itself, which is the seller's own words. Without it, A9 was invisible in a log — two
        // runs of one sentence scoped differently and nothing said why.
        entityRoles: validated.entities.unresolved.map((e) => `${e.kind}:${e.role}`).join(","),
        // Whether the model asked, and whether the audit let the question through. The gap between the
        // two is exactly the A4 defect, and without both numbers it is invisible in a log.
        modelAskedToClarify: raw.clarificationNeeded,
        clarifies: validated.clarificationNeeded,
        scopes: validated.appliedDefaults
          .map((d) => `${d.source}:${scopeToken(d.scope)}`)
          .join(","),
      });
      return { ok: true, plan: validated };
    } catch (err) {
      if (err instanceof PlanRejectedError) {
        log("operator_plan", { plannerKind: "LLM", modelAnswered: true, reason: err.rejection });
        return {
          ok: false,
          rejection: err.rejection,
          error: new PlannerUnavailableError(
            "PLAN_REJECTED", "the plan did not satisfy the contract", err.rejection,
          ),
        };
      }
      throw err;
    }
  }
}

/**
 * What the planner is told when its plan was refused.
 *
 * <b>Closed vocabulary, same payload floor as everything else at this seam.</b> A rejection name, the
 * rule in one sentence, and the capability that would satisfy it — no seller row, no id, no mention,
 * no evidence. The earlier progress line (present on a re-plan) is kept alongside it, because a repair
 * that forgets what has already been satisfied re-plans work the run has done.
 */
function repairContext(rejection: PlanRejection, prior: string | undefined): string {
  const rule = rejection === "PRODUCT_UNRESOLVABLE"
    ? `plan-invalid: PRODUCT_UNRESOLVABLE. The goal names a product and the plan left it unresolved `
      + `while dispatching none of ${productResolvingSpecialists().join("/")} — the only specialists `
      + "that can resolve a product name into a product. A plan whose needs are about a product must "
      + "dispatch one of them. Do not supply a product id: resolution is a tool's job."
    : `plan-invalid: ${rejection}.`;
  return prior ? `${prior} | ${rule}` : rule;
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
        // <b>The one place a mention's role is decided.</b> Computed, never read off the wire: the
        // model has no field for it and could not be trusted with one — see `plan/EntityRole.ts`.
        .map((e) => mentionOf(normalizeEntityKind(e.kind), e.mention.trim())),
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
    // v3. Absent sections are defaults, never a failure; an unknown token is the default too.
    requestedAction: oneOf(view.requestedAction, ["PREPARE_INQUIRY_DRAFT", "REQUEST_SEND_APPROVAL", "OPEN_WORKSPACE", "LIST_ACTIONS", "EXPLAIN_CAPABILITY"] as const) ?? "NONE",
    tone: oneOf(view.tone, ["SOFTER", "MORE_FORMAL", "SHORTER"] as const),
    filters: filtersOf(view.filters),
    target: targetOf(view.target),
  };
}

/** A closed-set read: the value when it is one of the allowed tokens, else null. */
function oneOf<T extends string>(value: string | null | undefined, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function filtersOf(raw: AgentPlanView["filters"]): PlanFilters {
  if (!raw) return NO_FILTERS;
  return {
    period: oneOf(raw.period, ["TODAY", "YESTERDAY", "LAST_7_DAYS", "LAST_14_DAYS", "LAST_30_DAYS", "THIS_WEEK", "LAST_WEEK", "THIS_MONTH", "LAST_MONTH", "LAST_N_DAYS"] as const),
    // The day count is only a window WITH the token that needs one: a number beside 「오늘」 would be a
    // second period the seller did not name, so it is dropped rather than reconciled.
    periodDays: raw.period === "LAST_N_DAYS" && typeof raw.periodDays === "number" && Number.isInteger(raw.periodDays)
      && raw.periodDays >= 1 ? Math.min(raw.periodDays, MAX_PERIOD_DAYS) : null,
    rating: oneOf(raw.rating, ["ALL", "LOW"] as const),
    channel: oneOf(raw.channel, ["NAVER", "COUPANG", "CAFE24"] as const),
    scope: oneOf(raw.scope, ["WORKING_SET", "ORG"] as const),
    topic: oneOf(raw.topic, ["SHIPPING", "EXCHANGE_RETURN", "PRODUCT_SPEC", "USAGE", "OTHER"] as const),
    reviewIntent: oneOf(raw.reviewIntent, ["ROWS", "ISSUES"] as const),
    inquiryIntent: oneOf(raw.inquiryIntent, ["ROWS", "WORKLOAD", "COUNT", "PRIORITY"] as const),
    limit: typeof raw.limit === "number" && Number.isInteger(raw.limit) && raw.limit >= 1 ? Math.min(raw.limit, MAX_LIMIT) : null,
    order: oneOf(raw.order, ["NEWEST", "OLDEST"] as const),
    status: oneOf(raw.status, ["UNANSWERED", "ANSWERED", "ALL"] as const),
  };
}

/** The most rows a plan may ask for — the backend parser clamps to the same number. */
export const MAX_LIMIT = 50;

function targetOf(raw: AgentPlanView["target"]): PlanTarget {
  if (!raw) return NO_TARGET;
  const selector = oneOf(raw.selector, ["FIRST", "NTH", "ALL", "THIS"] as const) ?? "NONE";
  const index = typeof raw.index === "number" && Number.isInteger(raw.index) && raw.index >= 1 ? raw.index : null;
  return { selector, index: selector === "NTH" ? index : null };
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
    "PRODUCT_FACT", "PRODUCT_CATALOG", "PRODUCT_LISTING", "PRODUCT_VARIANT", "PRODUCT_KNOWLEDGE_DOC", "POLICY",
    "CUSTOMER_HISTORY",
    "REVIEW_SIGNAL", "INQUIRY_VOLUME", "REPEAT_PATTERN", "ORDER_HISTORY", "COMPANY_PROFILE", "PAST_ANSWER",
  ];
  return (known.includes(kind ?? "") ? kind : "REVIEW_SIGNAL") as import("./InvestigationPlan").NeedKind;
}
