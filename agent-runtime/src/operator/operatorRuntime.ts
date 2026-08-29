/**
 * The runnable façade over the OperatorGraph — a sibling of {@link IssueAgentRuntime} and
 * {@link InquiryDraftAgentRuntime}: this graph has no human-checkpoint interrupt, so a run goes
 * straight from a request to a DONE answer, or to a FAILED one. There is no `resume`.
 *
 * <b>Why there is nothing to resume.</b> Every tool the Operator can reach is READ. A run that pauses
 * exists to let a human authorize something; there is nothing here to authorize. The two paths that DO
 * pause — the inquiry approve loop and the review reply loop — are reached through their own intents
 * and keep their own runtimes, checkpoints and durable stores, exactly as before.
 *
 * <b>A run without a plan FAILS, and this class is where that becomes visible.</b>
 * {@link PlannerUnavailableError} is caught here and turned into a FAILED result carrying a reason —
 * never into a smaller answer, a keyword route, or an empty success. That is invariant I2 at the one
 * place a caller could have been tempted to soften it.
 *
 * <b>Nothing durable is written.</b> The answer is returned and dropped, like the draft-preparation
 * runtime's draft.
 */
import { buildOperatorGraph } from "./graph/operatorGraph";
import type { ProgressSink } from "./graph/operatorGraph";
import type { InvestigationPlan } from "./plan/InvestigationPlan";
import type { Artifact } from "../conversation/contract";
import { OperatorToolRegistry } from "./tools/OperatorToolRegistry";
import { buildOperatorTools, OPERATOR_TOOL } from "./tools/OperatorTools";
import { LlmInvestigationPlanner, PlannerUnavailableError } from "./plan/LlmInvestigationPlanner";
import type { Planner } from "./plan/LlmInvestigationPlanner";
import { RuleEvidenceJudge, SpringEvidenceJudge } from "./judge/EvidenceJudge";
import type { EvidenceJudge } from "./judge/EvidenceJudge";
import { OperatorBudget, OPERATOR_BUDGET_V1 } from "./budget/OperatorBudget";
import type { ResolvedEntity } from "./plan/InvestigationPlan";
import { EvidenceBuilder } from "./state/evidence";
import type { EvidenceRef } from "./state/OperatorState";
import { eventOn } from "./scope/EvidenceTime";
import type { OperatorBudgetLimits } from "./budget/OperatorBudget";
import type { OperatorAnswer, OperatorFailureCode, OperatorState } from "./state/OperatorState";
import { failureSentence } from "./failure/SpecialistOutcome";
import { threadConfig } from "../checkpoint/CheckpointContract";
import type { GoalRequest } from "../goal/parseGoal";
import type { OperatorSpringClient } from "../spring/OperatorSpringClient";
import type { SpringClient } from "../spring/SpringClient";
import type { IssueSpringClient } from "../spring/IssueSpringClient";
import { log } from "../log";

export interface OperatorRuntimeDeps {
  readonly operator: OperatorSpringClient;
  readonly inquiry: SpringClient;
  readonly issue: IssueSpringClient;
  /**
   * Defaults to the LLM planner over the operator client.
   *
   * Injectable so a test can point it at a different BACKEND, not at a different STRATEGY: the only
   * `Planner` implementation in `src/` is the LLM one, and `plannerFence.test.ts` asserts it.
   */
  readonly planner?: Planner;
  /** Defaults to the Spring judge with the rule judge beneath it. */
  readonly judge?: EvidenceJudge;
  /** Query Accuracy v1: the tenant key under which the judge's learned "capability off" state is shared across runs. */
  readonly judgeMemoKey?: string;
  readonly limits?: OperatorBudgetLimits;
  /** Injectable clock, so a budget deadline is deterministic in tests. */
  readonly now?: () => number;
  /** Stage sink for the conversation lane. Absent ⇒ stages are logged only, exactly as before. */
  readonly progress?: ProgressSink;
  /** The conversation lane's bounded refresh seam. Absent on every non-conversational run. */
  readonly refresher?: import("./graph/reviewRefresh").ReviewRefresher;
}

export type OperatorRunResult =
  | {
      readonly status: "DONE";
      readonly answer: OperatorAnswer;
      readonly trail: string[];
      /** The plan the run executed — its v3 axis (requestedAction / target / filters) is what a conversation acts on. */
      readonly plan: InvestigationPlan | null;
      /** Structured objects the specialists composed. Live-only; the conversation lane bounds and persists them. */
      readonly artifacts: readonly Artifact[];
      /** Entities tools resolved this run — what a conversation anchors the next turn on. */
      readonly entities: readonly ResolvedEntity[];
    }
  | {
      readonly status: "FAILED";
      readonly failureCode: OperatorFailureCode;
      /** Seller-facing, in Korean. Never a vendor message and never the request. */
      readonly reason: string;
      readonly trail: string[];
    };

export class OperatorAgentRuntime {
  private readonly deps: OperatorRuntimeDeps;

  constructor(deps: OperatorRuntimeDeps) {
    this.deps = deps;
  }

  /**
   * Answer one goal, or fail.
   *
   * The graph is built per run rather than once: the budget and the evidence id counter are run-scoped,
   * and sharing either across runs would let one seller's run spend another's budget or reuse its ids.
   * Building is cheap — a StateGraph over four nodes.
   */
  async run(threadId: string, request: GoalRequest, options: { signal?: AbortSignal } = {}): Promise<OperatorRunResult> {
    const tools = buildOperatorTools({
      operator: this.deps.operator,
      inquiry: this.deps.inquiry,
      issue: this.deps.issue,
    });
    // Throws on a WRITE tool — at construction, before any run, so it is a boot failure and not a
    // mid-run surprise.
    const registry = new OperatorToolRegistry(tools);
    const budget = new OperatorBudget(this.deps.limits ?? OPERATOR_BUDGET_V1, this.deps.now);
    // Stop = the budget is cancelled: the step in flight finishes, no next step is charged.
    if (options.signal?.aborted) budget.cancel();
    options.signal?.addEventListener("abort", () => budget.cancel(), { once: true });
    const evidence = new EvidenceBuilder(request.referenceDate);

    const graph = buildOperatorGraph({
      registry,
      tools,
      evidence,
      planner: this.deps.planner ?? new LlmInvestigationPlanner(this.deps.operator),
      judge: this.deps.judge
        ?? new SpringEvidenceJudge(this.deps.operator, new RuleEvidenceJudge(), threadId, this.deps.judgeMemoKey),
      budget,
      // The thread IS the run on this surface, and it is what the quota counts as one.
      runId: threadId,
      ...(request.referenceDate ? { referenceDate: request.referenceDate } : {}),
      ...(this.deps.progress ? { progress: this.deps.progress } : {}),
      ...(this.deps.refresher ? { refresher: this.deps.refresher } : {}),
    }).compile();

    const goalText = request.text ?? request.intent ?? "";
    const context = await this.contextEntities(request, budget, evidence);
    let final: OperatorState;
    try {
      final = (await graph.invoke(
        {
          goalText,
          ...(context.entities.length > 0 ? { entities: context.entities } : {}),
          ...(context.evidence.length > 0 ? { evidence: context.evidence } : {}),
          ...(request.conversation ? { conversation: request.conversation } : {}),
        },
        threadConfig(threadId),
      )) as OperatorState;
    } catch (err) {
      if (err instanceof PlannerUnavailableError) {
        const failureCode = failureCodeFor(err);
        log("operator_run_failed", { failureCode, failure: err.failure });
        return { status: "FAILED", failureCode, reason: reasonFor(err), trail: ["plan_unavailable"] };
      }
      throw err;
    }
    if (!final.answer) {
      // The graph completed without composing — only reachable when the budget ran out before the
      // first plan. Reported as a failure rather than as an empty success, for the same reason a
      // missing planner is: an empty answer reads as "확인했고 아무것도 없었다".
      log("operator_run_failed", { failureCode: "PLAN_INVALID", failure: "NO_ANSWER" });
      return {
        status: "FAILED",
        failureCode: "PLAN_INVALID",
        reason: "조회 예산 안에서 조사 계획을 세우지 못했습니다.",
        trail: final.trail ?? [],
      };
    }
    // <b>A run that produced nothing because its reads FAILED does not end DONE.</b> Live 2026-08-23 a
    // seller asked for their inquiries to be prioritised, INQUIRY_OPS died on one anchorless call, and
    // the run returned `DONE` with zero findings — indistinguishable, on screen, from "확인했고 아무것도
    // 없었다". An empty run whose specialists all worked is still DONE, because that is the true
    // statement about a quiet inbox; only a failed read turns silence into a failure.
    //
    // <b>A deliberate skip is not a failure of the system.</b> `ANCHOR_UNAVAILABLE` means the run knew
    // a read could not be made and said so — a fact about the seller's question, not a broken read. A
    // run that only skipped still ends DONE, with its reason on the card. Everything else — a 4xx, a
    // 5xx, a dropped connection, a refused tool — is a read that SHOULD have answered and did not.
    const hardFailures = final.answer.specialistOutcomes
      .flatMap((o) => o.failures)
      .filter((f) => f.category !== "ANCHOR_UNAVAILABLE");
    if (final.answer.findings.length === 0 && hardFailures.length > 0) {
      log("operator_run_failed", {
        failureCode: "EVIDENCE_UNAVAILABLE",
        failedSpecialists: [...new Set(hardFailures.map((f) => f.specialist))].join(","),
        categories: [...new Set(hardFailures.map((f) => f.category))].sort().join(","),
      });
      return {
        status: "FAILED",
        failureCode: "EVIDENCE_UNAVAILABLE",
        reason: failureSentence(hardFailures[0]!),
        trail: final.trail ?? [],
      };
    }
    log("operator_run_done", {
      findings: final.answer.findings.length,
      evidence: final.answer.evidence.length,
      stopReason: final.answer.budget.stopReason,
      specialistsFailed: final.answer.specialistOutcomes.filter((o) => o.terminal === "FAILED").length,
    });
    return {
      status: "DONE", answer: final.answer, trail: final.trail ?? [],
      plan: final.plan ?? null, artifacts: final.artifacts ?? [], entities: final.entities ?? [],
    };
  }

  /**
   * Turn the screen's scope hint into a VERIFIED entity, or into nothing.
   *
   * <b>Why a read and not an assignment.</b> A product id arriving from a URL proves nothing: not that
   * the row exists, not that it belongs to this org, and not what it is called. One org-scoped backend
   * read answers all three at once — it returns this org's rows or it returns none — so the entity
   * that reaches the graph was resolved exactly the way a named one is, and every scope invariant
   * downstream ({@code EvidenceScope}) can keep asking the same question it always asked.
   *
   * <b>It costs one tool call and it is charged.</b> A hint that skipped the budget would let a
   * contextual run do strictly more work than the seller's own sentence bought.
   *
   * <b>A failure is silence, not an error.</b> A stale bookmark, a deleted product, another org's id:
   * the run proceeds exactly as it does today, and the planner resolves the product by name if the
   * sentence named one. The hint can only save a step, never change an answer.
   */
  private async contextEntities(
    request: GoalRequest,
    budget: OperatorBudget,
    evidence: EvidenceBuilder,
  ): Promise<{ entities: ResolvedEntity[]; evidence: EvidenceRef[] }> {
    const entities: ResolvedEntity[] = [];
    const refs: EvidenceRef[] = [];
    const productId = request.productId;
    if (productId && budget.spend("tool")) {
      try {
        const signals = await this.deps.operator.getProductSignals(productId);
        log("operator_context_product_resolved", { resolved: true });
        entities.push({
          kind: "PRODUCT",
          // The seller did not type a name — they were standing on the product. The canonical name is
          // the mention, so a finding that quotes what was asked about quotes the catalogue, not a URL.
          mention: signals.productName,
          id: signals.productId,
          label: signals.productName,
          resolvedBy: OPERATOR_TOOL.GET_PRODUCT_SIGNALS,
        });
      } catch {
        log("operator_context_product_resolved", { resolved: false });
      }
    }
    const workItemId = request.workItemId;
    if (workItemId && budget.spend("tool")) {
      // <b>The same read the inquiry screen makes, through the same org-scoped bearer.</b> Another
      // org's work item, a deleted one, a mistyped one: the backend answers 404 for all three and the
      // hint is dropped — there is no cross-org lookup because there is no endpoint that could do one.
      try {
        const detail = await this.deps.inquiry.getInquiryDetail(workItemId);
        const channel = detail.channelNameKo ?? detail.channelCode ?? null;
        entities.push({
          kind: "INQUIRY",
          // A demonstrative, by construction an INSTANCE (`plan/EntityRole.ts`): the seller pointed
          // at one thing. The label names the channel, never the customer's title.
          mention: "이 문의",
          id: detail.workItemId,
          label: channel ? `${channel} 문의` : "문의",
          resolvedBy: OPERATOR_TOOL.GET_INQUIRY_DETAIL,
        });
        const bound = detail.productId && detail.productName
          ? { productId: detail.productId, productName: detail.productName }
          : null;
        if (bound && !entities.some((e) => e.kind === "PRODUCT")) {
          // The inquiry's own binding is a fact the backend already decided (`SOURCE_EXACT` or
          // `USER_CONFIRMED`); carrying it forward is what lets ProductOps skip a resolve-by-name for a
          // product this inquiry is about. Charged nothing extra: it came out of the read above.
          entities.push({
            kind: "PRODUCT",
            mention: bound.productName,
            id: bound.productId,
            label: bound.productName,
            resolvedBy: OPERATOR_TOOL.GET_INQUIRY_DETAIL,
          });
        }
        // <b>Everything a specialist may SAY about this inquiry is minted here, from scalars.</b> The
        // detail carries the customer's text; the ref carries ids, the channel code, the closed work
        // state and the receipt date — and the text is dropped with this stack frame. InquiryOps cites
        // this ref instead of reading the detail again (`get_inquiry_thread_context` is a draft-only
        // tool by its own description, and a second read would buy the same row twice).
        refs.push(evidence.add({
          kind: "INQUIRY",
          sourceTool: OPERATOR_TOOL.GET_INQUIRY_DETAIL,
          args: { workItemId },
          locator: {
            workItemId: detail.workItemId,
            inquiryId: detail.inquiryId,
            ...(detail.channelCode ? { channelCode: detail.channelCode } : {}),
            ...(bound ? bound : {}),
            phase: detail.phase,
            status: detail.status,
            ...(detail.draft ? { draftVersion: detail.draft.version } : {}),
            label: channel ? `${channel} 문의` : "이 문의",
          },
          events: eventOn(detail.receivedAt.slice(0, 10)),
          coverage: "COVERED",
          provenance: "inquiry-detail/context",
        }));
        log("operator_context_inquiry_resolved", { resolved: true, bound: bound != null });
      } catch {
        log("operator_context_inquiry_resolved", { resolved: false });
      }
    }
    return { entities, evidence: refs };
  }
}

function failureCodeFor(err: PlannerUnavailableError): OperatorFailureCode {
  switch (err.failure) {
    case "CAPABILITY_OFF":
    case "NO_ENDPOINT":
      return "PLANNER_CAPABILITY_OFF";
    case "QUOTA_EXHAUSTED":
      return "AGENT_QUOTA_EXHAUSTED";
    case "PLAN_REJECTED":
    case "OFF_SCHEMA":
      return "PLAN_INVALID";
    default:
      return "PLANNER_UNAVAILABLE";
  }
}

/**
 * What the seller is told.
 *
 * <b>Each failure gets its own sentence because each has its own remedy.</b> "The capability is off"
 * is an operator/admin action; a transport failure is "try again"; a rejected plan is neither and
 * should say so plainly rather than pretending the request was unsupported. Collapsing them into one
 * message is what makes an outage look like a product limitation.
 */
function reasonFor(err: PlannerUnavailableError): string {
  // The backend's own sentence wins when it sent one: it knows WHICH ceiling was met and what the
  // seller can still do, and paraphrasing it here would put two versions of that promise in the repo.
  if (err.sellerMessage) {
    return err.sellerMessage;
  }
  switch (err.failure) {
    case "CAPABILITY_OFF":
    case "NO_ENDPOINT":
      return "AI 계획 기능이 꺼져 있어 지금은 대화형 요청을 처리할 수 없습니다. "
        + "홈·문의·리뷰·리포트 화면은 평소대로 사용할 수 있습니다.";
    case "TRANSPORT":
      return "AI 계획 기능에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.";
    case "EMPTY_GOAL":
      return "무엇을 확인할지 문장으로 알려주세요.";
    default:
      return "요청을 어떻게 조사할지 계획하지 못했습니다. 조금 더 구체적으로 다시 말씀해 주세요.";
  }
}
