/**
 * The conversation — the seller's working relationship with the AI operator across turns.
 *
 * <b>One turn = one Operator run, planned by the LLM planner or FAILED.</b> This service adds no
 * interpretation of its own: it loads the conversation, hands the planner what the previous turn put
 * in front of the seller (closed tokens only — `직전 작업 집합: REVIEWS (기간:TODAY, …)`), runs the
 * graph, and turns the answer into a {@code TurnView}. Whether a sentence is a filter over the last
 * set, a cross-domain follow-up, a draft request or a fresh question is the PLAN's decision
 * (`requestedAction`, `filters.scope`, `target`); the service reads those tokens and acts on them.
 *
 * <b>What it may do beyond reading, and where each stops.</b>
 *  · PREPARE a reply draft through the product's own draft path (`DraftPreparer`) — on the seller's
 *    sentence, for a target the previous turn showed; an append-only version, nothing sent. Inquiry
 *    drafts through the generate endpoint; review drafts through the review reply seam.
 *  · REFRESH a channel whose rows are stale and whose acquisition is the product's own API
 *    (`Refresher`) — one bounded collection the seller authorised by connecting, reported honestly.
 *  · ROUTE a send request to the path the channel and the object actually have: name the exact draft
 *    an approval would bind to (`APPROVAL`), name the guided seller-center step (`GUIDED_EXECUTION`),
 *    or say why neither exists (`SUMMARY`) — and stop. The confirm press, the Action Executor, the
 *    guided submission run and verification are the screens'; nothing here reaches them
 *    (`conversationWriteFence.test.ts`).
 *  · Ask for the seller's step(s) (`HUMAN_ACTION_REQUIRED`, one per channel) and wait; a later turn
 *    checks each step's own record (`GET /api/sync-runs`) before re-running the original request.
 *
 * <b>The message is deterministic prose over artifacts and SUPPORTED findings.</b> No sentence in a
 * turn is model-written; a model plans and judges, SellerOps composes.
 */
import { randomUUID } from "node:crypto";
import { OperatorAgentRuntime } from "../operator/operatorRuntime";
import type { ConversationRunContext } from "../operator/state/OperatorState";
import type { OperatorRunResult } from "../operator/operatorRuntime";
import type { InvestigationPlan } from "../operator/plan/InvestigationPlan";
import { conversationAxisOf } from "../operator/plan/InvestigationPlan";
import { effectiveAxisOf } from "../operator/plan/scopeOverride";
import { OPERATOR_TOOL } from "../operator/tools/OperatorTools";
import type { OperatorAnswer } from "../operator/state/OperatorState";
import type { GoalRequest } from "../goal/parseGoal";
import type { SpringClientBundle, SpringClientFactory } from "../http/AgentRunService";
import { HttpError } from "../http/errors";
import type { RunStoreProvider } from "../http/runStoreProvider";
import { scopeFor } from "../http/runStoreProvider";
import { capabilityOf, EXECUTION_REASON } from "../operator/capability/ChannelCapability";
import type { ChannelCapabilityVerdict } from "../operator/capability/ChannelCapability";
import { rowsSentence } from "../operator/graph/reviewRows";
import { log } from "../log";
import { inquiryRowsSentence } from "../operator/graph/inquiryRowsStep";
import type { ConversationStore } from "./ConversationStore";
import { DraftPreparer } from "./DraftPreparer";
import type { DraftTarget, ReviewDraftTarget } from "./DraftPreparer";
import { Refresher } from "./Refresher";
import { claimsFor } from "./reviewClaim";
import { boundedTurns, STAGE_LABEL, WORKING_SET_MAX_IDS } from "./contract";
import type {
  ApprovalArtifact, Artifact, ConversationSummary, ConversationView, DraftArtifact, EvidenceArtifact,
  ExecutableIdentity, GuidedExecutionArtifact, HumanActionRequiredArtifact, InquiryItem, PendingHumanAction,
  PendingPreparedAction, ProgressEvent, ProgressStage, ReviewItem, StartTurnRequest, SuggestedAction,
  SummaryArtifact, TurnStatus, TurnView, WorkingSetKind, WorkingSetView, WorkspaceLinkArtifact, ObjectKind,
} from "./contract";
import { periodLabel } from "./period";

export interface ConversationServiceDeps {
  readonly storeProvider: RunStoreProvider;
  readonly clientFactory: SpringClientFactory;
  /** Injectable clock so a turn's timestamps are deterministic in tests. */
  readonly now?: () => Date;
}

type ProgressFn = (e: ProgressEvent) => void;

/** How much of the answer's evidence the EVIDENCE artifact shows. */
const EVIDENCE_ITEMS_MAX = 20;
/** How many SUPPORTED finding sentences follow the headline. */
const FINDINGS_MAX = 4;
/** 「이 두 문의」 — at most this many drafts from one sentence. */
const ALL_TARGETS_MAX = 2;

const WORKSPACE_OF: Record<WorkingSetKind, { label: string; to: string }> = {
  REVIEWS: { label: "리뷰", to: "/reviews" },
  INQUIRIES: { label: "문의", to: "/inquiries?state=NEEDS_REPLY" },
  PRODUCTS: { label: "상품", to: "/products" },
  ORDERS: { label: "주문", to: "/orders" },
  ISSUES: { label: "반복 문제", to: "/memory" },
};

/** The honest sentence for an object the backend could not bind to a marketplace record. */
export const NOT_EXECUTABLE_SENTENCE: Record<"INQUIRY" | "REVIEW", string> = {
  INQUIRY: "이 문의는 파일로 가져온 기록이라 채널로 보낼 수 없습니다.",
  REVIEW: "이 리뷰는 파일로 가져온 기록이라 채널로 보낼 수 없습니다.",
};
export const COPY_ONLY_SENTENCE = "초안을 복사해 직접 등록해 주세요.";
export const COUPANG_REVIEW_UNSUPPORTED_SENTENCE = "쿠팡에서는 판매자가 리뷰에 직접 답글을 남기는 기능을 지원하지 않습니다.";
/** What a seller can still do about a review nobody can reply to — prompts, never a CTA. */
// Each chip is a sentence the planner already serves (review rows · inquiry workload · product signals);
// 「상세페이지 개선 검토」 was removed — no tool answers it, and a dead action is worse than none.
const REVIEW_UNSUPPORTED_CHIPS = ["이 상품 리뷰 더 보여줘", "이 상품 관련 문의 확인해줘", "이 상품에 반복되는 문제 있어?"];
const SEE_SO_FAR_PROMPT = "지금까지 확인된 리뷰 보여줘";

type ResolvedTarget =
  | { readonly kind: "INQUIRY"; readonly target: DraftTarget; readonly executableIdentity: ExecutableIdentity; readonly sourceSubtype: string | null }
  | { readonly kind: "REVIEW"; readonly target: ReviewDraftTarget; readonly executableIdentity: ExecutableIdentity };

interface Composed {
  status: TurnStatus; message: string; artifacts: Artifact[]; suggestedActions: SuggestedAction[];
  workingSet: WorkingSetView | null; pendingHumanActions: PendingHumanAction[];
  pendingPrepared: PendingPreparedAction | null; failureCode?: string; failureReason?: string;
  budget?: TurnView["budget"]; answer?: OperatorAnswer;
}

export class ConversationService {
  constructor(private readonly deps: ConversationServiceDeps) {}

  private now(): string {
    return (this.deps.now ?? (() => new Date()))().toISOString();
  }

  /** Resolve the tenant exactly the way runs do: verify the bearer at the backend, scope the store. */
  private async tenant(token: string): Promise<{ bundle: SpringClientBundle; store: ConversationStore; orgId: string }> {
    const bundle = this.deps.clientFactory(token);
    const { orgId } = await bundle.identity.whoami();
    const stores = this.deps.storeProvider.storesForRequest({ token, scope: scopeFor(orgId) });
    return { bundle, store: stores.conversations, orgId };
  }

  async create(token: string): Promise<ConversationView> {
    const { store } = await this.tenant(token);
    const at = this.now();
    const view: ConversationView = {
      conversationId: randomUUID(), createdAt: at, updatedAt: at, turns: [],
      workingSet: null, pendingHumanAction: null, pendingHumanActions: [], pendingPrepared: null,
    };
    await store.save(view);
    log("conversation_started", {});
    return view;
  }

  async get(token: string, id: string): Promise<ConversationView> {
    const { store } = await this.tenant(token);
    const view = await store.load(id);
    if (!view) throw new HttpError(404, "UNKNOWN_CONVERSATION", "no conversation found for this id");
    return view;
  }

  async list(token: string, limit: number): Promise<ConversationSummary[]> {
    const { store } = await this.tenant(token);
    return store.list(Math.max(1, Math.min(limit, 50)));
  }

  async turn(token: string, id: string, request: StartTurnRequest, progress: ProgressFn): Promise<TurnView> {
    const started = Date.now();
    const { bundle, store, orgId } = await this.tenant(token);
    const view = await store.load(id);
    if (!view) throw new HttpError(404, "UNKNOWN_CONVERSATION", "no conversation found for this id");

    // ── A resumed turn: the seller (or the watcher) says a human step may be done. Check each step's
    // own record before spending anything else — no model call, no tool call beyond those reads.
    let text = request.text ?? "";
    let hints: StartTurnRequest = request;
    let resumedFrom: string | undefined;
    let collected: ConversationRunContext["collected"] = undefined;
    let prefix = "";
    let remaining: PendingHumanAction[] = [];
    let partialChips: SuggestedAction[] = [];
    if (request.resumeOfTurnId) {
      const target = view.turns.find((t) => t.turnId === request.resumeOfTurnId && t.role === "AGENT");
      const pendingAll = pendingActionsOf(view);
      const user = target ? precedingUserTurn(view, target.turnId) : null;
      if (!target || !user || !user.text) {
        throw new HttpError(409, "NOTHING_TO_RESUME", "the turn to resume has no request behind it");
      }
      text = user.text;
      hints = { ...request, text: user.text };
      resumedFrom = target.turnId;
      const mine = pendingAll.filter((p) => p.turnId === target.turnId);
      if (mine.length > 0) {
        const checks = await Promise.all(mine.map(async (p) => ({ pending: p, check: await syncCompleted(bundle, p) })));
        const done = checks.filter((c) => c.check.completed);
        remaining = checks.filter((c) => !c.check.completed).map((c) => c.pending);
        const failed = checks.some((c) => c.check.failed);
        log("conversation_resumed", { pending: mine.length, completed: done.length, failed });
        if (done.length === 0) {
          const again = this.agentTurn(view, {
            status: "WAITING_HUMAN",
            message: failed
              ? "수집이 실패했습니다. 채널 연결 화면에서 상태를 확인한 뒤 다시 시도해 주세요."
              : "아직 수집이 끝나지 않았습니다.",
            artifacts: target.artifacts.filter((a) => a.type === "HUMAN_ACTION_REQUIRED"),
            suggestedActions: [{ label: "계속 확인하기", kind: "RESUME" }],
            workingSet: view.workingSet, pendingHumanActions: mine, pendingPrepared: view.pendingPrepared,
            resumedFrom,
          });
          await this.persist(store, view, [again], view.workingSet, mine, view.pendingPrepared);
          return again;
        }
        collected = done
          .filter((c) => c.pending.channelCode && c.pending.dataType && c.check.finishedAt)
          .map((c) => ({
            channelCode: c.pending.channelCode!, dataType: c.pending.dataType!, finishedAt: c.check.finishedAt!,
            successRows: c.check.successRows, partial: c.check.partial,
          }));
        const names = await channelNamesOf(bundle, target);
        const nameOf = (p: PendingHumanAction) => (p.channelCode ? names.get(p.channelCode.toUpperCase()) ?? p.channelCode : "채널");
        const anyPartial = done.some((c) => c.check.partial);
        if (remaining.length === 0) {
          prefix = anyPartial
            ? "새 리뷰 가져오기가 일부만 끝났습니다. 가져온 만큼 계속 확인하겠습니다. "
            : "새 리뷰 가져오기가 끝났습니다. 계속 확인하겠습니다. ";
        } else {
          // Partial: one channel's step is done, others are still waiting. Say so, show what is
          // known now, and offer the next step and the rows so far as the two obvious next moves.
          const doneNames = done.map((c) => nameOf(c.pending)).join("·");
          const restNames = remaining.map(nameOf).join("·");
          prefix = `${doneNames} 리뷰 확인이 끝났습니다. ${restNames}도 확인할까요? `;
          partialChips = [
            ...remaining.map((p) => ({ label: `${nameOf(p)} 확인`, kind: "RESUME" as const })),
            { label: "지금까지 보기", kind: "PROMPT" as const, prompt: SEE_SO_FAR_PROMPT },
          ];
        }
      }
    }
    if (text.trim().length === 0) {
      throw new HttpError(400, "INVALID_REQUEST", "a turn carries text or resumeOfTurnId");
    }

    const userTurn: TurnView = {
      turnId: randomUUID(), conversationId: id, role: "USER", text, message: text,
      artifacts: [], suggestedActions: [],
      continuation: { workingSet: view.workingSet, pendingHumanAction: null, pendingHumanActions: [], pendingPrepared: view.pendingPrepared },
      status: "DONE", createdAt: this.now(),
    };
    progress({ type: "stage", stage: "UNDERSTANDING", label: STAGE_LABEL.UNDERSTANDING, at: this.now() });

    const stage = (s: ProgressStage, label: string): void =>
      progress({ type: "stage", stage: s, label, at: this.now() });
    const runtime = new OperatorAgentRuntime({
      operator: bundle.operator, inquiry: bundle.inquiry, issue: bundle.issue,
      judgeMemoKey: orgId,
      progress: (s, label) => stage(s, label),
      // The one collection seam the run may call, bounded to AUTOMATIC-acquisition channels whose rows
      // are stale for the question (`graph/reviewRows.ts`). Constructed here so the lane owns it.
      refresher: new Refresher(bundle.inquiry),
    });
    // R5/R8: ONLY a PRODUCTS set of exactly one product is the product the seller is talking about,
    // and it travels as the same verified hint a product screen sends. A list that happens to hold
    // one product-bound row is not about that product (live: 20 inquiries, one bound, and 「배송
    // 얘기부터」 became a product-scoped read that found nothing).
    const set = view.workingSet;
    const anchoredProduct = !hints.productId && set?.kind === "PRODUCTS" && set.ids.length === 1 ? set.ids[0] : undefined;
    const goal: GoalRequest = {
      text,
      ...(hints.productId ? { productId: hints.productId } : anchoredProduct ? { productId: anchoredProduct } : {}),
      ...(hints.workItemId ? { workItemId: hints.workItemId } : {}),
      ...(hints.referenceDate ? { referenceDate: hints.referenceDate } : {}),
      conversation: {
        workingSet: view.workingSet,
        ...(priorLineOf(view) ? { priorLine: priorLineOf(view)! } : {}),
        ...(collected ? { collected } : {}),
        ...(pendingHumanWindowOf(view) ? { pendingHumanWindow: pendingHumanWindowOf(view) } : {}),
        localAgent: hints.localAgent ?? "UNKNOWN",
      },
    };
    const result = await runtime.run(`conv-${id}-${userTurn.turnId}`, goal);

    const composed = await this.compose(view, result, hints, prefix, bundle, stage, remaining, collected ?? []);
    if (partialChips.length > 0) {
      composed.suggestedActions = [...partialChips, ...composed.suggestedActions.filter((s) => s.kind !== "RESUME")];
    }
    const agentTurn = this.agentTurn(view, { ...composed, resumedFrom });
    if (agentTurn.status === "WAITING_HUMAN" && composed.pendingHumanActions.length > 0) {
      log("conversation_human_action", {
        actionType: composed.pendingHumanActions[0]!.actionType, path: composed.pendingHumanActions[0]!.path,
        count: composed.pendingHumanActions.length,
      });
    }
    // The pending actions are bound to THIS turn's id, which only exists now.
    const pendingHumanActions = composed.pendingHumanActions.map((p) => ({ ...p, turnId: agentTurn.turnId }));
    const pendingPrepared = composed.pendingPrepared
      ? { ...composed.pendingPrepared, turnId: agentTurn.turnId } : null;
    const workingSet = composed.workingSet ? { ...composed.workingSet, turnId: agentTurn.turnId } : null;
    const finalTurn: TurnView = {
      ...agentTurn,
      continuation: {
        workingSet, pendingHumanAction: pendingHumanActions[0] ?? null, pendingHumanActions, pendingPrepared,
      },
    };
    await this.persist(store, view, [userTurn, finalTurn], workingSet, pendingHumanActions, pendingPrepared);
    log("conversation_turn", {
      status: finalTurn.status,
      toolCalls: finalTurn.budget?.toolCalls ?? 0,
      llmCalls: finalTurn.budget?.llmCalls ?? 0,
      ms: Date.now() - started,
      artifactTypes: [...new Set(finalTurn.artifacts.map((a) => a.type))].join(","),
      workingSetKind: workingSet?.kind ?? "NONE",
      requestedAction: result.status === "DONE" ? conversationAxisOf(result.plan ?? emptyPlan()).requestedAction : "NONE",
    });
    return finalTurn;
  }

  private agentTurn(view: ConversationView, input: {
    status: TurnStatus; message: string; artifacts: readonly Artifact[]; suggestedActions: readonly SuggestedAction[];
    workingSet: WorkingSetView | null; pendingHumanActions: readonly PendingHumanAction[];
    pendingPrepared: PendingPreparedAction | null; resumedFrom?: string; failureCode?: string; failureReason?: string;
    budget?: TurnView["budget"]; answer?: OperatorAnswer;
  }): TurnView {
    return {
      turnId: randomUUID(), conversationId: view.conversationId, role: "AGENT",
      message: input.message, artifacts: input.artifacts, suggestedActions: input.suggestedActions,
      continuation: {
        workingSet: input.workingSet, pendingHumanAction: input.pendingHumanActions[0] ?? null,
        pendingHumanActions: [...input.pendingHumanActions], pendingPrepared: input.pendingPrepared,
      },
      status: input.status,
      ...(input.failureCode ? { failureCode: input.failureCode } : {}),
      ...(input.failureReason ? { failureReason: input.failureReason } : {}),
      ...(input.budget ? { budget: input.budget } : {}),
      ...(input.resumedFrom ? { resumedFrom: input.resumedFrom } : {}),
      createdAt: this.now(),
      ...(input.answer ? { answer: input.answer } : {}),
    };
  }

  private async persist(
    store: ConversationStore, view: ConversationView, turns: readonly TurnView[],
    workingSet: WorkingSetView | null, pendingHumanActions: readonly PendingHumanAction[],
    pendingPrepared: PendingPreparedAction | null,
  ): Promise<void> {
    await store.save({
      ...view,
      turns: boundedTurns([...view.turns, ...turns]),
      workingSet, pendingHumanAction: pendingHumanActions[0] ?? null, pendingHumanActions: [...pendingHumanActions], pendingPrepared,
      updatedAt: this.now(),
    });
  }

  /** The answer → the turn: status, message, artifacts, actions, continuation. */
  private async compose(
    view: ConversationView, result: OperatorRunResult, hints: StartTurnRequest, prefix: string,
    bundle: SpringClientBundle, stage: (s: ProgressStage, label: string) => void,
    stillPending: readonly PendingHumanAction[], collected: NonNullable<ConversationRunContext["collected"]>,
  ): Promise<Composed> {
    if (result.status === "FAILED") {
      return {
        status: "FAILED", message: result.reason, artifacts: [], suggestedActions: [],
        workingSet: view.workingSet, pendingHumanActions: [], pendingPrepared: view.pendingPrepared,
        failureCode: result.failureCode, failureReason: result.reason,
      };
    }
    const { answer, plan } = result;
    // The same override the graph applied (R7) — the headline must not say 「방금 본 N건 중」 about a
    // set the read did not use.
    const axis = effectiveAxisOf(plan ?? emptyPlan(), view.workingSet);
    const budget = {
      toolCalls: answer.budget.toolCalls, llmCalls: answer.budget.llmCalls,
      elapsedMs: answer.budget.elapsedMs, stopReason: answer.budget.stopReason,
    };
    if (answer.budget.stopReason === "NO_PLAN") {
      // The model understood and refused, or found the sentence unsupported. A real answer — and a
      // FAILED turn rather than a canned object, so the seller reads the reason and not a table.
      const reason = answer.note ?? "이 요청은 아직 지원하지 않습니다.";
      return {
        status: "FAILED", message: reason, artifacts: [], suggestedActions: [],
        workingSet: view.workingSet, pendingHumanActions: [], pendingPrepared: view.pendingPrepared,
        failureCode: "GOAL_UNSUPPORTED", failureReason: reason, budget, answer,
      };
    }
    if (answer.budget.stopReason === "CLARIFICATION_NEEDED" && answer.clarification) {
      return {
        status: "DONE", message: answer.clarification, artifacts: [], suggestedActions: [],
        workingSet: view.workingSet, pendingHumanActions: [], pendingPrepared: view.pendingPrepared, budget, answer,
      };
    }

    // A step still pending from the turn being resumed keeps its own `requestedAt`: a run that finished
    // between that moment and now is that step's completion, and a fresh stamp would hide it.
    const stamped: Artifact[] = result.artifacts.map((a) => {
      if (a.type !== "HUMAN_ACTION_REQUIRED") return a;
      const prior = stillPending.find((p) => p.actionType === a.actionType && (p.channelCode ?? null) === (a.channelCode ?? null));
      return prior ? { ...a, requestedAt: prior.requestedAt } : a;
    });
    // A replan runs a specialist twice and would show the same list twice; the later read is the one kept.
    const artifacts: Artifact[] = dedupeLists(stamped);
    let pendingPrepared: PendingPreparedAction | null = view.pendingPrepared;
    let headline: string | null = null;
    const extraChips: SuggestedAction[] = [];
    // R4: a product answer with no list artifact still names products — in its evidence refs and in
    // the entity the run resolved. Those become a PRODUCT_LIST and a PRODUCTS set, so 「첫 번째 거」 has
    // something to point at.
    if (!primaryOf(artifacts)) {
      const products = productListOf(answer, result.entities);
      if (products) artifacts.push(products);
    }
    let workingSet: WorkingSetView | null = workingSetOf(artifacts, axis, view) ?? view.workingSet;
    // R8: after an ordinal resolution over a PRODUCTS set, the anchor stays that one product so the
    // next sentence (「왜 이런 문제가 생긴 것 같아?」) still has it — whatever list the turn drew.
    const ordinal = result.entities.find((e) => e.kind === "PRODUCT" && e.resolvedBy === OPERATOR_TOOL.GET_PRODUCT_SIGNALS);
    if (ordinal && view.workingSet?.kind === "PRODUCTS"
        && (!workingSet || workingSet.productIds.every((p) => p === ordinal.id))) {
      workingSet = {
        kind: "PRODUCTS", label: ordinal.label, count: 1, ids: [ordinal.id], filters: {},
        productIds: [ordinal.id], workItemIds: workingSet?.workItemIds ?? [], turnId: "",
      };
    }
    // R2: a filter over the previous set that left nothing keeps the previous set as the anchor —
    // 「0건」 is the message; the seller is still standing on what they saw before.
    if (axis.filters.scope === "WORKING_SET" && workingSet && workingSet.ids.length === 0 && workingSet.workItemIds.length === 0
        && view.workingSet) {
      workingSet = view.workingSet;
    }

    // ── PREPARE: a draft for the targeted inquiry or review, through the product's own draft path.
    if (axis.requestedAction === "PREPARE_INQUIRY_DRAFT") {
      const targets = await this.resolveTargets(axis.target.selector, axis.target.index, view, hints, bundle, workingSet);
      if (targets.length === 0) {
        headline = "어떤 문의의 답변을 준비할지 알려주세요. 방금 본 목록에서 「첫 번째 거」처럼 말씀해 주시면 됩니다.";
      } else {
        const preparer = new DraftPreparer(bundle.inquiry, bundle.review);
        for (const resolved of targets) {
          if (resolved.kind === "REVIEW") {
            // A review nobody can reply to on its channel gets no draft — a draft with no place to
            // go is a promise. The next moves are prompts about the review, never a CTA.
            const verdict = await this.reviewCapability(bundle, resolved.target);
            if (verdict.execution === "NOT_SUPPORTED" && verdict.reason === EXECUTION_REASON.CHANNEL_UNSUPPORTED) {
              artifacts.push(reviewUnsupportedSummary(resolved.target));
              headline = headline ?? summaryLineFor(resolved.target.channelCode);
              extraChips.push(...REVIEW_UNSUPPORTED_CHIPS.map(promptChip));
              continue;
            }
            if (verdict.execution === "NOT_SUPPORTED" && verdict.reason === EXECUTION_REASON.CAPABILITY_UNKNOWN) {
              // Acceptance Closure §10: a channel whose reply semantics could not be read gets no draft — a
              // draft for a place that may not exist is the Coupang loophole by another door.
              const line = `${resolved.target.channelNameKo ?? resolved.target.channelCode ?? "이 채널"}에서 리뷰 답글을 어떻게 처리할 수 있는지 확인하지 못해 초안을 준비하지 않았습니다.`;
              artifacts.push(reasonSummary(`a-cap-${resolved.target.reviewId}`, "리뷰 답글 초안을 준비하지 않았습니다", [line]));
              headline = headline ?? line;
              continue;
            }
            stage("PREPARING_DRAFT", STAGE_LABEL.PREPARING_DRAFT);
            const draft = await preparer.prepareReview(resolved.target, axis.tone, `a-draft-${resolved.target.reviewId}`, verdict);
            artifacts.push(draft);
            if (draft.unavailableMessage) {
              headline = headline ?? draft.unavailableMessage;
            } else if (draft.note && !draft.tone) {
              headline = headline ?? draft.note;
            } else {
              headline = headline ?? (axis.tone ? "말투를 바꿔 리뷰 답글 초안을 다시 준비했습니다." : "리뷰 답글 초안을 준비했습니다.");
            }
            if (draft.version) {
              pendingPrepared = {
                turnId: "", kind: "REVIEW_DRAFT", workItemId: resolved.target.reviewId, inquiryId: resolved.target.actionRef,
                accountId: resolved.target.accountId, draftVersion: draft.version, contentFingerprint: draft.contentFingerprint,
              };
            }
            continue;
          }
          const target = resolved.target;
          stage("PREPARING_DRAFT", STAGE_LABEL.PREPARING_DRAFT);
          const draft = await preparer.prepare(target, axis.tone, `a-draft-${target.workItemId}`);
          artifacts.push(draft);
          if (draft.unavailableMessage) {
            headline = headline ?? draft.unavailableMessage;
          } else if (draft.answerBasis === "NO_ANSWER_BASIS" || !draft.version) {
            headline = headline ?? (draft.answerBasisNote ?? "답변 기준이 필요합니다.");
            artifacts.push({
              artifactId: `a-knowledge-${target.workItemId}`, type: "HUMAN_ACTION_REQUIRED",
              title: "답변 기준을 등록하면 초안을 만들 수 있습니다",
              actionType: "KNOWLEDGE_ENTRY", reason: "NO_ANSWER_BASIS", path: "WORKSPACE",
              channelCode: target.channelCode, channelNameKo: target.channelNameKo, accountId: null,
              dataType: "INQUIRY", to: `/inquiries/${target.inquiryId}`, requestedAt: this.now(), resumable: false,
            });
          } else if (draft.note && !draft.tone) {
            // A tone variant that moved a fact: refused, previous head kept, and said so.
            headline = headline ?? draft.note;
          } else {
            headline = headline ?? (axis.tone ? "말투를 바꿔 초안을 다시 준비했습니다." : "답변 초안을 준비했습니다.");
            pendingPrepared = {
              turnId: "", kind: "INQUIRY_DRAFT", workItemId: target.workItemId, inquiryId: target.inquiryId,
              draftVersion: draft.version, contentFingerprint: draft.contentFingerprint,
            };
          }
        }
      }
    }

    // ── SEND: route to the path the channel and the object actually have. No write of any kind.
    if (axis.requestedAction === "REQUEST_SEND_APPROVAL") {
      const routed = await this.routeSend(pendingPrepared, axis, view, hints, bundle, workingSet);
      if (!routed) {
        headline = "전송할 초안이 아직 없습니다. 먼저 「답변 준비해줘」로 초안을 만들어 주세요.";
      } else {
        artifacts.push(routed.artifact);
        headline = routed.headline;
        extraChips.push(...routed.chips);
      }
    }

    // ── EXPLAIN_CAPABILITY: 「쿠팡 건은 왜 답변 못 해?」 — the capability verdict, said in the seller's words.
    if (axis.requestedAction === "EXPLAIN_CAPABILITY") {
      const explained = await this.explainCapability(bundle, view, axis.filters.channel ?? workingSet?.filters.channelCode ?? null, workingSet);
      artifacts.push(explained.artifact);
      headline = headline ?? explained.headline;
      extraChips.push(...explained.chips);
    }

    // ── OPEN_WORKSPACE: a link to the screen that owns the objects the plan is about.
    if (axis.requestedAction === "OPEN_WORKSPACE") {
      const link = workspaceFor(plan, workingSet);
      artifacts.push(link);
      headline = headline ?? `${link.link.label} 화면을 열어 드립니다.`;
    }

    // R6: 「내가 해야 할 일 정리해줘」 — a checklist composed from this turn and the conversation, no model.
    if (axis.requestedAction === "LIST_ACTIONS") {
      const checklist = checklistOf(artifacts, view);
      artifacts.push(checklist);
      headline = checklist.items.length > 0
        ? `지금 하실 일을 정리했습니다 (${checklist.items.length}건).`
        : "지금 먼저 하실 일은 없습니다.";
    }

    const humans = artifacts.filter((a): a is HumanActionRequiredArtifact => a.type === "HUMAN_ACTION_REQUIRED");
    // An offered refresh (`optional`) is a control under the rows, not a reason to wait: the turn is DONE.
    const human = humans.find((h) => !h.optional) ?? null;
    const primary = primaryOf(artifacts);
    const first = headline ?? headlineOf(primary, artifacts, view, axis, answer);
    // R3: a count finding that says what the headline already said (same numbers, same noun) is one
    // fact twice. Dropped from the prose; it stays in the answer's findings with its evidence.
    const supported = answer.findings
      .filter((f) => f.confidence === "SUPPORTED")
      .map((f) => f.statement)
      .filter((s) => s !== first && !redundantWithHeadline(s, first));
    const sentences = [prefix + first, ...dedupe(supported).slice(0, FINDINGS_MAX)];
    // Claim levels for the channels whose step just finished — B (rows written in the window) over C
    // (rows ingested); never A. `reviewClaim.ts` keeps ingested ≠ written.
    if (collected.length > 0 && primary?.type === "REVIEW_LIST") {
      const names = new Map(primary.freshness.map((f) => [f.channelCode.toUpperCase(), f.channelNameKo ?? f.channelCode]));
      for (const claim of claimsFor(primary.items, primary.scope.period ?? { from: "0000-00-00", to: "9999-99-99", token: null }, collected, names)) {
        sentences.push(claim.sentence);
      }
    }
    // The rows path's own note — 「언제 기준」 per stale channel, a refresh that could not be made, a
    // partial collection — each said once here and nowhere else in the prose. Never model prose.
    // Sentence by sentence, so a fact the findings already said (the per-channel 「언제 기준」) is not read twice.
    if (answer.note) sentences.push(...answer.note.split(/(?<=[.!?])\s+/).filter((s) => s.length > 0));

    const evidenceArtifact = evidenceOf(answer);
    if (evidenceArtifact) artifacts.push(evidenceArtifact);

    const pendingHumanActions: PendingHumanAction[] = humans.map((h) => ({
      turnId: "", actionType: h.actionType, path: h.path, channelCode: h.channelCode,
      accountId: h.accountId, dataType: h.dataType, requestedAt: h.requestedAt,
      ...(h.optional ? { optional: true } : {}),
    }));
    const status: TurnStatus = human ? "WAITING_HUMAN" : "DONE";
    return {
      status, message: [...new Set(sentences)].join(" "), artifacts,
      suggestedActions: [...extraChips, ...suggestionsFor(primary, workingSet, human, artifacts)].slice(0, extraChips.length + 4),
      workingSet, pendingHumanActions, pendingPrepared, budget, answer,
    };
  }

  /** Which objects a draft/send sentence points at — an index into what the previous turn showed. */
  private async resolveTargets(
    selector: string, index: number | null, view: ConversationView, hints: StartTurnRequest,
    bundle: SpringClientBundle, workingSet: WorkingSetView | null,
  ): Promise<ResolvedTarget[]> {
    const set = pickSet(workingSet, view);
    // 「이거」 over a prepared draft: the draft's own object, whatever the current set is.
    const prepared = view.pendingPrepared;
    if ((selector === "THIS" || selector === "NONE") && !hints.workItemId && prepared) {
      const known = prepared.kind === "REVIEW_DRAFT"
        ? reviewTargetFromHistory(view, prepared.workItemId)
        : inquiryTargetFromHistory(view, prepared.workItemId);
      if (known) return [known];
    }
    if (set?.kind === "REVIEWS") {
      const pick = (ids: readonly string[]) => ids.map((id) => reviewTargetFromHistory(view, id)).filter((t): t is ResolvedTarget => t != null);
      switch (selector) {
        case "FIRST": return pick(set.ids.slice(0, 1));
        case "NTH": return index != null && index >= 1 ? pick(set.ids.slice(index - 1, index)) : [];
        case "ALL": return pick(set.ids.slice(0, ALL_TARGETS_MAX));
        default: return set.ids.length === 1 ? pick(set.ids) : [];
      }
    }
    const ids = set?.kind === "INQUIRIES" ? set.workItemIds : [];
    const pick = (workItemIds: readonly string[]): ResolvedTarget[] =>
      workItemIds.map((id) => inquiryTargetFromHistory(view, id)).filter((t): t is ResolvedTarget => t != null);
    switch (selector) {
      case "FIRST":
        return pick(ids.slice(0, 1));
      case "NTH":
        return index != null && index >= 1 ? pick(ids.slice(index - 1, index)) : [];
      case "ALL":
        return pick(ids.slice(0, ALL_TARGETS_MAX));
      case "THIS":
      default: {
        // The inquiry the seller is standing on (the screen's hint), the draft just prepared, or the
        // one inquiry in the set. A hint is verified by the same org-scoped read the runtime uses.
        if (hints.workItemId) {
          const known = inquiryTargetFromHistory(view, hints.workItemId);
          if (known) return [known];
          try {
            const detail = await bundle.inquiry.getInquiryDetail(hints.workItemId);
            return [{
              kind: "INQUIRY",
              target: {
                workItemId: detail.workItemId, inquiryId: detail.inquiryId, channelCode: detail.channelCode,
                channelNameKo: detail.channelNameKo, productId: detail.productId ?? null, productName: detail.productName ?? null,
              },
              executableIdentity: detail.executableIdentity ?? "NONE",
              sourceSubtype: detail.sourceSubtype ?? null,
            }];
          } catch {
            return [];
          }
        }
        return ids.length === 1 ? pick(ids) : [];
      }
    }
  }

  /** The execution capability of a review's channel, read for its own API-mode account. Fail closed. */
  /**
   * What reviewnary can and cannot do on one channel for the kind of object the seller is looking at —
   * acquisition and execution, from the same verdict the actions use, in two sentences and no API names.
   */
  private async explainCapability(
    bundle: SpringClientBundle, view: ConversationView, channel: string | null, workingSet: WorkingSetView | null,
  ): Promise<{ artifact: SummaryArtifact; headline: string; chips: SuggestedAction[] }> {
    const objectKind: ObjectKind = workingSet?.kind === "INQUIRIES" ? "INQUIRY" : "REVIEW";
    const code = channel?.toUpperCase() ?? null;
    if (!code) {
      const line = "어느 채널에 대한 질문인지 알려주세요 (네이버 · 쿠팡 · 카페24).";
      return { artifact: reasonSummary("a-capability", "채널을 알려주세요", [line]), headline: line, chips: [] };
    }
    const name = channelNameOf(view, code) ?? code;
    const what = objectKind === "REVIEW" ? "리뷰 답글" : "문의 답변";
    let verdict: ChannelCapabilityVerdict;
    if (objectKind === "REVIEW") {
      const item = lastReviewItemOf(view, code);
      const target = item ? reviewTargetFromHistory(view, item.reviewId) : null;
      if (target && target.kind === "REVIEW") {
        verdict = await this.reviewCapability(bundle, target.target);
      } else {
        // No row of that channel in the thread: the account itself answers (two org-scoped READs).
        let reviewChannel = null;
        try {
          const [accounts, channels] = await Promise.all([bundle.inquiry.listSellerAccounts(), bundle.operator.listChannels()]);
          const channelId = channels.find((c) => c.code.toUpperCase() === code)?.id ?? null;
          const account = channelId ? accounts.find((a) => a.channelId === channelId && !a.fileUpload) ?? null : null;
          reviewChannel = account ? (await bundle.operator.getReviewChannelCapability?.(account.id)) ?? null : null;
        } catch {
          reviewChannel = null;
        }
        verdict = capabilityOf({ channelCode: code, dataType: "REVIEW", objectKind: "REVIEW" },
          { overview: null, transports: null, publish: null, reviewChannel, localAgent: "UNKNOWN" });
      }
    } else {
      verdict = await this.inquiryCapability(bundle, code, null);
    }
    const acquisition = verdict.acquisition === "AUTOMATIC"
      ? `${name} ${objectKind === "REVIEW" ? "리뷰" : "문의"}는 reviewnary가 자동으로 가져옵니다.`
      : verdict.acquisition === "GUIDED_HUMAN_ACTION"
        ? `${name} ${objectKind === "REVIEW" ? "리뷰" : "문의"}는 판매자센터에서 한 번 확인해 주시면 reviewnary가 이어서 가져옵니다.`
        : `${name} ${objectKind === "REVIEW" ? "리뷰" : "문의"}는 아직 가져올 경로가 없습니다.`;
    const execution = verdict.execution === "API_EXECUTION"
      ? `${what}은 승인하시면 reviewnary가 채널에 바로 게시하고 결과를 확인합니다.`
      : verdict.execution === "GUIDED_BROWSER_EXECUTION"
        ? `${what}은 reviewnary가 해당 ${objectKind === "REVIEW" ? "리뷰" : "문의"}를 찾아 답글을 채워 두고, 등록은 판매자님이 누릅니다.`
        : verdict.reason === EXECUTION_REASON.CHANNEL_UNSUPPORTED
          ? summaryLineFor(code)
          : executionReasonSentence(verdict, name, what);
    const unsupported = verdict.execution === "NOT_SUPPORTED" && verdict.reason === EXECUTION_REASON.CHANNEL_UNSUPPORTED;
    return {
      artifact: reasonSummary("a-capability", `${name}에서 할 수 있는 것`, [acquisition, execution]),
      headline: execution,
      chips: unsupported && objectKind === "REVIEW" ? REVIEW_UNSUPPORTED_CHIPS.map(promptChip) : [],
    };
  }

  private async reviewCapability(bundle: SpringClientBundle, target: ReviewDraftTarget): Promise<ChannelCapabilityVerdict> {
    let reviewChannel = null;
    try {
      reviewChannel = (await bundle.operator.getReviewChannelCapability?.(target.accountId)) ?? null;
    } catch {
      reviewChannel = null;
    }
    return capabilityOf(
      { channelCode: target.channelCode ?? "", objectKind: "REVIEW" },
      { overview: null, transports: null, publish: null, reviewChannel, localAgent: "UNKNOWN" },
    );
  }

  /** The execution capability of an inquiry's channel for its source subtype. Fail closed. */
  private async inquiryCapability(bundle: SpringClientBundle, channelCode: string | null, sourceSubtype: string | null): Promise<ChannelCapabilityVerdict> {
    const [transports, publish] = await Promise.all([
      bundle.operator.listInquiryReplyTransports?.().catch(() => null) ?? Promise.resolve(null),
      bundle.inquiry.getPublishCapability().catch(() => null),
    ]);
    return capabilityOf(
      { channelCode: channelCode ?? "", objectKind: "INQUIRY", sourceSubtype },
      { overview: null, transports, publish, reviewChannel: null, localAgent: "UNKNOWN" },
    );
  }

  /**
   * 「보내자」 → the one artifact the object's channel can honestly offer.
   *
   * Identity first (a NONE object gets the copy path whatever the channel can do), then the channel's
   * execution capability for the object kind: API ⇒ APPROVAL bound to the exact draft version; guided
   * browser ⇒ GUIDED_EXECUTION; neither ⇒ SUMMARY with the audited reason. Nothing is sent, minted,
   * approved or started here.
   */
  private async routeSend(
    pendingPrepared: PendingPreparedAction | null, axis: ReturnType<typeof conversationAxisOf>,
    view: ConversationView, hints: StartTurnRequest, bundle: SpringClientBundle, workingSet: WorkingSetView | null,
  ): Promise<{ artifact: Artifact; headline: string; chips: SuggestedAction[] } | null> {
    const resolved = pendingPrepared
      ? (pendingPrepared.kind === "REVIEW_DRAFT" ? reviewTargetFromHistory(view, pendingPrepared.workItemId) : inquiryTargetFromHistory(view, pendingPrepared.workItemId))
      : (await this.resolveTargets(axis.target.selector, axis.target.index, view, hints, bundle, workingSet))[0] ?? null;
    if (!resolved) return null;

    if (resolved.kind === "REVIEW") {
      const t = resolved.target;
      const name = t.channelNameKo ?? t.channelCode ?? "채널";
      if (resolved.executableIdentity !== "MARKETPLACE") {
        return { artifact: copyOnlySummary("REVIEW", t.reviewId), headline: NOT_EXECUTABLE_SENTENCE.REVIEW, chips: [] };
      }
      const verdict = await this.reviewCapability(bundle, t);
      if (verdict.execution === "NOT_SUPPORTED") {
        if (verdict.reason === EXECUTION_REASON.CHANNEL_UNSUPPORTED) {
          return { artifact: reviewUnsupportedSummary(t), headline: summaryLineFor(t.channelCode), chips: REVIEW_UNSUPPORTED_CHIPS.map(promptChip) };
        }
        const line = executionReasonSentence(verdict, name, "리뷰 답글");
        return { artifact: reasonSummary(`a-send-${t.reviewId}`, "리뷰 답글을 채널로 보낼 수 없습니다", [line, COPY_ONLY_SENTENCE]), headline: line, chips: [] };
      }
      // The draft the action binds to: the one this conversation prepared, else the review's own head.
      let draftVersion = pendingPrepared?.kind === "REVIEW_DRAFT" && pendingPrepared.workItemId === t.reviewId ? pendingPrepared.draftVersion : null;
      let contentFingerprint = draftVersion != null ? pendingPrepared!.contentFingerprint : null;
      if (draftVersion == null) {
        try {
          const prep = await bundle.review.getReviewReplyPrep(t.accountId, t.actionRef);
          if (!prep.draft) return null;
          draftVersion = prep.draft.version;
          contentFingerprint = prep.draft.contentFingerprint;
        } catch {
          return null;
        }
      }
      if (verdict.execution === "GUIDED_BROWSER_EXECUTION") {
        const guided: GuidedExecutionArtifact = {
          artifactId: `a-guided-${t.reviewId}`, type: "GUIDED_EXECUTION", title: `${name}에서 답변하기`,
          actionType: "REVIEW_REPLY", objectKind: "REVIEW", channelCode: t.channelCode ?? "", channelNameKo: t.channelNameKo,
          accountId: t.accountId, reviewId: t.reviewId, actionRef: t.actionRef, draftVersion, contentFingerprint,
          requiresLocalAgent: true, to: "/reviews",
        };
        return {
          artifact: guided,
          headline: `${name}에서 답글을 등록하려면 판매자님의 확인이 필요합니다. reviewnary가 해당 리뷰를 찾아 초안을 채워 두고, 등록은 판매자님이 누릅니다.`,
          chips: [],
        };
      }
      const approval: ApprovalArtifact = {
        artifactId: `a-approval-${t.reviewId}`, type: "APPROVAL", title: "답글 전송 승인",
        objectKind: "REVIEW", targetId: t.reviewId, accountId: t.accountId, actionRef: t.actionRef,
        channelCode: t.channelCode, channelNameKo: t.channelNameKo, draftVersion, contentFingerprint,
        execution: "API_EXECUTION", executableIdentity: "MARKETPLACE", to: "/reviews",
      };
      return { artifact: approval, headline: "다음 답글을 전송하려면 승인이 필요합니다. 전송은 승인 뒤 기존 실행 경로로만 진행됩니다.", chips: [] };
    }

    const t = resolved.target;
    const name = t.channelNameKo ?? t.channelCode ?? "채널";
    if (resolved.executableIdentity !== "MARKETPLACE") {
      return { artifact: copyOnlySummary("INQUIRY", t.workItemId, `/inquiries/${t.inquiryId}`), headline: NOT_EXECUTABLE_SENTENCE.INQUIRY, chips: [] };
    }
    const verdict = await this.inquiryCapability(bundle, t.channelCode, resolved.sourceSubtype);
    if (verdict.execution !== "API_EXECUTION") {
      const line = executionReasonSentence(verdict, name, "문의 답변");
      return { artifact: reasonSummary(`a-send-${t.workItemId}`, "문의 답변을 채널로 보낼 수 없습니다", [line, COPY_ONLY_SENTENCE]), headline: line, chips: [] };
    }
    let draftVersion = pendingPrepared?.kind === "INQUIRY_DRAFT" && pendingPrepared.workItemId === t.workItemId ? pendingPrepared.draftVersion : null;
    let contentFingerprint = draftVersion != null ? pendingPrepared!.contentFingerprint : null;
    if (draftVersion == null) {
      // No prepared draft in this conversation: the targeted inquiry may already hold one (a READ).
      try {
        const detail = await bundle.inquiry.getInquiryDetail(t.workItemId);
        if (!detail.draft) return null;
        draftVersion = detail.draft.version;
        contentFingerprint = detail.draft.contentFingerprint;
      } catch {
        return null;
      }
    }
    const approval: ApprovalArtifact = {
      artifactId: `a-approval-${t.workItemId}`, type: "APPROVAL", title: "전송 승인",
      objectKind: "INQUIRY", targetId: t.workItemId, workItemId: t.workItemId, inquiryId: t.inquiryId,
      channelCode: t.channelCode, channelNameKo: t.channelNameKo, draftVersion, contentFingerprint,
      execution: "API_EXECUTION", executableIdentity: "MARKETPLACE", to: `/inquiries/${t.inquiryId}`,
    };
    return { artifact: approval, headline: "다음 초안을 전송하려면 승인이 필요합니다. 전송은 승인 뒤 기존 실행 경로로만 진행됩니다.", chips: [] };
  }
}

/* ───────────────────────────── helpers (deterministic composition) ───────────────────────────── */

function emptyPlan(): InvestigationPlan {
  return {
    supported: false, userGoal: "", entities: { resolved: [], unresolved: [] }, informationNeeds: [],
    specialistTargets: [], candidateTools: [], retrievalStrategy: { order: [], parallelizable: [], stopWhen: null },
    evidenceRequirements: [], riskClass: "ROUTINE", stoppingCriteria: { maxIterations: 0, maxToolCalls: 0, enough: null },
    clarificationNeeded: false, clarificationReason: null, rationale: null, plannerVersion: "none", appliedDefaults: [],
  };
}

function precedingUserTurn(view: ConversationView, agentTurnId: string): TurnView | null {
  const at = view.turns.findIndex((t) => t.turnId === agentTurnId);
  for (let i = at - 1; i >= 0; i -= 1) {
    if (view.turns[i]!.role === "USER") return view.turns[i]!;
  }
  return null;
}

/** Every pending step the conversation holds — the list when the store has it, else the singular. */
function pendingActionsOf(view: ConversationView): PendingHumanAction[] {
  if (view.pendingHumanActions && view.pendingHumanActions.length > 0) return [...view.pendingHumanActions];
  return view.pendingHumanAction ? [view.pendingHumanAction] : [];
}

/** The set a draft/send sentence indexes into — the turn's own when it drew one, else the conversation's. */
function pickSet(workingSet: WorkingSetView | null, view: ConversationView): WorkingSetView | null {
  const candidates = [workingSet, view.workingSet];
  return candidates.find((s) => s?.kind === "INQUIRIES" || s?.kind === "REVIEWS") ?? null;
}

/** Channel names as the resumed turn's own artifacts carried them — no extra read when they are there. */
async function channelNamesOf(bundle: SpringClientBundle, target: TurnView): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const a of target.artifacts) {
    if (a.type === "HUMAN_ACTION_REQUIRED" && a.channelCode && a.channelNameKo) names.set(a.channelCode.toUpperCase(), a.channelNameKo);
    if (a.type === "REVIEW_LIST") for (const f of a.freshness) if (f.channelNameKo) names.set(f.channelCode.toUpperCase(), f.channelNameKo);
  }
  if (names.size === 0) {
    try {
      for (const c of await bundle.operator.listChannels()) names.set(c.code.toUpperCase(), c.nameKo);
    } catch {
      // Names are decoration on the sentence; the code stands in when the catalogue cannot be read.
    }
  }
  return names;
}

/** Has the pending human step's own record finished since it was requested? One READ, nothing else. */
async function syncCompleted(bundle: SpringClientBundle, pending: PendingHumanAction): Promise<{ completed: boolean; failed: boolean; partial: boolean; finishedAt: string | null; successRows: number | null }> {
  const none = { completed: false, failed: false, partial: false, finishedAt: null, successRows: null };
  if (!pending.accountId || !pending.dataType) return none;
  // Two shapes of the same fact, matched as tightly as each shape allows (Acceptance Closure §8-B):
  //  - a connector/guided run is stamped with the ACCOUNT and `dataType` — it must be this account's;
  //  - a file upload carries no account, only the channel and `uploadType` — it must be this account's
  //    channel, upload-shaped (no account on the row), and of the requested type.
  // Either way it must have FINISHED after the step was requested, and be the kind of step that was
  // asked for. A run some other tab started on another account never satisfies this one.
  const accounts = await bundle.inquiry.listSellerAccounts();
  const channelId = accounts.find((a) => a.id === pending.accountId)?.channelId ?? null;
  const runs = await bundle.inquiry.listSyncRuns({});
  const guidedOrManual = new Set(["MANUAL", "UPLOAD", "ACTION_WINDOW", "AGENT", "GUIDED"]);
  const mine = runs.filter((r) => {
    const type = r.dataType ?? r.uploadType ?? null;
    if (type !== pending.dataType) return false;
    if (r.sellerAccountId != null) return r.sellerAccountId === pending.accountId;
    // Upload-shaped: no account on the row. Only the requested channel, and only a seller-driven trigger.
    return channelId != null && r.channelId === channelId && r.uploadType != null
      && (r.trigger == null || guidedOrManual.has(r.trigger.toUpperCase()));
  });
  const after = mine.filter((r) => r.finishedAt != null && r.finishedAt > pending.requestedAt);
  const done = after.filter((r) => r.status === "SUCCESS" || r.status === "PARTIAL");
  const completed = done.length > 0;
  const failed = !completed && after.some((r) => r.status === "FAILED");
  const latest = [...done].sort((a, b) => a.finishedAt!.localeCompare(b.finishedAt!)).at(-1) ?? null;
  return {
    completed, failed, partial: latest?.status === "PARTIAL",
    finishedAt: latest?.finishedAt ?? null, successRows: latest?.successRows ?? null,
  };
}

/** The last REVIEW_LIST row of a channel the thread has shown — the object an explanation is about. */
function lastReviewItemOf(view: ConversationView, channelCode: string): ReviewItem | null {
  for (let i = view.turns.length - 1; i >= 0; i--) {
    for (const a of view.turns[i]!.artifacts) {
      if (a.type !== "REVIEW_LIST") continue;
      const hit = a.items.find((r) => r.channelCode.toUpperCase() === channelCode);
      if (hit) return hit;
    }
  }
  return null;
}

/** The seller-facing channel name as the thread already printed it, when any artifact carries it. */
function channelNameOf(view: ConversationView, channelCode: string): string | null {
  for (let i = view.turns.length - 1; i >= 0; i--) {
    for (const a of view.turns[i]!.artifacts) {
      if (a.type === "REVIEW_LIST") {
        const f = a.freshness.find((r) => r.channelCode.toUpperCase() === channelCode);
        if (f?.channelNameKo) return f.channelNameKo;
      }
      if (a.type === "HUMAN_ACTION_REQUIRED" && (a.channelCode ?? "").toUpperCase() === channelCode && a.channelNameKo) return a.channelNameKo;
    }
  }
  return null;
}

/** Same-type list artifacts with the same title collapse to the last one; everything else is kept in order. */
function dedupeLists(artifacts: readonly Artifact[]): Artifact[] {
  const LISTS = new Set(["INQUIRY_LIST", "REVIEW_LIST", "PRODUCT_LIST", "ISSUE_LIST", "ORDER_SUMMARY", "CHART"]);
  const lastIndex = new Map<string, number>();
  artifacts.forEach((a, i) => { if (LISTS.has(a.type)) lastIndex.set(`${a.type}:${a.title}`, i); });
  return artifacts.filter((a, i) => !LISTS.has(a.type) || lastIndex.get(`${a.type}:${a.title}`) === i);
}

/** The period token of the review window a pending human step was asked for — null when none is pending. */
function pendingHumanWindowOf(view: ConversationView): string | null {
  const pending = view.pendingHumanActions?.length ? view.pendingHumanActions : view.pendingHumanAction ? [view.pendingHumanAction] : [];
  // An offered refresh gates nothing: only a REQUIRED step keeps the window gated on the next question.
  if (!pending.some((p) => p.actionType === "REVIEW_IMPORT" && !p.optional)) return null;
  return view.workingSet?.kind === "REVIEWS" ? view.workingSet.filters.period?.token ?? null : null;
}

/** The working-set line for the planner — closed tokens only, never a count, an id or a customer word. */
export function priorLineOf(view: ConversationView): string | null {
  const set = view.workingSet;
  const parts: string[] = [];
  if (set) {
    parts.push(`직전 작업 집합: ${set.kind} (기간:${set.filters.period?.token ?? "없음"}, 채널:${set.filters.channelCode ?? "전체"}, `
      + `평점:${set.filters.rating ?? "ALL"}, 상태:${set.filters.status ?? "없음"}, 상품 특정:${set.productIds.length > 0 ? "예" : "아니오"})`);
  }
  if (view.pendingPrepared) {
    parts.push(view.pendingPrepared.kind === "REVIEW_DRAFT"
      ? "직전 준비: REVIEW_DRAFT (판매자가 방금 준비된 리뷰 답글 초안을 보고 있습니다)"
      : "직전 준비: INQUIRY_DRAFT (판매자가 방금 준비된 초안을 보고 있습니다)");
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

const PRIMARY_ORDER: readonly Artifact["type"][] = [
  "DRAFT", "APPROVAL", "GUIDED_EXECUTION", "REVIEW_LIST", "INQUIRY_LIST", "PRODUCT_LIST", "ORDER_SUMMARY", "ISSUE_LIST",
  "WORKSPACE_LINK", "CHART", "METRIC", "TABLE", "LIST", "SUMMARY", "CHECKLIST",
];

function primaryOf(artifacts: readonly Artifact[]): Artifact | null {
  for (const type of PRIMARY_ORDER) {
    const found = artifacts.find((a) => a.type === type);
    if (found) return found;
  }
  return null;
}

/** The first sentence, from the primary artifact. Deterministic; never model prose. */
function headlineOf(
  primary: Artifact | null, artifacts: readonly Artifact[], view: ConversationView,
  axis: ReturnType<typeof conversationAxisOf>, answer: OperatorAnswer,
): string {
  switch (primary?.type) {
    case "REVIEW_LIST": {
      const rating = primary.scope.rating === "LOW" ? "낮은 평점 " : "";
      const previous = axis.filters.scope === "WORKING_SET" && view.workingSet?.kind === "REVIEWS" ? view.workingSet : null;
      const token = primary.scope.period?.token ?? null;
      // The same sentence the rows path wrote: the result first, 「지금까지 확인한」 as the bound when some
      // channel is not proven current, never 「0건」 under a stale channel. Which channel and since when is
      // the message's own per-channel sentence and the card's footer — not repeated here.
      const anyStale = previous == null && primary.freshness.some((f) => f.verdict === "UNPROVEN" || f.verdict === "NOT_COLLECTED");
      return rowsSentence(previous?.count ?? null, rating, periodLabel(token), primary.totalCount, anyStale, token);
    }
    case "PRODUCT_LIST":
      return `방금 본 리뷰를 상품 ${primary.items.length}개로 묶었습니다.`;
    case "INQUIRY_LIST": {
      const previousReviews = axis.filters.scope === "WORKING_SET" && view.workingSet?.kind === "REVIEWS";
      if (primary.scope && !(primary.more?.to ?? "").includes("NEEDS_REPLY")) {
        // Query Accuracy v1: a ROWS list is said in the spec's own words — the set it refines, the status
        // it was read with, the count the predicate found, and how many of those are on screen.
        const refine = axis.filters.scope === "WORKING_SET" && view.workingSet?.kind === "INQUIRIES";
        const count = (key: string) => primary.groups.filter((g) => g.key === key).reduce((n, g) => n + g.items.length, 0);
        return inquiryRowsSentence(primary.scope, count("UNANSWERED") + count("ANSWERED"), primary.totalCount, refine,
          { unanswered: count("UNANSWERED"), answered: count("ANSWERED") });
      }
      if (primary.totalCount === 0) {
        return previousReviews ? "같은 상품에 대한 미답변 문의는 없습니다." : `${primary.title}는 없습니다.`;
      }
      const groups = primary.groups.map((g) => `${g.label} ${g.items.length}건`).join(" · ");
      return `${primary.title}가 ${primary.totalCount}건입니다 (${groups}).`;
    }
    case "ORDER_SUMMARY": {
      const t = primary.totals;
      const label = periodLabel(primary.period.token);
      const name = primary.channelCode
        ? (primary.channels[0]?.channelNameKo ?? primary.channelCode) + " " : "";
      const head = `${label} ${name}매출은 ${won(t.sales)}(주문 ${t.orders}건)`;
      if (t.salesDeltaPercent == null) return `${head}입니다.`;
      return `${head}으로 직전 기간보다 ${Math.abs(t.salesDeltaPercent)}% ${t.salesDeltaPercent < 0 ? "줄었습니다" : "늘었습니다"}.`;
    }
    case "ISSUE_LIST":
      return `반복되는 문제 ${primary.items.length}건을 확인했습니다.`;
    case "DRAFT":
      return primary.unavailableMessage ?? (primary.version ? "답변 초안을 준비했습니다." : (primary.answerBasisNote ?? "답변 기준이 필요합니다."));
    case "WORKSPACE_LINK":
      return `${primary.link.label} 화면을 열어 드립니다.`;
    default: {
      const first = answer.findings.find((f) => f.confidence === "SUPPORTED")
        ?? answer.findings.find((f) => f.confidence === "NEEDS_REVIEW");
      return first?.statement ?? answer.note ?? "확인한 내용입니다.";
    }
  }
}

function won(amount: number): string {
  return `${Math.trunc(amount).toLocaleString("ko-KR")}원`;
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function promptChip(label: string): SuggestedAction {
  return { label, kind: "PROMPT", prompt: label };
}

/** The working set the primary artifact leaves behind — ids and closed filters, bounded. */
function workingSetOf(
  artifacts: readonly Artifact[], axis: ReturnType<typeof conversationAxisOf>, view: ConversationView,
): WorkingSetView | null {
  const primary = primaryOf(artifacts.filter((a) => a.type !== "DRAFT" && a.type !== "APPROVAL" && a.type !== "GUIDED_EXECUTION"
    && a.type !== "WORKSPACE_LINK" && a.type !== "SUMMARY"));
  const bounded = (ids: readonly string[]): string[] => ids.slice(0, WORKING_SET_MAX_IDS);
  switch (primary?.type) {
    case "REVIEW_LIST": {
      const productIds = [...new Set(primary.items.map((i) => i.productId).filter((p): p is string => p != null))];
      return {
        kind: "REVIEWS", label: primary.title, count: primary.totalCount,
        ids: bounded(primary.items.map((i) => i.reviewId)),
        filters: {
          period: primary.scope.period, channelCode: primary.scope.channelCode, rating: primary.scope.rating,
          ...(primary.scope.productId ? { productIds: [primary.scope.productId] } : {}),
        },
        productIds: bounded(productIds), workItemIds: [], turnId: "",
      };
    }
    case "INQUIRY_LIST": {
      const items: InquiryItem[] = primary.groups.flatMap((g) => g.items);
      const productIds = [...new Set(items.map((i) => i.productId).filter((p): p is string => p != null))];
      const workItemIds = items.map((i) => i.workItemId).filter((w): w is string => w != null);
      // Query Accuracy v1: a ROWS list is anchored by inquiry ids and remembers the spec it was read
      // with, so the next sentence refines the same read; a WORKLOAD list is anchored by work items.
      const rows = primary.scope != null && !(primary.more?.to ?? "").includes("NEEDS_REPLY");
      return {
        kind: "INQUIRIES", label: primary.title, count: primary.totalCount,
        ids: bounded(rows ? items.map((i) => i.inquiryId) : workItemIds),
        filters: {
          ...(axis.filters.topic ? { topic: axis.filters.topic } : {}),
          ...(primary.scope ? {
            period: primary.scope.period, channelCode: primary.scope.channelCode, status: primary.scope.status,
            order: primary.scope.order,
          } : {}),
          inquiryIntent: rows ? "ROWS" : "WORKLOAD",
        },
        productIds: bounded(productIds), workItemIds: bounded(workItemIds), turnId: "",
      };
    }
    case "PRODUCT_LIST":
      return {
        kind: "PRODUCTS", label: primary.title, count: primary.items.length,
        ids: bounded(primary.items.map((i) => i.productId)), filters: {},
        productIds: bounded(primary.items.map((i) => i.productId)), workItemIds: [], turnId: "",
      };
    case "ORDER_SUMMARY":
      return {
        kind: "ORDERS", label: primary.title, count: primary.totals.orders, ids: [],
        filters: { period: primary.period, channelCode: primary.channelCode }, productIds: [], workItemIds: [], turnId: "",
      };
    case "ISSUE_LIST":
      return {
        kind: "ISSUES", label: primary.title, count: primary.items.length,
        ids: bounded(primary.items.map((i) => i.issueId)), filters: {},
        productIds: bounded([...new Set(primary.items.map((i) => i.productId).filter((p): p is string => p != null))]),
        workItemIds: [], turnId: "",
      };
    default:
      return axis.requestedAction === "NONE" && artifacts.length > 0 ? null : view.workingSet;
  }
}

/** A DraftTarget for a work item the conversation has shown, from the persisted INQUIRY_LIST rows. */
function inquiryFromHistory(view: ConversationView, workItemId: string): InquiryItem | null {
  for (let i = view.turns.length - 1; i >= 0; i -= 1) {
    for (const artifact of view.turns[i]!.artifacts) {
      if (artifact.type !== "INQUIRY_LIST") continue;
      for (const group of artifact.groups) {
        const item = group.items.find((it) => it.workItemId === workItemId);
        if (item) return item;
      }
    }
  }
  return null;
}

function inquiryTargetFromHistory(view: ConversationView, workItemId: string): ResolvedTarget | null {
  const item = inquiryFromHistory(view, workItemId);
  // A row with no work item (an answered inquiry on a ROWS list) has nothing to draft on.
  if (!item || !item.workItemId) return null;
  return {
    kind: "INQUIRY",
    target: {
      workItemId: item.workItemId, inquiryId: item.inquiryId, channelCode: item.channelCode,
      channelNameKo: item.channelNameKo, productId: item.productId, productName: item.productName,
    },
    // Absent on a row from an older backend ⇒ NONE: a channel label is not a marketplace binding.
    executableIdentity: item.executableIdentity ?? "NONE",
    sourceSubtype: item.sourceSubtype ?? null,
  };
}

/** A ReviewItem the conversation has shown, from the persisted REVIEW_LIST rows. */
function reviewFromHistory(view: ConversationView, reviewId: string): ReviewItem | null {
  for (let i = view.turns.length - 1; i >= 0; i -= 1) {
    for (const artifact of view.turns[i]!.artifacts) {
      if (artifact.type !== "REVIEW_LIST") continue;
      const item = artifact.items.find((it) => it.reviewId === reviewId);
      if (item) return item;
    }
  }
  return null;
}

function reviewTargetFromHistory(view: ConversationView, reviewId: string): ResolvedTarget | null {
  const item = reviewFromHistory(view, reviewId);
  if (!item) return null;
  return {
    kind: "REVIEW",
    target: {
      reviewId: item.reviewId, accountId: item.accountId, actionRef: `review:${item.reviewId}`,
      channelCode: item.channelCode, channelNameKo: item.channelNameKo, productId: item.productId, productName: item.productName,
    },
    executableIdentity: item.executableIdentity ?? "NONE",
  };
}

/** 「쿠팡에서는 …」 — the honest sentence for a channel with no seller reply flow; the chips are the next moves. */
function summaryLineFor(channelCode: string | null): string {
  return (channelCode ?? "").toUpperCase() === "COUPANG"
    ? COUPANG_REVIEW_UNSUPPORTED_SENTENCE
    : "이 채널에서는 판매자가 리뷰에 직접 답글을 남기는 기능을 지원하지 않습니다.";
}

function reviewUnsupportedSummary(t: ReviewDraftTarget): SummaryArtifact {
  return {
    artifactId: `a-unsupported-${t.reviewId}`, type: "SUMMARY", title: "리뷰 답글을 보낼 수 없는 채널",
    lines: [summaryLineFor(t.channelCode), "대신 이 리뷰로 무엇을 확인할지 아래에서 고르실 수 있습니다."],
  };
}

function copyOnlySummary(kind: "INQUIRY" | "REVIEW", id: string, to?: string): SummaryArtifact {
  return {
    artifactId: `a-send-${id}`, type: "SUMMARY", title: kind === "INQUIRY" ? "채널로 보낼 수 없는 문의" : "채널로 보낼 수 없는 리뷰",
    lines: [NOT_EXECUTABLE_SENTENCE[kind], COPY_ONLY_SENTENCE],
    ...(to ? { note: to } : {}),
  };
}

function reasonSummary(artifactId: string, title: string, lines: string[]): SummaryArtifact {
  return { artifactId, type: "SUMMARY", title, lines };
}

/** The audited transport's own sentence, or the closed reason said in the seller's words. Never a vendor message. */
export function executionReasonSentence(verdict: ChannelCapabilityVerdict, channelName: string, what: string): string {
  if (verdict.reasonKo) return verdict.reasonKo;
  switch (verdict.reason) {
    case EXECUTION_REASON.EXECUTION_DISABLED:
      return `${channelName} ${what} 전송이 이 배포에서는 아직 켜져 있지 않습니다.`;
    case "PLATFORM_SUPPORTED_NOT_IMPLEMENTED":
      return `${channelName}에는 ${what}을 보낼 수 있는 공식 경로가 있지만 reviewnary가 아직 지원하지 않습니다.`;
    case "UNSUPPORTED":
    case EXECUTION_REASON.CHANNEL_UNSUPPORTED:
      return `${channelName}에서는 이 ${what}을 보낼 방법이 없습니다.`;
    case "GUIDED_ACTION":
      return `${channelName}에서는 판매자님이 직접 등록하는 방식으로만 ${what}을 보낼 수 있습니다.`;
    default:
      return `${channelName} ${what} 전송 가능 여부를 아직 확인하지 못했습니다.`;
  }
}

function evidenceOf(answer: OperatorAnswer): EvidenceArtifact | null {
  if (answer.evidence.length === 0) return null;
  const KIND_LABEL: Record<string, string> = {
    REVIEW_LIST: "기간 내 리뷰", ORDER_SUMMARY: "주문·매출", INQUIRY: "문의", INBOX_COUNT: "미답변 문의",
    REVIEW_ISSUE: "반복 리뷰 문제", ISSUE_EVIDENCE: "리뷰 문제 근거", NEGATIVE_REVIEW: "부정 리뷰",
    CUSTOMER_MEMORY: "과거 사례", REPEATED_INQUIRY: "반복 문의", CHANNEL_COVERAGE: "채널 수집 상태",
    HUMAN_ACTION: "필요한 작업", PRODUCT_FACT: "상품 정보", PRODUCT_LISTING: "채널 등록 정보",
    PRODUCT_VARIANT: "옵션 정보", PRODUCT_KNOWLEDGE_DOC: "판매자가 쓴 글", PRODUCT_SIGNAL: "상품 신호",
  };
  return {
    artifactId: "a-evidence", type: "EVIDENCE", title: "확인한 자료",
    items: answer.evidence.slice(0, EVIDENCE_ITEMS_MAX).map((e) => ({
      label: e.locator.label ?? KIND_LABEL[e.kind] ?? "자료",
      count: e.locator.count ?? null,
      from: e.events?.from ?? null, to: e.events?.to ?? null, asOf: e.asOf,
      covered: e.coverage === "COVERED",
      ...(e.locator.productId ? { link: `/products/${e.locator.productId}` }
        : e.locator.inquiryId ? { link: `/inquiries/${e.locator.inquiryId}` } : {}),
    })),
  };
}

function workspaceFor(plan: InvestigationPlan | null, workingSet: WorkingSetView | null): WorkspaceLinkArtifact {
  const kinds = new Set((plan?.informationNeeds ?? []).map((n) => n.kind));
  // A navigation-only plan names no need; the screen the seller asked for is then the entity kind the
  // planner heard (「문의 화면」 ⇒ INQUIRY), and only after that the working set.
  const mentioned = new Set((plan?.entities.unresolved ?? []).map((e) => e.kind));
  const target = kinds.has("INQUIRY_VOLUME") || kinds.has("CUSTOMER_HISTORY") ? WORKSPACE_OF.INQUIRIES
    : kinds.has("REVIEW_SIGNAL") ? WORKSPACE_OF.REVIEWS
      : kinds.has("ORDER_HISTORY") ? WORKSPACE_OF.ORDERS
        : kinds.has("PRODUCT_FACT") || kinds.has("PRODUCT_LISTING") || kinds.has("PRODUCT_VARIANT") || kinds.has("PRODUCT_KNOWLEDGE_DOC")
          ? WORKSPACE_OF.PRODUCTS
          : mentioned.has("INQUIRY") ? WORKSPACE_OF.INQUIRIES
            : mentioned.has("ORDER") ? WORKSPACE_OF.ORDERS
              : mentioned.has("PRODUCT") ? WORKSPACE_OF.PRODUCTS
                : workingSet ? WORKSPACE_OF[workingSet.kind] : WORKSPACE_OF.INQUIRIES;
  return { artifactId: "a-workspace", type: "WORKSPACE_LINK", title: `${target.label} 화면`, link: { label: target.label, to: target.to } };
}

/** Up to three prompt chips from the set's kind, plus the workspace link. Examples, never capabilities. */
function suggestionsFor(
  primary: Artifact | null, workingSet: WorkingSetView | null, human: HumanActionRequiredArtifact | null,
  artifacts: readonly Artifact[],
): SuggestedAction[] {
  const chips: SuggestedAction[] = [];
  if (human) {
    chips.push({ label: "계속 확인하기", kind: "RESUME" });
    if (human.actionType === "REVIEW_IMPORT" && artifacts.some((a) => a.type === "REVIEW_LIST" && a.items.length > 0)) {
      chips.push({ label: "일단 확인된 리뷰 보기", kind: "LINK", to: "/reviews" });
    }
  }
  if (primary?.type === "DRAFT" && primary.version) {
    chips.push(promptChip("조금 더 부드럽게 써줘"), promptChip("좋아 보내자"));
  } else if (primary?.type === "APPROVAL" || primary?.type === "GUIDED_EXECUTION") {
    // The next move is the artifact's own control; no prompt competes with it.
  } else if (workingSet) {
    switch (workingSet.kind) {
      case "REVIEWS":
        chips.push(promptChip("안 좋은 것만 봐줘"), promptChip("상품별로 묶어줘"), promptChip("문의에서도 같은 문제가 있는지 봐줘"));
        break;
      case "INQUIRIES":
        if (workingSet.filters.inquiryIntent === "ROWS") {
          chips.push(promptChip("답변 안 한 것만 보여줘"), promptChip("그중 가장 최근 1개만"), promptChip("첫 번째 거 답변 준비해줘"));
        } else {
          chips.push(promptChip("배송 관련부터"), promptChip("첫 번째 거 답변 준비해줘"));
        }
        break;
      case "ORDERS":
        chips.push(promptChip("카페24만 봐봐"), promptChip("그때 리뷰나 문의에도 변화 있었어?"));
        break;
      case "PRODUCTS":
        chips.push(promptChip("문의에서도 같은 문제가 있는지 봐줘"));
        break;
      case "ISSUES":
        chips.push(promptChip("어느 상품이 제일 많아?"));
        break;
    }
  }
  const links = chips.slice(0, 3);
  if (workingSet && workingSet.count > 0) {
    const ws = WORKSPACE_OF[workingSet.kind];
    links.push({ label: `전체 ${workingSet.count}건 처리하기`, kind: "LINK", to: ws.to });
  }
  return links;
}

/* ─────────────── R3 / R4 / R6 helpers ─────────────── */

const NUMBER = /\d[\d,]*/g;

/** Same numbers (as a subset) and the same noun ⇒ the finding restates the headline. */
export function redundantWithHeadline(statement: string, headline: string): boolean {
  if (statement.trim() === headline.trim()) return true;
  const nums = statement.match(NUMBER) ?? [];
  if (nums.length === 0) return false;
  const headNums = new Set(headline.match(NUMBER) ?? []);
  if (!nums.every((n) => headNums.has(n))) return false;
  return ["문의", "리뷰", "주문", "매출", "상품"].some((noun) => statement.includes(noun) && headline.includes(noun));
}

/** A PRODUCT_LIST from product-scoped evidence refs, first appearance first — or from one resolved entity. */
export function productListOf(answer: OperatorAnswer, entities: readonly { kind: string; id: string; label: string }[]): Artifact | null {
  const rows = new Map<string, { name: string; facts: Map<string, number> }>();
  for (const ref of answer.evidence) {
    const productId = ref.locator.productId;
    if (!productId) continue;
    const row = rows.get(productId) ?? { name: ref.locator.productName ?? "(이름 없는 상품)", facts: new Map() };
    if (ref.locator.productName && row.name === "(이름 없는 상품)") row.name = ref.locator.productName;
    if (ref.locator.count != null) {
      const label = FACT_LABEL[ref.kind] ?? ref.locator.label ?? "근거";
      row.facts.set(label, Math.max(row.facts.get(label) ?? 0, ref.locator.count));
    }
    rows.set(productId, row);
  }
  if (rows.size === 0) {
    const product = entities.filter((e) => e.kind === "PRODUCT");
    if (product.length !== 1) return null;
    rows.set(product[0]!.id, { name: product[0]!.label, facts: new Map() });
  }
  return {
    artifactId: "a-products", type: "PRODUCT_LIST", title: "이 답변이 가리키는 상품",
    items: [...rows.entries()].map(([productId, row]) => ({
      productId, productName: row.name,
      facts: [...row.facts.entries()].map(([label, count]) => ({ label, count })),
      to: `/products/${productId}`,
    })),
  };
}

const FACT_LABEL: Partial<Record<string, string>> = {
  ISSUE_EVIDENCE: "리뷰 문제 근거", NEGATIVE_REVIEW: "부정 리뷰", REVIEW_ISSUE: "반복 리뷰 문제",
  INQUIRY: "미답변 문의", PRODUCT_SIGNAL: "신호", REVIEW_LIST: "리뷰", CUSTOMER_MEMORY: "과거 사례",
};

/** The seller's to-do list, from what this turn showed and what the conversation is waiting on. */
export function checklistOf(artifacts: readonly Artifact[], view: ConversationView): Extract<Artifact, { type: "CHECKLIST" }> {
  const items: { label: string; detail?: string; to?: string }[] = [];
  const seenHuman = new Set<string>();
  for (const a of artifacts) {
    if (a.type !== "HUMAN_ACTION_REQUIRED") continue;
    const key = `${a.actionType}:${a.channelCode ?? ""}`;
    if (seenHuman.has(key)) continue;
    seenHuman.add(key);
    items.push(humanItem(a.actionType, a.channelNameKo ?? a.channelCode, a.to));
  }
  for (const pending of pendingActionsOf(view)) {
    if (seenHuman.has(`${pending.actionType}:${pending.channelCode ?? ""}`)) continue;
    seenHuman.add(`${pending.actionType}:${pending.channelCode ?? ""}`);
    items.push(humanItem(pending.actionType, pending.channelCode, null));
  }
  for (const a of artifacts) {
    if (a.type === "INQUIRY_LIST") {
      const ready = a.groups.find((g) => g.key === "DRAFT_READY")?.items.length ?? 0;
      const open = a.groups.find((g) => g.key === "UNANSWERED")?.items.length ?? 0;
      if (ready > 0) items.push({ label: `초안 준비된 문의 ${ready}건 확인하고 보내기`, to: "/inquiries?state=NEEDS_REPLY" });
      if (open > 0) items.push({ label: `답변이 필요한 문의 ${open}건`, to: "/inquiries?state=NEEDS_REPLY" });
    }
    if (a.type === "REVIEW_LIST") {
      const negative = a.items.filter((i) => i.negative).length;
      if (negative > 0) items.push({ label: `낮은 평점 리뷰 ${negative}건 확인`, to: "/reviews" });
    }
    if (a.type === "ORDER_SUMMARY" && a.totals.salesDeltaPercent != null) {
      items.push({ label: `매출 변화 확인 (${a.totals.salesDeltaPercent > 0 ? "+" : ""}${a.totals.salesDeltaPercent}%)`, to: a.to });
    }
  }
  return { artifactId: "a-checklist", type: "CHECKLIST", title: "지금 하실 일", items };
}

function humanItem(actionType: string, channel: string | null, to: string | null): { label: string; to?: string } {
  const label = actionType === "REVIEW_IMPORT" ? `${channel ?? "채널"} 리뷰 가져오기`
    : actionType === "KNOWLEDGE_ENTRY" ? "답변 기준 등록하기"
      : actionType === "CHANNEL_CONNECT" ? `${channel ?? "채널"} 연결하기` : "규격 확인하기";
  return { label, ...(to ? { to } : {}) };
}

/** Type-level use so an unused-import lint never removes the draft artifact shape from this file's vocabulary. */
export type { DraftArtifact as ConversationDraftArtifact };
