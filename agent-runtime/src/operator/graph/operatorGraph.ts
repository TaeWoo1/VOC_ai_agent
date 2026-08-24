/**
 * The OperatorGraph — the one thing that reads a seller's sentence and decides what to do about it.
 *
 *   interpretGoal → dispatch → judge → (interpretGoal, bounded) → compose → DONE
 *
 * <b>What it is responsible for, and what it must never take over.</b> It interprets the goal (through
 * the LLM planner and only through it), dispatches specialists onto the plan's information needs,
 * collects evidence, judges what may be said, and decides whether one more look is worth it. It
 * computes no domain judgement of its own: every number in an answer was decided by Spring, and every
 * trend word came from `IssueChangeRules`.
 *
 * <b>No plan, no run.</b> `interpretGoal` throws {@link PlannerUnavailableError} when a plan cannot be
 * made, and the runtime turns that into a FAILED run with no findings. There is no deterministic
 * planner behind it and no smaller answer to fall back to — that absence IS invariant I2.
 *
 * <b>The loop is bounded and fail-closed.</b> Every cycle is guarded, every tool and model call is
 * charged before it happens, exhaustion ends the run with what it has and SAYS so.
 *
 * <b>Why the second pass re-PLANS rather than re-running.</b> v1 answered "needsMore" by dispatching
 * the same specialists again, which could only produce the same reads. v2 hands the planner what is
 * still unsatisfied — need ids and statuses, closed vocabulary, no evidence content — and lets it
 * design the next step. The budget is the ceiling either way.
 */
import { END, START, StateGraph } from "@langchain/langgraph";
import { OperatorStateAnnotation } from "../state/OperatorState";
import type {
  AnsweredNeed,
  EvidenceRef,
  Finding,
  NextAction,
  OperatorAnswer,
  OperatorState,
  OperatorStopReason,
  SpecialistName,
  SpecialistOutcomeView,
  SpecialistResult,
} from "../state/OperatorState";
import type { InvestigationPlan, NeedState, ResolvedEntity } from "../plan/InvestigationPlan";
import { needsInOrder } from "../plan/InvestigationPlan";
import { instanceMentionsOf, isInstance } from "../plan/EntityRole";
import { groupingOf } from "../group/ProductGrouping";
import type { NeedScope, RejectedEvidence } from "../scope/EvidenceScope";
import {
  channelScopeOf, needScopeOf, partitionEvidence, periodNamedIn, planScopeOf, reasonSentence,
} from "../scope/EvidenceScope";
import { basisSentence } from "../defaults/OperationalDefaults";
import type { SpecialistTerminal, ToolFailure } from "../failure/SpecialistOutcome";
import { classifyToolError, failureSentence, terminalOf } from "../failure/SpecialistOutcome";
import { EvidenceBuilder } from "../state/evidence";
import { confidenceOf } from "../judge/EvidenceJudge";
import type { EvidenceJudge } from "../judge/EvidenceJudge";
import type { Planner } from "../plan/LlmInvestigationPlanner";
import type { OperatorToolRegistry } from "../tools/OperatorToolRegistry";
import { OPERATOR_TOOL, toolCatalogueFor } from "../tools/OperatorTools";
import type { ClassifiedTool } from "../tools/OperatorTools";
import { reachableToolNames, toolsFor } from "../tools/ToolReachability";
import type { OperatorBudget } from "../budget/OperatorBudget";
import { runProductOps, PRODUCT_NEEDS } from "./productOps";
import { runReviewOps, REVIEW_NEEDS } from "./reviewOps";
import { runInquiryOps, INQUIRY_NEEDS } from "./inquiryOps";
import { runReportOps } from "./reportOpsNode";
import type { KnowledgeCoverageRow, SignalCoverage } from "../../spring/types";
import { log } from "../../log";

export interface OperatorGraphDeps {
  readonly registry: OperatorToolRegistry;
  readonly tools: readonly ClassifiedTool[];
  readonly planner: Planner;
  readonly judge: EvidenceJudge;
  readonly budget: OperatorBudget;
  readonly referenceDate?: string;
}

/**
 * A specialist's own tools come from the capability matrix — see `tools/ToolReachability.ts`, which is
 * also what decides which tools the planner is shown at all. Keeping both readings in one table is the
 * point: a tool a specialist can run is a tool the planner may choose, and nothing else is.
 */

/**
 * The words that mean "write it for me".
 *
 * Tiny and deliberately not clever: it decides only whether one honest sentence about the lane's limit
 * appears. It is not consulted for routing, for tool choice or for status — `goalRoutingFence` guards
 * the place where free text IS interpreted (`parseGoal`), and this is not that place.
 */
const DRAFT_WORDS = ["초안", "답변 작성", "답장 작성", "답변을 작성", "써줘", "작성해줘"] as const;

export function buildOperatorGraph(deps: OperatorGraphDeps) {
  // <b>Only what something can actually run.</b> A tool with no caller is not advertised: a planner
  // shown eleven dead names spends model budget choosing them, and a plan that names one reads, to a
  // human, like a capability the product has (`tools/ToolReachability.ts`).
  const reachable = new Set(reachableToolNames());
  const advertised = deps.tools.filter((t) => reachable.has(t.tool.name));
  const catalogue = toolCatalogueFor(advertised);
  const toolNames = advertised.map((t) => t.tool.name);
  // One builder per graph build, so evidence ids are unique within a run and stable across its passes.
  // It also carries the run's as-of date, so every ref records WHEN it was read — which is not, and can
  // never become, a claim about when the underlying rows happened (`scope/EvidenceTime.ts`).
  const evidence = new EvidenceBuilder(deps.referenceDate);

  async function interpretGoal(state: OperatorState): Promise<Partial<OperatorState>> {
    if (!deps.budget.beginIteration()) {
      return { trail: ["budget_exhausted_before_plan"] };
    }
    // A planner call is always a model call now, so it is always charged before it is made.
    if (!deps.budget.spend("llm")) {
      return { trail: ["budget_exhausted_before_plan"] };
    }
    // Throws PlannerUnavailableError. Deliberately NOT caught here: the runtime turns it into a FAILED
    // run, and catching it in the graph would be the first step toward answering anyway.
    const plan = await deps.planner.plan({
      request: { text: state.goalText, referenceDate: deps.referenceDate },
      catalogue,
      // The NAMES, separately from the catalogue lines. The validator matches a plan's tool choice
      // against this; matching it against the description lines silently dropped every tool a planner
      // ever chose (found reading the seam for A5 — the lines are `name: 설명`, never a bare name).
      toolNames,
      limits: deps.budget.limits(),
      // A repair is a second model call and is charged like the first (A8). Refused budget ⇒ no
      // repair, and the rejection stands as a failed run rather than as a quiet smaller answer.
      chargeLlmCall: () => deps.budget.spend("llm"),
      ...(state.plan ? { priorContext: progressLine(state) } : {}),
    });
    log("operator_plan_node", {
      supported: plan.supported,
      needs: plan.informationNeeds.length,
      specialists: plan.specialistTargets.length,
      replan: state.plan != null,
      // Which axis the answer will be grouped along. A closed value, never the words behind it — an
      // operator reading a trace must be able to see that a "어느 상품" question was read as one.
      grouping: groupingOf(plan, state.goalText),
      periodNamed: periodNamedIn(plan),
      // `?? "NONE"` because `typeof null === "object"` and the trace printed "<object>",
      // which reads as a value that could not be logged rather than as "no channel named".
      channelScope: channelScopeOf(plan) ?? "NONE",
    });
    return {
      plan,
      // Needs enter as PENDING; the specialists move them. A need that never moves is what `compose`
      // reads to say "this was not answered" instead of falling silent.
      needs: plan.informationNeeds.map((n) => ({ id: n.id, status: "PENDING" as const, evidenceIds: [] })),
      trail: [state.plan ? "replanned" : "planned"],
    };
  }

  async function dispatch(state: OperatorState): Promise<Partial<OperatorState>> {
    const plan = state.plan;
    if (!plan || !plan.supported || plan.clarificationNeeded) {
      return { trail: ["dispatch_skipped"] };
    }
    const results: SpecialistResult[] = [];
    const needStates: NeedState[] = [];
    const resolved = [...state.entities];
    let knowledge: Record<string, import("../../spring/types").ProductKnowledge> = {};
    let knowledgeCoverage: KnowledgeCoverageRow[] = [];
    const findingsSoFar: Finding[] = [...state.findings];

    // Order matters and is the plan's, not this function's: PRODUCT_OPS runs first when present so a
    // resolved product is available to the specialists that can use one, and REPORT_OPS runs last
    // because it composes what the others produced.
    const ordered = orderSpecialists(plan.specialistTargets);
    const scopeRejections: RejectedEvidence[] = [];
    const specialistFailures: ToolFailure[] = [];
    // Every ref the run has minted so far, not just this specialist's. REPORT_OPS cites the OTHERS'
    // evidence and registers none of its own, so a gate that could only see one specialist's refs would
    // find nothing behind every report sentence and silently delete the report.
    const seenEvidence: EvidenceRef[] = [...state.evidence];
    for (const specialist of ordered) {
      const outcome = await runSpecialist(specialist, plan, state, resolved, findingsSoFar, seenEvidence);
      seenEvidence.push(...outcome.result.evidence);
      // The gate runs against the entities known AT THIS POINT, which includes whatever this specialist
      // just resolved — PRODUCT_OPS must be allowed to cite the product it resolved on the same pass.
      const known = [...resolved, ...outcome.resolvedEntities];
      const gated = applyScopeGate(plan, known, outcome.result, outcome.needStates, seenEvidence);
      scopeRejections.push(...gated.rejected);
      specialistFailures.push(...(outcome.result.failures ?? []));
      results.push({ ...outcome.result, findings: gated.findings });
      needStates.push(...gated.needStates);
      resolved.push(...outcome.resolvedEntities);
      findingsSoFar.push(...gated.findings);
      knowledge = { ...knowledge, ...outcome.knowledge };
      knowledgeCoverage = [...knowledgeCoverage, ...outcome.knowledgeCoverage];
    }

    return {
      results: [...state.results, ...results],
      evidence: results.flatMap((r) => [...r.evidence]),
      findings: findingsSoFar,
      needs: needStates,
      entities: resolved,
      knowledge,
      scopeRejections: [...state.scopeRejections, ...scopeRejections],
      specialistFailures,
      trail: [`dispatched:${ordered.join("+")}`],
    };
  }

  /**
   * Evidence scope integrity, applied where a run's finding set is actually assembled.
   *
   * <b>Here rather than inside each specialist, and that is the point.</b> A rule enforced in four
   * places is four rules; the fifth specialist would arrive without it. This is the single seam every
   * specialist's output crosses, so a finding that fails the check never becomes part of the run at
   * all — it is not demoted, not shown as "확인 필요", and not left for the judge to catch. The judge
   * gets the same check as a floor underneath this one (`RuleEvidenceJudge`), which is belt and braces
   * on purpose: the two are independent, and neither is allowed to be the only one.
   *
   * A finding whose claim IS the coverage limit is exempt, for the same reason the judge exempts it —
   * "이 상품에 연결된 데이터가 없습니다" is supported BY the absence, and withholding it would delete
   * the honest answer and leave the false calm.
   */
  function applyScopeGate(
    plan: InvestigationPlan,
    known: readonly ResolvedEntity[],
    result: SpecialistResult,
    states: readonly NeedState[],
    seenEvidence: readonly EvidenceRef[],
  ): { findings: Finding[]; needStates: NeedState[]; rejected: RejectedEvidence[] } {
    const scopes = new Map<string, NeedScope>();
    const scopeFor = (needId: string | undefined): NeedScope => {
      if (!needId) return planScopeOf(plan, known);
      const cached = scopes.get(needId);
      if (cached) return cached;
      const need = plan.informationNeeds.find((n) => n.id === needId);
      const scope = need ? needScopeOf(plan, need, known) : planScopeOf(plan, known);
      scopes.set(needId, scope);
      return scope;
    };
    const refOf = new Map(seenEvidence.map((e) => [e.evidenceId, e]));
    const rejected: RejectedEvidence[] = [];

    const findings: Finding[] = [];
    for (const finding of result.findings) {
      if (finding.claimsCoverageLimit) {
        findings.push(finding);
        continue;
      }
      const cited = finding.evidenceIds.map((id) => refOf.get(id)).filter((e): e is EvidenceRef => !!e);
      const { accepted, rejected: bad } = partitionEvidence(scopeFor(finding.needId), cited);
      rejected.push(...bad);
      // Nothing left to stand on: the sentence is not said. A finding stripped to zero citations would
      // be dropped by `compose` anyway — dropping it here is what makes that a contract instead of a
      // coincidence of ordering.
      if (accepted.length === 0) continue;
      findings.push({ ...finding, evidenceIds: accepted.map((e) => e.evidenceId) });
    }

    const needStates: NeedState[] = [];
    for (const state of states) {
      if (state.status !== "SATISFIED") {
        needStates.push(state);
        continue;
      }
      const cited = state.evidenceIds.map((id) => refOf.get(id)).filter((e): e is EvidenceRef => !!e);
      const { accepted, rejected: bad } = partitionEvidence(scopeFor(state.id), cited);
      if (accepted.length > 0) {
        needStates.push({ ...state, evidenceIds: accepted.map((e) => e.evidenceId) });
        continue;
      }
      // Invariant 1: a need whose every citation failed the check is NOT satisfied, and says why in
      // the seller's language rather than falling silent.
      const reason = bad[0]?.reason;
      needStates.push({
        id: state.id,
        status: "UNSATISFIABLE",
        evidenceIds: [],
        ...(reason ? { reason: reasonSentence(reason, productMentionOf(plan)) } : {}),
      });
    }

    if (rejected.length > 0) {
      log("operator_scope_gate", {
        rejected: rejected.length,
        reasons: [...new Set(rejected.map((r) => r.reason))].sort().join(","),
        findingsKept: findings.length,
      });
    }
    return { findings, needStates, rejected };
  }

  async function runSpecialist(
    specialist: SpecialistName,
    plan: InvestigationPlan,
    state: OperatorState,
    resolved: readonly import("../plan/InvestigationPlan").ResolvedEntity[],
    findingsSoFar: readonly Finding[],
    priorEvidence: readonly EvidenceRef[],
  ): Promise<{
    result: SpecialistResult;
    needStates: NeedState[];
    resolvedEntities: import("../plan/InvestigationPlan").ResolvedEntity[];
    knowledge: Record<string, import("../../spring/types").ProductKnowledge>;
    knowledgeCoverage: KnowledgeCoverageRow[];
  }> {
    const shared = {
      registry: deps.registry,
      budget: deps.budget,
      evidence,
      allowedTools: dedupe([...plan.candidateTools, ...toolsFor(specialist)]),
      resolved,
      // Decided once for the whole run, from the plan and the seller's own sentence. A specialist that
      // worked this out for itself would be a second place deciding what "상품별" means.
      grouping: groupingOf(plan, state.goalText),
      periodNamed: periodNamedIn(plan, resolved),
      // The single channel this run is about, or null. Decided here for the same reason `grouping` is:
      // the gate will judge every citation against ONE channel scope, and a specialist that worked out
      // its own would be free to read the sentence differently than the gate that overrules it.
      channelScope: channelScopeOf(plan, resolved),
      // The planner's restatement of the goal, used only where the seller's own text is missing.
      plannerGoal: plan.userGoal,
      // What the run has already PROVEN, not what it might. A specialist reads this the same way it
      // reads `resolved`: to avoid re-buying a fact the run already holds. It is evidence refs only —
      // ids, counts and closed labels — so nothing a specialist could not already mint itself.
      priorEvidence,
      goalText: state.goalText,
      ...(deps.referenceDate ? { referenceDate: deps.referenceDate } : {}),
    };
    try {
      switch (specialist) {
        case "PRODUCT_OPS": {
          const result = await runProductOps({
            ...shared,
            needs: needsInOrder(plan, PRODUCT_NEEDS),
            mentions: instanceMentionsOf(plan, "PRODUCT"),
          });
          return {
            result,
            needStates: [...result.needStates],
            resolvedEntities: [...result.resolvedEntities],
            knowledge: result.knowledge,
            knowledgeCoverage: [...result.knowledgeCoverage],
          };
        }
        case "REVIEW_OPS": {
          const result = await runReviewOps({
            ...shared, needs: needsInOrder(plan, REVIEW_NEEDS), mentions: [],
          });
          return { result, needStates: [...result.needStates], resolvedEntities: [], knowledge: {}, knowledgeCoverage: [] };
        }
        case "INQUIRY_OPS": {
          const result = await runInquiryOps({
            ...shared, needs: needsInOrder(plan, INQUIRY_NEEDS), mentions: [],
          });
          return { result, needStates: [...result.needStates], resolvedEntities: [], knowledge: {}, knowledgeCoverage: [] };
        }
        case "REPORT_OPS": {
          // No tools, no reads. It sees what the others already found — that is its whole input.
          const result = runReportOps({
            findings: findingsSoFar,
            needs: plan.informationNeeds.filter((n) => !servedElsewhere(plan, n.id)),
          });
          return { result, needStates: [...result.needStates], resolvedEntities: [], knowledge: {}, knowledgeCoverage: [] };
        }
      }
    } catch (err) {
      // The BACKSTOP, not the mechanism. InquiryOps and ReviewOps isolate their own reads and never
      // reach here; a specialist that still throws lands as one structured failure rather than a name.
      //
      // <b>Only the error's SHAPE is read.</b> `classifyToolError` looks at `status` and `name`; the
      // message is never touched, because a backend error message is the field most likely to quote
      // what was sent.
      const classified = classifyToolError(err);
      const failure: ToolFailure = {
        specialist,
        // The throwing tool is unknown at this level — a specialist that wants its tool named isolates
        // its own calls, which is exactly what this catch existing as a backstop is meant to encourage.
        tool: "unspecified",
        ...classified,
      };
      log("operator_specialist_failed", {
        specialist,
        tool: failure.tool,
        category: failure.category,
        statusCategory: failure.statusCategory,
        recoverable: failure.recoverable,
      });
      return {
        result: {
          specialist,
          findings: [],
          evidence: [],
          coverage: [],
          failures: [failure],
          terminal: "FAILED" as const,
          note: `${specialist} 조회에 실패해 이 부분은 답에 포함되지 않았습니다.`,
        },
        needStates: [],
        resolvedEntities: [],
        knowledge: {},
        knowledgeCoverage: [],
      };
    }
  }

  async function judge(state: OperatorState): Promise<Partial<OperatorState>> {
    const judged: Finding[] = [];
    for (const finding of state.findings) {
      if (finding.verdict) {
        // Already judged on an earlier pass. Re-judging would spend budget to reach the same verdict.
        judged.push(finding);
        continue;
      }
      if (deps.judge.usesModel && !deps.budget.spend("llm")) {
        // Out of model budget: the finding keeps a null verdict, which `confidenceOf` maps to
        // NEEDS_REVIEW — shown as something to check, never asserted and never silently dropped.
        judged.push(finding);
        continue;
      }
      // The judge gets the same scope contract the dispatch gate applied. Passing it is what makes
      // the floor real: without it the rule judge would approve a sentence on evidence about another
      // product, which is precisely the verdict Q4 got.
      const scope = state.plan
        ? (finding.needId
            ? scopeForNeed(state.plan, finding.needId, state.entities)
            : planScopeOf(state.plan, state.entities))
        : undefined;
      const verdict = await deps.judge.judge(finding, state.evidence, scope);
      judged.push({ ...finding, verdict, confidence: confidenceOf(verdict) });
    }
    log("operator_judge_node", {
      judged: judged.length,
      supported: judged.filter((f) => f.confidence === "SUPPORTED").length,
    });
    return { findings: judged, trail: ["judged"] };
  }

  /**
   * Whether to look again.
   *
   * Three conditions, all required: something is still worth pursuing (a judge asked for more, or a
   * REQUIRED need is still pending), the budget allows another cycle, and the loop has not already run
   * its passes. The last one is what stops a judge that always says "needsMore" from turning a bounded
   * loop into a slow one.
   */
  function afterJudge(state: OperatorState): "interpretGoal" | "compose" {
    const judgeWantsMore = state.findings.some((f) => f.verdict?.needsMore === true);
    const requiredPending = state.plan
      ? state.plan.informationNeeds.some(
          (n) => n.required && state.needs.find((s) => s.id === n.id)?.status === "PENDING",
        )
      : false;
    // A pass that learned NOTHING must not buy another plan.
    //
    // Found live 2026-08-21: asked "이 제품 폭이 몇 mm인가요?" with no resolvable product name, the run
    // re-planned on every cycle because a required need stayed PENDING — and each re-plan is a model
    // call. It spent the whole LLM budget restating the same question to a planner that had no new
    // information to plan with, then reported budget exhaustion instead of the real answer ("어떤
    // 상품인지 찾지 못했습니다"). A loop is only worth another pass if the last one moved something.
    const learnedSomething = state.evidence.length > 0
      && state.needs.some((n) => n.status !== "PENDING");
    const passes = state.results.length;
    if ((judgeWantsMore || requiredPending) && learnedSomething
        && deps.budget.canIterate() && passes < 8) {
      return "interpretGoal";
    }
    return "compose";
  }

  function compose(state: OperatorState): Partial<OperatorState> {
    const plan = state.plan;
    // E1: a finding with no evidence never reaches the seller. UNSUPPORTED means the judge found
    // nothing behind it — presenting it anyway is the whole failure this graph is built to avoid.
    const presentable = dedupeStatements(state.findings.filter(
      (f) => f.evidenceIds.length > 0 && f.confidence !== "UNSUPPORTED",
    ));
    const ordered = [...presentable].sort(
      (a, b) => rank(a.confidence) - rank(b.confidence) || a.findingId.localeCompare(b.findingId),
    );

    const coverage: SignalCoverage[] = state.results.flatMap((r) => [...r.coverage]);
    const notes = state.results.map((r) => r.note).filter((n): n is string => Boolean(n));
    // <b>Only what was withheld for lack of evidence is reported as withheld.</b> `presentable` also
    // collapses duplicate statements, and counting those as dropped told the seller that five true
    // sentences had failed a check they never took (live 2026-08-24). A repeated sentence is one fact
    // said once — no information is lost and nothing needs saying about it.
    const dropped = state.findings.filter(
      (f) => f.evidenceIds.length === 0 || f.confidence === "UNSUPPORTED",
    ).length;
    if (dropped > 0) {
      notes.push(`근거가 확인되지 않아 ${dropped}건은 답에서 제외했습니다.`);
    }
    // What scope the answer actually rests on, when it is not the obvious one. A seller who asked about
    // "반복 문의" and was answered on a 28-day window has been given a number whose meaning depends on
    // that window, and a seller who said "최근" and got an unfiltered list needs to know that too.
    // Only needs the run actually pursued contribute — a PENDING need was never scoped by anything.
    const pursued = new Set(state.needs.filter((n) => n.status !== "PENDING").map((n) => n.id));
    const bases = (plan?.appliedDefaults ?? [])
      .filter((d) => pursued.has(d.needId))
      .map(basisSentence)
      .filter((line): line is string => line != null);
    notes.push(...new Set(bases));

    // Withheld for SCOPE, said separately from withheld for absence — they are different facts and a
    // seller acts on them differently. "근거가 없다" means look elsewhere; "범위가 다르다" means this
    // question cannot be answered with what SellerOps can currently read, which is the sentence Q4
    // should have produced instead of three issues belonging to other products.
    if (state.scopeRejections.length > 0) {
      const reasons = [...new Set(state.scopeRejections.map((r) => r.reason))];
      const subject = plan ? productMentionOf(plan) : undefined;
      notes.push(...reasons.map((r) => reasonSentence(r, subject)));
    }

    const stopReason: OperatorStopReason = !plan || !plan.supported
      ? "NO_PLAN"
      : plan.clarificationNeeded
        ? "CLARIFICATION_NEEDED"
        : "COMPLETE";
    const budget = deps.budget.report(stopReason);

    if (budget.stopReason === "NO_PLAN") {
      // An unsupported goal must SAY it is unsupported. A silent empty answer reads as "나는 확인했고
      // 아무것도 없었다", which is a different and false statement.
      notes.push(plan?.rationale
        ?? "이 요청은 아직 지원하지 않습니다. 문의·리뷰·상품·리포트 중 무엇을 보고 싶은지 알려주세요.");
    } else if (budget.exhausted) {
      notes.push("조회 예산에 도달해 일부는 확인하지 못했습니다.");
    }

    // The silence guard. A required need that ended PENDING is SAID, because a run that quietly answers
    // two of three questions is indistinguishable from one that was only asked two.
    const answered = answeredNeeds(state);
    const unanswered = answered.filter((n) => n.required && n.status === "PENDING");
    if (unanswered.length > 0) {
      notes.push(`확인하지 못한 항목: ${unanswered.map((n) => n.question).join(" / ")}.`);
    }

    // How each specialist ended. Derived here rather than trusted from the result, so a specialist that
    // reports nothing still gets a truthful terminal instead of an implied success.
    const outcomes: SpecialistOutcomeView[] = state.results.map((r) => {
      const failures = [...(r.failures ?? [])];
      const terminal: SpecialistTerminal = r.terminal
        ?? terminalOf({ succeeded: r.evidence.length, failures });
      return { specialist: r.specialist, terminal, failures };
    });
    // Every distinct failure reason, said once. The seller learns that a part of the picture is missing
    // and WHY — the anchor sentence in particular is a fact about their data, not an apology.
    for (const sentence of new Set(state.specialistFailures.map(failureSentence))) {
      notes.push(sentence);
    }
    // <b>The lane's own ceiling, said plainly.</b> The Operator catalogue is READ-only by construction
    // (`OperatorToolRegistry` refuses to register anything else), so a goal that asks for a reply to be
    // WRITTEN cannot be completed here however the plan is shaped — the draft lane is the inquiry
    // subgraph, reached by its own intent. This is a capability NOTICE and never a route: it selects no
    // tool, no specialist and no status, and the same shape of keyword check already decides what the
    // rule judge refuses to say. Without it a seller who asked for drafts reads an answer that silently
    // dropped half the request.
    if (DRAFT_WORDS.some((w) => state.goalText.includes(w))) {
      notes.push("답변 초안 작성은 이 대화 창구에서 하지 않습니다 — 조회만 가능합니다."
        + " 초안은 문의 화면의 답변 준비에서 만들 수 있습니다.");
    }

    const answer: OperatorAnswer = {
      goalEcho: state.goalText,
      plannerKind: "LLM",
      plannerVersion: plan?.plannerVersion ?? "unknown",
      needs: answered,
      specialists: plan?.specialistTargets ?? [],
      findings: ordered,
      evidence: state.evidence,
      coverage,
      knowledgeCoverage: dedupeCoverage(
        Object.values(state.knowledge).flatMap((k) => k.knowledgeCoverage),
      ),
      nextActions: nextActionsFor(ordered),
      specialistOutcomes: outcomes,
      clarification: plan?.clarificationNeeded ? (plan.clarificationReason ?? plan.userGoal) : null,
      budget,
      // Deduped: two passes over the same unresolvable product produce the same sentence twice,
      // and a note that repeats itself reads as two separate problems.
      ...(notes.length > 0 ? { note: [...new Set(notes)].join(" ") } : {}),
    };
    log("operator_compose", {
      findings: ordered.length,
      evidence: state.evidence.length,
      stopReason: budget.stopReason,
      unansweredNeeds: unanswered.length,
      specialistsFailed: outcomes.filter((o) => o.terminal === "FAILED").length,
      specialistsPartial: outcomes.filter((o) => o.terminal === "PARTIAL").length,
    });
    return { answer, trail: ["composed"] };
  }

  // The node is `interpretGoal`, not `plan`: LangGraph refuses a node whose name collides with a state
  // channel, and `plan` is a channel here. Naming it after what it DOES rather than what it writes is
  // the better name anyway.
  return new StateGraph(OperatorStateAnnotation)
    .addNode("interpretGoal", interpretGoal)
    .addNode("dispatch", dispatch)
    .addNode("judge", judge)
    .addNode("compose", compose)
    .addEdge(START, "interpretGoal")
    .addEdge("interpretGoal", "dispatch")
    .addEdge("dispatch", "judge")
    .addConditionalEdges("judge", afterJudge, { interpretGoal: "interpretGoal", compose: "compose" })
    .addEdge("compose", END);

  /** Which needs REPORT_OPS reports on: the ones no other dispatched specialist serves. */
  function servedElsewhere(plan: InvestigationPlan, needId: string): boolean {
    const need = plan.informationNeeds.find((n) => n.id === needId);
    if (!need) return true;
    const owned: readonly string[] = [...PRODUCT_NEEDS, ...REVIEW_NEEDS, ...INQUIRY_NEEDS];
    return owned.includes(need.kind)
      && plan.specialistTargets.some((s) => s !== "REPORT_OPS");
  }
}

/** PRODUCT_OPS first (it resolves entities others use), REPORT_OPS last (it composes their findings). */
/**
 * The product the seller named, as they wrote it — for the withholding sentence.
 *
 * The seller's own words, never a resolved label: when the gate fires because nothing resolved, there
 * IS no label, and the only honest way to name the thing is the way they named it.
 */
function productMentionOf(plan: InvestigationPlan): string | undefined {
  // An INSTANCE only: a category mention never put the run into product scope, so it can never be the
  // reason a row was withheld, and quoting it back ("「상품」에 해당하는 상품을 찾지 못해…") would name
  // a thing the seller never asked about.
  return plan.entities.unresolved.find((e) => e.kind === "PRODUCT" && isInstance(e))?.mention
    ?? plan.entities.resolved.find((e) => e.kind === "PRODUCT")?.mention;
}

/** One need's scope, or the run's scope when the plan no longer carries that need. */
function scopeForNeed(
  plan: InvestigationPlan,
  needId: string,
  resolved: readonly ResolvedEntity[],
): NeedScope {
  const need = plan.informationNeeds.find((n) => n.id === needId);
  return need ? needScopeOf(plan, need, resolved) : planScopeOf(plan, resolved);
}

function orderSpecialists(targets: readonly SpecialistName[]): SpecialistName[] {
  const rankOf = (s: SpecialistName): number =>
    s === "PRODUCT_OPS" ? 0 : s === "REPORT_OPS" ? 2 : 1;
  return [...new Set(targets)].sort((a, b) => rankOf(a) - rankOf(b));
}

/**
 * The re-plan context: need ids and statuses, nothing else.
 *
 * <b>Closed vocabulary by construction.</b> No evidence value, no count, no product name, no customer
 * word — the payload floor for a re-plan has to be as tight as the one for a first plan, and the way to
 * guarantee that is to build the string from ids and enum names only.
 */
function progressLine(state: OperatorState): string {
  return state.needs.map((n) => `${n.id}=${n.status}`).join(" ");
}

function answeredNeeds(state: OperatorState): AnsweredNeed[] {
  const declared = state.plan?.informationNeeds ?? [];
  return declared.map((need) => {
    const found = state.needs.find((n) => n.id === need.id);
    return {
      id: need.id,
      question: need.question,
      status: found?.status ?? "PENDING",
      required: need.required,
      evidenceIds: found?.evidenceIds ?? [],
      ...(found?.reason ? { reason: found.reason } : {}),
    };
  });
}

/** Order-preserving dedupe. */
function dedupe(values: readonly string[]): string[] {
  return [...new Set(values.filter((v) => v.trim().length > 0))];
}

/**
 * One sentence, once.
 *
 * <b>A second pass re-reading the same source produces the same statement, and printing it twice reads
 * as two facts.</b> Measured live 2026-08-21 in v2 (a spec answer stating the same coverage gap twice)
 * and in v1 before it (3,208 unanswered inquiries reported by two specialists). Dedupe is on the
 * STATEMENT rather than the finding id, because the ids differ — they are minted per evidence ref —
 * while the claim is identical. The surviving copy keeps its own evidence, so nothing loses its trace.
 */
function dedupeStatements(findings: readonly Finding[]): Finding[] {
  const seen = new Set<string>();
  const out: Finding[] = [];
  for (const finding of findings) {
    const key = `${finding.specialist}::${finding.statement}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(finding);
  }
  return out;
}

/** One row per facet — several products in one run would otherwise print the same facet repeatedly. */
function dedupeCoverage(rows: readonly KnowledgeCoverageRow[]): KnowledgeCoverageRow[] {
  const byFacet = new Map<string, KnowledgeCoverageRow>();
  for (const row of rows) {
    const existing = byFacet.get(row.facet);
    // Keep the WEAKEST verdict per facet: a run that read two products and knows one of them must not
    // report AVAILABLE for both.
    if (!existing || weakness(row.coverage) > weakness(existing.coverage)) {
      byFacet.set(row.facet, row);
    }
  }
  return [...byFacet.values()];
}

function weakness(coverage: KnowledgeCoverageRow["coverage"]): number {
  return coverage === "UNAVAILABLE" ? 3 : coverage === "STALE" ? 2 : coverage === "PARTIAL" ? 1 : 0;
}

function rank(confidence: Finding["confidence"]): number {
  return confidence === "SUPPORTED" ? 0 : confidence === "NEEDS_REVIEW" ? 1 : 2;
}

/**
 * The next steps offered with an answer.
 *
 * Derived from the findings' own surface links and deduped, so every action lands on a screen the
 * seller is already authorized for. Every one is READ: there is nothing to offer that is not, because
 * the Operator has no WRITE tool to offer it with.
 */
function nextActionsFor(findings: readonly Finding[]): NextAction[] {
  const seen = new Set<string>();
  const actions: NextAction[] = [];
  for (const finding of findings) {
    if (!finding.surfaceLink || seen.has(finding.surfaceLink)) {
      continue;
    }
    seen.add(finding.surfaceLink);
    actions.push({ label: labelFor(finding.surfaceLink), actionClass: "READ", surfaceLink: finding.surfaceLink });
  }
  return actions.slice(0, 4);
}

function labelFor(link: string): string {
  if (link.startsWith("/inquiries")) return "문의 확인하기";
  if (link.startsWith("/memory")) return "반복 문제 살펴보기";
  if (link.startsWith("/reviews")) return "리뷰 확인하기";
  if (link.startsWith("/reports")) return "리포트 열기";
  if (link.startsWith("/connect")) return "채널 연결 확인하기";
  return "열어보기";
}
