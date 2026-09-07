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
import { INTERNAL_TOKEN, SOURCE_LABEL, clarificationKindOf, clarificationSentence, isSellerSafeLabel } from "../operator/wording/sellerWording";
import type { ConversationRunContext } from "../operator/state/OperatorState";
import type { OperatorRunResult } from "../operator/operatorRuntime";
import type { InvestigationPlan } from "../operator/plan/InvestigationPlan";
import { conversationAxisOf } from "../operator/plan/InvestigationPlan";
import type { PlanFilters } from "../operator/plan/InvestigationPlan";
import { subjectTermOf } from "./subjectTerm";
import { isAcquisitionRequest } from "./acquisitionRequest";
import { namesEveryProduct } from "./productFocus";
import { acquisitionArtifacts, acquisitionPlanFor } from "./acquisitionStep";
import { REFRESH_FAILURE_LABEL } from "../operator/graph/reviewRefresh";
import { answerFreshnessQuestion, freshnessQuestionOf } from "./freshnessQuestion";
import { channelInSentence } from "./channelFocus";
import { acquisitionMeaning, acquisitionResultOf } from "./acquisitionSummary";
import { channelFocusOf } from "./channelFocus";
import { isReferenceOnly } from "./reference";
import { OPERATOR_TOOL, buildOperatorTools } from "../operator/tools/OperatorTools";
import { OperatorToolRegistry } from "../operator/tools/OperatorToolRegistry";
import type { CapabilityAspect, ChannelActionFacts, SelfKnowledgeInputs } from "../operator/capability/ProductSelfKnowledge";
import {
  afterConnectAnswer, channelActionAnswer, channelActionFacts, channelOffers, howToConnectAnswer,
  fallbackAspect, overviewAnswer, shortenRepeat, supportedChannelsAnswer,
} from "../operator/capability/ProductSelfKnowledge";
import { productFactSheet } from "../operator/capability/ProductFactSheet";
import { CONNECT_ACTION } from "../operator/capability/AssistantCapability";
import { envelopeOf, envelopeTokens, envelopeTurnLines } from "./ContextEnvelope";
import type { ContextEnvelope } from "./ContextEnvelope";
import { checkGroundedAnswer } from "./groundedAnswer";
import { UNKNOWN_WORLD, worldStateOf, worldTokenFor } from "../operator/state/WorldState";
import type { WorldState } from "../operator/state/WorldState";
import {
  CONNECT_STEP, absenceSentence, honestZero, inquiryDraftPrecondition, nextStepFor, objectRefusalSentence,
  operationalPrecondition, reviewDraftPrecondition,
} from "../operator/procedure/Procedure";
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
import { buildTurnGraph } from "./graph/turnGraph";
import type { TurnGraphUpdate, TurnRoute } from "./graph/TurnState";
import { selectProcedure } from "../aop/router";
import { inquiryAnswerStep } from "../aop/answerStep";
import { ProcedureRuntime } from "../aop/ProcedureRuntime";
import type { ProcedureOps } from "../aop/ProcedureRuntime";
import type { ProcedureState, ProcedureUpdate } from "../aop/ProcedureState";
import type { AopCheckpointStore } from "../aop/AopCheckpointStore";
import { procedureIntentOf, requestedActionFor } from "./procedureIntent";
import type { ProcedureIntent } from "./procedureIntent";
import type { Precondition, ProcedureId } from "../operator/procedure/Procedure";
import { inquiryRowsSentence } from "../operator/graph/inquiryRowsStep";
import { urgencySentence } from "../operator/graph/inquiryWorkloadStep";
import type { ConversationStore } from "./ConversationStore";
import { DraftPreparer } from "./DraftPreparer";
import type { DraftTarget, ReviewDraftTarget } from "./DraftPreparer";
import { replyApprovalStateOf } from "./replyApproval";
import { ACTIONABILITY_SENTENCE, actionabilityOf } from "./inquiryActionability";
import type { InquiryActionability } from "./inquiryActionability";
import { ordinalSelectionOf, toneIntentOf } from "./styleIntent";
import {
  CAPTURE_SENTENCE, captureGapOf, classifySellerAnswer, fingerprintOf, judgeCandidate, normalizeContent, orgTopicOf,
  questionFor, settingsPathFor, titleOf, variantFromAnswer,
} from "./knowledgeCapture";
import type { ExistingKnowledge, OpenedGap } from "./knowledgeCapture";
import { KnowledgeCaptureWriter } from "./KnowledgeCaptureWriter";
import { excerpt } from "../operator/wording/sellerWording";
import { Refresher } from "./Refresher";
import { claimsFor } from "./reviewClaim";
import { boundedTurns, STAGE_LABEL, WORKING_SET_MAX_IDS } from "./contract";
import type {
  AcquisitionResultArtifact, ActiveTask, ApprovalArtifact, ApprovalRequiredArtifact, Artifact, ConversationSummary, ConversationView, DraftArtifact, EvidenceArtifact,
  ExecutableIdentity, GuidedExecutionArtifact, HumanActionRequiredArtifact, InquiryDetailArtifact, InquiryItem, ReviewDetailArtifact,
  InquiryListArtifact,
  PendingHumanAction,
  PendingPreparedAction, ProgressEvent, ProgressStage, ReviewItem, SelectedInquiry, SelectedObject, StartTurnRequest, SuggestedAction,
  SummaryArtifact, ToneHint, TurnStatus, TurnView, WorkingSetKind, WorkingSetView, WorkspaceLinkArtifact, ObjectKind,
  KnowledgeCaptureArtifact, PendingKnowledgeCapture,
} from "./contract";
import { prepareIntentOf, pronounInspectOf, visibleSelectionOf } from "./visibleSelection";
import { TOPIC_LABEL, visibleFilterOf, visiblePriorityOf } from "./taskInterpreter";
import type { VisibleFilter } from "./taskInterpreter";
import { rankByUrgency, URGENCY_CRITERION, URGENCY_LIMIT, waitingDaysOf } from "./urgency";
import { listInquiryWorkload, matchesTerm } from "../operator/tools/inquiryWorkload";
import { adviseOnInquiry } from "./advisory";
import { matchesTopic } from "../operator/tools/inquiryWorkload";
import type { VisibleRow } from "./visibleSelection";
import type { ChannelCoverageRow, GeneratedDraftView, ReviewDetailResponse } from "../spring/types";
import { issueSentence, reviewLine } from "../operator/graph/reviewDetail";
import type { ReviewReplyCapability } from "../operator/graph/reviewDetail";
import { periodLabel } from "./period";

export interface ConversationServiceDeps {
  readonly storeProvider: RunStoreProvider;
  readonly clientFactory: SpringClientFactory;
  /** Injectable clock so a turn's timestamps are deterministic in tests. */
  readonly now?: () => Date;
  /**
   * An explicit override for where a stopped procedure's cursor is kept.
   *
   * <b>Absent is the ordinary case, and it is not "in memory" any more</b> (Agent Runtime Production
   * Closure v1 §1): the cursor is resolved per request from {@link RunStoreProvider}, exactly like the
   * conversation and the three run stores, so a deployed host keeps it on the backend row that has a
   * version and a real claim. This override exists for suites that want one store they can inspect.
   */
  readonly procedureCheckpoints?: AopCheckpointStore;
}

type ProgressFn = (e: ProgressEvent) => void;

/** How much of the answer's evidence the EVIDENCE artifact shows. */
const EVIDENCE_ITEMS_MAX = 20;
/**
 * How many SUPPORTED finding sentences follow the headline.
 *
 * <b>Two, not four (Conversation UX v2 §D).</b> A turn is an answer, its one limit, and the next move;
 * a fourth supporting sentence is always something the artifacts under it already show. PO QA read the
 * old shape as 「시스템 상태 설명이 대화보다 앞선다」 — the fix is a cap, not another per-sentence filter.
 */
const FINDINGS_MAX = 2;
/** 「이 두 문의」 — at most this many drafts from one sentence. */
const ALL_TARGETS_MAX = 2;
/** Detail READs one deterministic FILTER may spend on topic matching (the workload lane's own cap). */
const FILTER_DETAIL_CAP = 8;

/**
 * Where a seller goes to finish ONE review's reply — the review alone, because that is all a
 * conversation holds. The account is resolved by the screen from the same org-scoped exact read the
 * review anchor already stands on, rather than being carried here as a second identifier.
 *
 * `from=chat` is not state: it only tells that screen it may offer a way back to this conversation,
 * which is the thread the pointer at `/` already restores. Before this, every review action artifact
 * linked to the bare `/reviews` — the channel's whole record, 4,455 rows on the live account, with the
 * approve button six screens down and no way to say which row was meant.
 */
export function reviewReplyTaskLink(reviewId: string): string {
  return `/reviews/reply/${encodeURIComponent(reviewId)}?from=chat`;
}

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

/** The inquiry a sentence pointed at — by inquiry id; whether a draft can attach to it is a separate fact. */
interface SelectedInquiryRow extends SelectedInquiry {
  readonly channelNameKo: string | null;
  readonly productName: string | null;
  readonly title: string | null;
  readonly status: string;
  readonly receivedAt: string | null;
  /** transient — the bounded opening of the customer's message the row was drawn with, when it had one. */
  readonly snippet?: string | null;
}

type ResolvedTarget =
  | {
    readonly kind: "INQUIRY";
    readonly inquiry: SelectedInquiryRow;
    readonly actionability: InquiryActionability;
    /** Present only when the row is DRAFTABLE — the product's draft path needs the work item. */
    readonly target: DraftTarget | null;
    readonly executableIdentity: ExecutableIdentity;
    readonly sourceSubtype: string | null;
  }
  | { readonly kind: "REVIEW"; readonly target: ReviewDraftTarget; readonly executableIdentity: ExecutableIdentity };

interface Composed {
  status: TurnStatus; message: string; artifacts: Artifact[]; suggestedActions: SuggestedAction[];
  /** The run's limits, said apart from the answer (contract `TurnView.notes`). */
  notes?: string[];
  workingSet: WorkingSetView | null; pendingHumanActions: PendingHumanAction[];
  pendingPrepared: PendingPreparedAction | null; failureCode?: string; failureReason?: string;
  budget?: TurnView["budget"]; answer?: OperatorAnswer;
  /** Knowledge Capture v1: the gap to hold open after this turn; `undefined` = carry the thread's as it is. */
  pendingCapture?: PendingKnowledgeCapture | null;
  /** Agent Interaction Model v2 §1-C: the task this turn leaves in flight; `undefined` = derive/carry. */
  activeTask?: ActiveTask | null;
}

/** What a resumed turn says first when it follows a saved capture (Knowledge Capture v1, GOAL resume). */
interface AfterCapture { readonly message: string; readonly artifact: KnowledgeCaptureArtifact }

/** What the thread says where a stopped turn would have answered. Never a claim about what was found. */
export const CANCELLED_MESSAGE = "요청을 중지했습니다. 이미 시작된 확인은 되돌리지 않습니다.";

/**
 * <b>One turn's collaborators and its scratch space — the locals of the method the graph replaced.</b>
 *
 * LangGraph Orchestration Migration v1 §2. Every field below was a `const` or a `let` in a 290-line
 * `turnNow`, and the order in which they were assigned WAS the orchestration. The graph decides when
 * each phase runs; this object is what the phases hand each other.
 *
 * <b>It is never checkpointed.</b> It travels in `config.configurable`, which LangGraph does not
 * serialise — a checkpoint that could hold a bearer token would be a checkpoint that leaks one, and
 * §5 keeps facts in the database rather than in an execution cursor.
 */
interface TurnCtx {
  readonly token: string;
  readonly id: string;
  readonly request: StartTurnRequest;
  readonly progress: ProgressFn;
  readonly options: { signal?: AbortSignal; afterCapture?: AfterCapture };
  readonly started: number;
  /* filled by hydrate */
  bundle?: SpringClientBundle;
  store?: ConversationStore;
  /** This request's cursor store — token-bound in production, like every other durable store. */
  cursors?: AopCheckpointStore;
  orgId?: string;
  view?: ConversationView;
  world?: () => Promise<WorldState>;
  stage?: (s: ProgressStage, label: string) => void;
  /* filled by resume / direct */
  text: string;
  hints: StartTurnRequest;
  resumedFrom?: string;
  collected?: ConversationRunContext["collected"];
  receipts: AcquisitionResultArtifact[];
  prefix: string;
  remaining: PendingHumanAction[];
  partialChips: SuggestedAction[];
  userTurn?: TurnView;
  /* filled by operator / procedure */
  result?: OperatorRunResult;
  turnWorld?: WorldState;
  procedure?: { id: ProcedureId | null; version: string | null; precondition: Precondition };
  /** What this sentence asks of the object on the table — a closed token, decided once. */
  intent?: ProcedureIntent;
  /** The object a procedure loaded, kept for its later steps. Never checkpointed. */
  target?: ResolvedTarget | null;
  /** What a procedure produced. The pre-plan lanes end the turn with it. */
  composed?: Composed | null;
  /** The turn this run produced. The graph ends when it exists. */
  out: TurnView | null;
}

export class ConversationService {
  constructor(private readonly deps: ConversationServiceDeps) {}

  private now(): string {
    return (this.deps.now ?? (() => new Date()))().toISOString();
  }

  /** Resolve the tenant exactly the way runs do: verify the bearer at the backend, scope the store. */
  private async tenant(token: string): Promise<{
    bundle: SpringClientBundle; store: ConversationStore; cursors: AopCheckpointStore; orgId: string;
  }> {
    const bundle = this.deps.clientFactory(token);
    const { orgId } = await bundle.identity.whoami();
    const stores = this.deps.storeProvider.storesForRequest({ token, scope: scopeFor(orgId) });
    return {
      bundle, store: stores.conversations, orgId,
      cursors: this.deps.procedureCheckpoints ?? stores.procedureCursors,
    };
  }

  /**
   * The turn graph, compiled once.
   *
   * No checkpointer is attached in-process: this product's durable turn state is the CONVERSATION —
   * transcript, working set, pending human actions, pending capture — and {@link ConversationStore}
   * has owned it since before this migration. A second durable store for the same facts is the
   * disagreement §5 exists to prevent. The graph's own state is the execution cursor for one turn, and
   * a turn does not outlive the request that started it; what outlives it is the conversation, and a
   * resume re-enters through `resumeOfTurnId` against the store's record.
   */
  /**
   * The AOP runtime — the six definitions, compiled once, with the durable cursor store behind them.
   *
   * <b>The cursor is not the truth.</b> It carries conversation id, procedure id + version, the step
   * it stopped at, object refs, the draft version and the approval id — and the backend keeps every
   * one of the facts those point at. The in-memory store is the default because a chat turn does not
   * outlive its request; a deployment that wants a stopped procedure to survive a restart passes the
   * file store, and {@code AopCheckpointStore} is the seam either way.
   */
  private proceduresMemo: ProcedureRuntime<TurnCtx> | null = null;

  private get procedures(): ProcedureRuntime<TurnCtx> {
    this.proceduresMemo ??= new ProcedureRuntime<TurnCtx>(this.procedureOps());
    return this.proceduresMemo;
  }

  private turnGraphMemo: ReturnType<typeof buildTurnGraph> | null = null;

  private get turnGraph(): ReturnType<typeof buildTurnGraph> {
    this.turnGraphMemo ??= buildTurnGraph({
    hydrate: (ctx) => this.phaseHydrate(ctx as unknown as TurnCtx),
    route: (ctx) => this.phaseRoute(ctx as unknown as TurnCtx),
    click: (ctx) => this.phaseClick(ctx as unknown as TurnCtx),
    captureDecision: (ctx) => this.phaseCaptureDecision(ctx as unknown as TurnCtx),
    resume: (ctx) => this.phaseResume(ctx as unknown as TurnCtx),
    direct: (ctx) => this.phaseDirect(ctx as unknown as TurnCtx),
    operator: (ctx) => this.phaseOperator(ctx as unknown as TurnCtx),
    procedure: (ctx) => this.phaseProcedure(ctx as unknown as TurnCtx),
      compose: (ctx) => this.phaseCompose(ctx as unknown as TurnCtx),
      persist: (ctx) => this.phasePersist(ctx as unknown as TurnCtx),
    });
    return this.turnGraphMemo;
  }

  async create(token: string): Promise<ConversationView> {
    const { store, orgId } = await this.tenant(token);
    const at = this.now();
    const view: ConversationView = {
      conversationId: randomUUID(), orgId, createdAt: at, updatedAt: at, turns: [],
      workingSet: null, pendingHumanAction: null, pendingHumanActions: [], pendingPrepared: null,
    };
    await store.save(view);
    log("conversation_started", {});
    return view;
  }

  /**
   * Defense in depth over the per-org store scoping (Agent Interaction Model v2 §0): a record that
   * carries a tenant stamp must carry the CALLER's. A mismatch is indistinguishable from "not found" —
   * never a render, never a message that confirms the record exists. Records written before the stamp
   * existed rely on the store scoping alone.
   */
  private assertTenant(view: ConversationView, orgId: string): ConversationView {
    if (view.orgId && view.orgId !== orgId) {
      log("conversation_tenant_mismatch", {});
      throw new HttpError(404, "UNKNOWN_CONVERSATION", "no conversation found for this id");
    }
    return view;
  }

  async get(token: string, id: string): Promise<ConversationView> {
    const { store, orgId } = await this.tenant(token);
    const view = await store.load(id);
    if (!view) throw new HttpError(404, "UNKNOWN_CONVERSATION", "no conversation found for this id");
    return this.assertTenant(view, orgId);
  }

  async list(token: string, limit: number): Promise<ConversationSummary[]> {
    const { store } = await this.tenant(token);
    return store.list(Math.max(1, Math.min(limit, 50)));
  }

  /**
   * Turns on ONE conversation run one at a time. A stopped turn still finishes its bounded step after the
   * seller's composer is free again; the next sentence must land AFTER it, or two whole-view saves race
   * and the later one silently drops the earlier turns (observed live 2026-08-29 — the stop record vanished).
   */
  private readonly lanes = new Map<string, Promise<unknown>>();

  async turn(token: string, id: string, request: StartTurnRequest, progress: ProgressFn, options: { signal?: AbortSignal } = {}): Promise<TurnView> {
    const previous = this.lanes.get(id) ?? Promise.resolve();
    const mine = previous.catch(() => undefined).then(() => this.turnNow(token, id, request, progress, options));
    this.lanes.set(id, mine);
    try {
      return await mine;
    } finally {
      if (this.lanes.get(id) === mine) this.lanes.delete(id);
    }
  }

  /**
   * <b>One turn's collaborators and its scratch space.</b>
   *
   * LangGraph Orchestration Migration v1 §2. These were the locals of a 290-line method, and the order
   * in which they were assigned was the orchestration. They are now a context the graph's phases share:
   * the graph decides WHEN each phase runs, this object is WHAT they pass each other.
   *
   * <b>It is never checkpointed.</b> It travels in `config.configurable`, which LangGraph does not
   * serialise — a checkpoint holding a bearer token or a customer's sentence is the thing §5 forbids.
   */
  private async turnNow(
    token: string, id: string, request: StartTurnRequest, progress: ProgressFn,
    options: { signal?: AbortSignal; afterCapture?: AfterCapture } = {},
  ): Promise<TurnView> {
    const ctx: TurnCtx = {
      token, id, request, progress, options, started: Date.now(),
      text: "", hints: request, receipts: [], prefix: "", remaining: [], partialChips: [], out: null,
    } as TurnCtx;
    // The graph owns the turn: which phase runs next, where it stops, what a resume continues.
    await this.turnGraph.invoke({ conversationId: id }, {
      configurable: { ctx, thread_id: `conv-${id}` },
      recursionLimit: 24,
    } as never);
    if (!ctx.out) throw new HttpError(500, "TURN_PRODUCED_NOTHING", "the turn graph ended without a turn");
    return ctx.out;
  }

  /**
   * Which object this conversation is standing on, as the closed token routing takes.
   *
   * <b>`focusInquiryOf` decides it, not the presence of a `selectedInquiry`.</b> A one-row set has
   * exactly one referent and has counted as the focus since Conversation Contract Correctness v2 §E;
   * asking a narrower question here would send 「이 고객한테 뭐라고 답해야 해?」 to the planner, which is
   * the defect that section closed.
   */
  private anchorKindOf(view: ConversationView): "INQUIRY" | "REVIEW" | null {
    if (view.workingSet?.selectedObject?.kind === "REVIEW") return "REVIEW";
    return focusInquiryOf(pickSet(null, view)) || view.pendingPrepared ? "INQUIRY" : null;
  }

  /** hydrate — the tenant, the conversation, and this turn's world (one coverage read, memoised). */
  private async phaseHydrate(ctx: TurnCtx): Promise<TurnGraphUpdate> {
    const { token, id } = ctx;
    const { bundle, store, cursors, orgId } = await this.tenant(token);
    const loaded = await store.load(id);
    if (!loaded) throw new HttpError(404, "UNKNOWN_CONVERSATION", "no conversation found for this id");
    const view = this.assertTenant(loaded, orgId);
    ctx.bundle = bundle; ctx.store = store; ctx.cursors = cursors; ctx.orgId = orgId; ctx.view = view;
    /**
     * <b>This turn's world, derived once</b> (Agent Procedure Layer v1 §1). Lazy, because a turn that
     * never asks what this seller can hold — a tone revision, an ordinal — must not buy a read to find
     * out. Every lane that DOES ask shares this one: the planner's state token, the procedure layer's
     * preconditions, the acquisition card's channel row, and the capability answer.
     */
    let worldMemo: WorldState | null = null;
    const world = async (): Promise<WorldState> => {
      if (worldMemo) return worldMemo;
      let coverage: ChannelCoverageRow[] | null = null;
      try {
        coverage = (await bundle.operator.getChannelCoverage?.()) ?? null;
      } catch {
        // A failed read is UNKNOWN, and from UNKNOWN nothing is claimed.
        coverage = null;
      }
      worldMemo = worldStateOf(coverage, { workingSet: view.workingSet, activeTask: view.activeTask ?? null });
      return worldMemo;
    };

    // ── Agent Interaction Model v2 §3/§9: a click on a shown row. The same focus transition as naming
    // the row — persisted with the conversation, appended to the transcript as nothing.
    ctx.world = world;
    ctx.stage = (s: ProgressStage, label: string): void =>
      ctx.progress({ type: "stage", stage: s, label, at: this.now() });
    return {};
  }

  /**
   * route — which shape of turn this is.
   *
   * These were the first four `if`s of the old method and their ORDER was the answer. A press outranks
   * a decision outranks a resume, and only then is there a sentence to read at all.
   */
  private async phaseRoute(ctx: TurnCtx): Promise<TurnRoute> {
    if (ctx.request.select) return "CLICK";
    if (ctx.request.captureDecision) return "CAPTURE_DECISION";
    if (ctx.request.resumeOfTurnId) return "RESUME";
    // ── Does a business procedure claim this turn? (AOP Execution Closure v1)
    //
    // The sentence is read HERE, once, into a closed token; the router downstream sees only tokens.
    // These were the first branches of the direct lane, and being branches is what made them
    // invisible: nothing could say which business procedure a turn had run.
    const view = ctx.view!;
    const text = ctx.text || (ctx.request.text ?? "");
    ctx.text = text;
    // The seller's sentence becomes a turn HERE, before either lane runs, because that is where the
    // old method created it and where `UNDERSTANDING` was reported. A click and a capture decision
    // returned above: neither of them is a sentence.
    this.ensureUserTurn(ctx);
    const intent = procedureIntentOf(view, text);
    ctx.intent = intent;
    if (intent !== "NONE") {
      const claimed = selectProcedure({
        readiness: "WORKING", anchor: this.anchorKindOf(view),
        requestedAction: requestedActionFor(intent),
        needKinds: [], pendingCapture: Boolean(view.pendingCapture),
      });
      if (claimed) return "PROCEDURE";
    }
    // A resumed turn never re-enters the deterministic lanes; everything else asks them first.
    return "DIRECT";
  }

  private async phaseClick(ctx: TurnCtx): Promise<TurnGraphUpdate> {
    const { view, request, bundle, store, started } = ctx;
    ctx.out = await this.applyClickSelection(view!, request.select!, bundle!, store!, started);
    return { turnId: ctx.out.turnId };
  }

  private async phaseCaptureDecision(ctx: TurnCtx): Promise<TurnGraphUpdate> {
    const { token, id, view, request, bundle, store, progress, options, started } = ctx;
    ctx.out = await this.decideCapture(
      token, id, view!, request.captureDecision!, bundle!, store!, progress, options.signal, started);
    return { turnId: ctx.out.turnId };
  }

  /**
   * resume — «the human step is done», checked against each step's own record.
   *
   * No model call and no tool call beyond those reads. When something is still waiting this is the
   * turn; when everything is done the original request runs again with what was collected.
   */
  private async phaseResume(ctx: TurnCtx): Promise<{ done: boolean; update: TurnGraphUpdate }> {
    const view = ctx.view!;
    const request = ctx.request;
    const options = ctx.options;
    const bundle = ctx.bundle!;
    const store = ctx.store!;
    let finished = false;
    let text = request.text ?? "";
    let hints: StartTurnRequest = request;
    let resumedFrom: string | undefined;
    let collected: ConversationRunContext["collected"] = undefined;
    // What each finished acquisition DID, as an object rather than a paragraph (Outcome Artifact v1 §1).
    let receipts: AcquisitionResultArtifact[] = [];
    let prefix = "";
    let remaining: PendingHumanAction[] = [];
    let partialChips: SuggestedAction[] = [];
    if (options.afterCapture) prefix = `${options.afterCapture.message} `;
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
          await this.persist(store, view, [again], view.workingSet, mine, view.pendingPrepared, view.pendingCapture ?? null);
          // Still waiting on a person: this IS the turn, and the graph ends here.
          ctx.out = again;
          finished = true;
        }
        if (!finished) {
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
            // <b>What the run DID, from the record it wrote.</b> The card that drove it knows the run's id and
            // nothing it may assert; the backend answers the window and the three tallies (§3). A run that is
            // not a guided acquisition, or a read that fails, falls back to the sentence that was always true.
            receipts = (await Promise.all(done.map(async (c) => {
              if (!c.check.runId) return null;
              const result = await bundle.inquiry.reviewAcquisitionResult(c.check.runId).catch(() => null);
              return result ? acquisitionResultOf(c.pending.channelCode ?? "", nameOf(c.pending), result) : null;
            }))).filter((a): a is AcquisitionResultArtifact => a != null);
            // The prose says what it MEANS; the card beside it says the window and the tallies (§1).
            const meaning = acquisitionMeaning(receipts);
            prefix = meaning
              ? `${meaning} 이어서 확인하겠습니다. `
              : anyPartial
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
    }
    ctx.text = text; ctx.hints = hints; ctx.collected = collected; ctx.receipts = receipts;
    ctx.prefix = prefix; ctx.remaining = remaining; ctx.partialChips = partialChips;
    if (resumedFrom) ctx.resumedFrom = resumedFrom;
    return { done: finished, update: {} };
  }

  /**
   * The seller's own sentence, as a turn — created once, before either lane runs.
   *
   * It sat inside the old method between the resume block and the direct lane, which is exactly where
   * both paths passed through. The graph gives them separate nodes, so the shared step is named.
   */
  private ensureUserTurn(ctx: TurnCtx): TurnView {
    if (ctx.userTurn) return ctx.userTurn;
    const view = ctx.view!;
    const { id, progress } = ctx;
    const text = ctx.text;
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
    // ── Closed intents about the object already on the table are resolved here, with no planner call and
    // no read (Conversation Object Integrity v1): a tone revision of the draft being viewed, or a bare
    // ordinal over the list just shown. Anything else is the planner's.
    ctx.userTurn = userTurn;
    return userTurn;
  }

  /** direct — the closed intents about the object already on the table. No planner call, no read. */
  private async phaseDirect(ctx: TurnCtx): Promise<{ handled: boolean; update: TurnGraphUpdate }> {
    const view = ctx.view!;
    const bundle = ctx.bundle!;
    const store = ctx.store!;
    const { id, started, progress } = ctx;
    const text = ctx.text || (ctx.request.text ?? "");
    ctx.text = text;
    const hints = ctx.hints;
    const resumedFrom = ctx.resumedFrom;
    const world = ctx.world!;
    const stage = ctx.stage!;
    const userTurn = this.ensureUserTurn(ctx);
    const direct = resumedFrom ? null : await this.directLane(view, text, hints, bundle, stage, world);
    if (direct) {
      const finalTurn = await this.finishDirect(ctx, direct);
      return { handled: true, update: { turnId: finalTurn.turnId } };
    }
    return { handled: false, update: {} };
  }

  /**
   * A deterministic answer, persisted and returned — the tail both the direct lanes and a pre-plan
   * procedure share.
   *
   * It was the body of one `if`; two callers reach it now, so it has a name. Nothing in it changed.
   */
  private async finishDirect(ctx: TurnCtx, direct: Composed): Promise<TurnView> {
    const view = ctx.view!;
    const store = ctx.store!;
    const { started } = ctx;
    const userTurn = this.ensureUserTurn(ctx);
      const agentTurn = this.agentTurn(view, direct);
      const workingSet = direct.workingSet ? { ...direct.workingSet, turnId: agentTurn.turnId } : null;
      const pendingPrepared = direct.pendingPrepared ? { ...direct.pendingPrepared, turnId: agentTurn.turnId } : null;
      const pendingCapture = stampCapture(direct.pendingCapture !== undefined ? direct.pendingCapture : view.pendingCapture ?? null, agentTurn.turnId);
      const activeTask = direct.activeTask !== undefined ? direct.activeTask : view.activeTask ?? null;
      // A deterministic lane may WAIT on the seller (the acquisition step, §1): its pending action is
      // stamped with this turn and persisted like the planner path's, so 「계속 확인하기」 and the run's own
      // completion resume THIS turn. Every other direct lane returns none and nothing changes for it.
      const pendingHumanActions = direct.pendingHumanActions.map((p) => ({ ...p, turnId: agentTurn.turnId }));
      const finalTurn: TurnView = {
        ...agentTurn,
        continuation: {
          workingSet, pendingHumanAction: pendingHumanActions[0] ?? null, pendingHumanActions,
          pendingPrepared, pendingCapture, activeTask,
        },
      };
      await this.persist(store, view, [userTurn, finalTurn], workingSet,
        pendingHumanActions.length > 0 ? [...pendingActionsOf(view), ...pendingHumanActions] : pendingActionsOf(view),
        pendingPrepared, pendingCapture, activeTask);
      log("conversation_turn", {
        status: finalTurn.status, toolCalls: direct.budget?.toolCalls ?? 0, llmCalls: direct.budget?.llmCalls ?? 0, ms: Date.now() - started,
        artifactTypes: [...new Set(finalTurn.artifacts.map((a) => a.type))].join(","),
        workingSetKind: workingSet?.kind ?? "NONE", requestedAction: direct.budget?.stopReason ?? (direct.pendingPrepared ? "TONE_REVISION" : "SELECT"),
      });
      ctx.out = finalTurn;
      return finalTurn;
    // <b>The channel the seller last named, decided once for this turn.</b> Both the graph's read and this
    // service's own axis use it, so the rows and the sentence about them can never be scoped differently.
  }

  /** operator — the planner, the specialists, the tools, the evidence, the judge. */
  private async phaseOperator(ctx: TurnCtx): Promise<TurnGraphUpdate> {
    const view = ctx.view!;
    const bundle = ctx.bundle!;
    const store = ctx.store!;
    const orgId = ctx.orgId!;
    const { id, options, started } = ctx;
    const text = ctx.text;
    const hints = ctx.hints;
    const resumedFrom = ctx.resumedFrom;
    const world = ctx.world!;
    const stage = ctx.stage!;
    const collected = ctx.collected;
    const userTurn = this.ensureUserTurn(ctx);
    const channelFocus = channelFocusOf(view.turns, text);
    // The planner path is the one that needs the world eagerly: its token goes out with the plan
    // request, and every procedure decision after it reads this same value.
    const turnWorld = await world();
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
    // …and the product an anchored inquiry is bound to travels ONLY when the sentence says 「이 상품」
    // (Conversation Object Integrity v1's case). Found live in this package's own QA: sent on every
    // turn, the anchor's product turned 「최근 문의 8개 보여줘」 into a product-scoped read that answered
    // 「이 상품의 근거로는 쓸 수 없습니다」 about a product the sentence never named.
    // …and NOTHING product-scoped travels when the sentence puts the question to the whole catalogue
    // (`conversation/productFocus.ts`). This gate is above both sources for the same reason it exists:
    // 「이 상품은 됐고 전체에서 …」 contains 「이 상품」, so the pointer test below reads it as pointing at
    // the very product the sentence set aside.
    const widened = namesEveryProduct(text);
    const saysThisProduct = !widened && /이 상품/.test(text);
    // A product the seller SELECTED is the object the conversation is standing on — the same statement
    // as a one-product list, made more deliberately, and the context bar shows it with a 「해제」 beside
    // it. A REVIEW anchor's product is a side fact about that review, so it travels under the same rule
    // an anchored inquiry's product does: only when the sentence says 「이 상품」.
    const anchoredObject = set?.selectedObject ?? null;
    const anchoredProduct = widened ? undefined : !hints.productId
      ? anchoredObject?.kind === "PRODUCT" ? anchoredObject.productId ?? undefined
        // A REVIEW anchor's product is a fact ABOUT the review, so it travels only when the sentence
        // names the PRODUCT. Tried and measured the other way in this package: letting 「이 리뷰」 resolve
        // to the review's product turned 「이 리뷰는 어떤 상품 문제야?」 into a product-scoped review read
        // that answered with that product's most recent review — a five-star one. A demonstrative that
        // names one object must not silently become a scope over another.
        : saysThisProduct && anchoredObject?.kind === "REVIEW" && anchoredObject.productId ? anchoredObject.productId
          : set?.kind === "PRODUCTS" && set.ids.length === 1 ? set.ids[0]
            : saysThisProduct && set?.kind === "INQUIRIES" && set.selectedInquiry?.productId ? set.selectedInquiry.productId : undefined
      : undefined;
    const goal: GoalRequest = {
      text,
      ...(!widened && hints.productId ? { productId: hints.productId }
        : anchoredProduct ? { productId: anchoredProduct } : {}),
      ...(hints.workItemId ? { workItemId: hints.workItemId } : {}),
      ...(hints.referenceDate ? { referenceDate: hints.referenceDate } : {}),
      conversation: {
        workingSet: view.workingSet,
        // §1: one closed enum about this seller — the axis the planner had no way to see. Never a
        // channel name, a count or a row; `UNKNOWN` sends nothing.
        ...(worldTokenFor(turnWorld) ? { worldToken: worldTokenFor(turnWorld)! } : {}),
        ...(priorLineOf(view) ? { priorLine: priorLineOf(view)! } : {}),
        ...(collected ? { collected } : {}),
        ...(pendingHumanWindowOf(view) ? { pendingHumanWindow: pendingHumanWindowOf(view) } : {}),
        localAgent: hints.localAgent ?? "UNKNOWN",
        // Channel continuity, decided from the seller's own sentences and applied to the READ.
        ...(channelFocus ? { channelFocus } : {}),
      },
    };
    const result = await runtime.run(`conv-${id}-${userTurn.turnId}`, goal, options.signal ? { signal: options.signal } : {});

    if (options.signal?.aborted) {
      // Bounded cancel (Chat UI v1): the seller stopped the turn. What ran, ran — a read is not undone
      // and a collection already started keeps going — but nothing was composed, nothing is claimed,
      // and the thread records the stop so a reload does not show a half-answer as an answer.
      const stopped = this.agentTurn(view, {
        status: "FAILED", message: CANCELLED_MESSAGE, artifacts: [], suggestedActions: [],
        workingSet: view.workingSet, pendingHumanActions: [], pendingPrepared: view.pendingPrepared,
        failureCode: "CANCELLED", failureReason: CANCELLED_MESSAGE, ...(resumedFrom ? { resumedFrom } : {}),
      });
      await this.persist(store, view, [userTurn, stopped], view.workingSet, pendingActionsOf(view), view.pendingPrepared, view.pendingCapture ?? null);
      log("conversation_turn", { status: "CANCELLED", ms: Date.now() - started });
      ctx.out = stopped;
      return { terminal: "UNKNOWN" as const, turnId: stopped.turnId };
    }

    ctx.result = result;
    ctx.turnWorld = turnWorld;
    return {};
  }

  /**
   * procedure — which business procedure claims this turn, and whether it may run.
   *
   * <b>The one decision this migration actually moved.</b> Selecting a procedure and settling its
   * precondition were taken inside the composer, interleaved with writing sentences; they are now taken
   * by the AOP router — a table over closed tokens — and handed on as a verdict. Same functions, same
   * inputs, one owner. No sentence is written here.
   */
  private async phaseProcedure(ctx: TurnCtx): Promise<TurnGraphUpdate> {
    const view = ctx.view!;
    const prePlan = ctx.result == null;
    const selected = prePlan
      ? selectProcedure({
        readiness: "WORKING", anchor: this.anchorKindOf(view),
        requestedAction: requestedActionFor(ctx.intent ?? "NONE"),
        needKinds: [], pendingCapture: Boolean(view.pendingCapture),
      })
      : this.selectPostPlanProcedure(ctx);
    if (!selected) {
      ctx.procedure = { id: null, version: null, precondition: { ok: true } };
      return { procedureId: null, procedureVersion: null };
    }
    const { state } = await this.procedures.run(selected.id, ctx, {
      conversationId: ctx.id,
      // One thread per conversation and procedure: a stopped ANSWER_INQUIRY and a stopped
      // CAPTURE_KNOWLEDGE on the same conversation are different cursors, and neither resumes the other.
      threadId: `${ctx.id}:${selected.id}`,
      checkpoints: ctx.cursors,
    });
    ctx.procedure = {
      id: selected.id, version: selected.version,
      precondition: ctx.procedure?.precondition ?? { ok: true },
    };
    if (prePlan && ctx.composed) {
      const finalTurn = await this.finishDirect(ctx, ctx.composed);
      return { turnId: finalTurn.turnId, terminal: state.terminal, procedureId: selected.id, procedureVersion: selected.version };
    }
    return {
      procedureId: selected.id, procedureVersion: selected.version,
      ...(state.absence ? { absence: state.absence } : {}),
      // A pre-plan procedure that could not act hands the turn back to the ordinary lanes. The route
      // is NOT rewritten: it records how this turn started, and the graph tells the two visits apart
      // by the trail.
      ...(prePlan ? { terminal: null } : {}),
    };
  }

  /** Which procedure the PLAN's own tokens select, once the operator has run. */
  private selectPostPlanProcedure(ctx: TurnCtx): { id: ProcedureId; version: string } | null {
    const result = ctx.result!;
    const plan = result.status === "DONE" ? result.plan ?? null : null;
    const set = ctx.view!.workingSet;
    const anchor = set?.selectedObject?.kind === "PRODUCT" ? "PRODUCT" as const
      : set?.selectedObject?.kind === "REVIEW" ? "REVIEW" as const
        : set?.selectedInquiry ? "INQUIRY" as const : null;
    const found = selectProcedure({
      readiness: (ctx.turnWorld ?? UNKNOWN_WORLD).readiness.kind,
      anchor,
      requestedAction: plan ? conversationAxisOf(plan).requestedAction : "NONE",
      needKinds: plan ? plan.informationNeeds.map((n) => n.kind) : [],
      pendingCapture: Boolean(ctx.view!.pendingCapture),
    });
    return found ? { id: found.id, version: found.version } : null;
  }

  /** compose — what the run produced, as artifacts, sentences and chips. */
  private async phaseCompose(ctx: TurnCtx): Promise<TurnGraphUpdate> {
    const view = ctx.view!;
    const bundle = ctx.bundle!;
    const store = ctx.store!;
    const { options, started } = ctx;
    const hints = ctx.hints;
    const prefix = ctx.prefix;
    const stage = ctx.stage!;
    const remaining = ctx.remaining;
    const collected = ctx.collected;
    const receipts = ctx.receipts;
    const partialChips = ctx.partialChips;
    const resumedFrom = ctx.resumedFrom;
    const userTurn = ctx.userTurn!;
    const result = ctx.result!;
    const turnWorld = ctx.turnWorld!;
    const composed = await this.compose(view, result, hints, prefix, bundle, stage, remaining, collected ?? [], receipts, turnWorld, ctx.intent ?? "NONE", ctx.text ?? "", options.afterCapture);
    if (options.afterCapture) composed.artifacts = [options.afterCapture.artifact, ...composed.artifacts];
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
    // A gap opened this turn is bound to this turn; one carried over is dropped when the seller moved to
    // another inquiry — a stale question must never file its answer under a different customer's case.
    const pendingCapture = stampCapture(
      composed.pendingCapture !== undefined ? composed.pendingCapture : carriedCapture(view.pendingCapture ?? null, workingSet),
      agentTurn.turnId,
    );
    // Explicit task state (§1-C): what this turn did with the object, or — when the anchor merely
    // carried — what was already in flight. A fresh list clears it with the selection.
    const activeTask: ActiveTask | null = composed.activeTask !== undefined ? composed.activeTask
      : pendingCapture ? "CAPTURE_KNOWLEDGE"
        : composed.artifacts.some((a) => a.type === "APPROVAL_REQUIRED" || a.type === "APPROVAL" || a.type === "GUIDED_EXECUTION") ? "APPROVE_REPLY"
          : pendingPrepared && pendingPrepared !== view.pendingPrepared ? "PREPARE_REPLY"
            : sameAnchor(workingSet, view.workingSet) ? view.activeTask ?? null : null;
    const finalTurn: TurnView = {
      ...agentTurn,
      continuation: {
        workingSet, pendingHumanAction: pendingHumanActions[0] ?? null, pendingHumanActions, pendingPrepared, pendingCapture, activeTask,
      },
    };
    await this.persist(store, view, [userTurn, finalTurn], workingSet, pendingHumanActions, pendingPrepared, pendingCapture, activeTask);
    log("conversation_turn", {
      status: finalTurn.status,
      toolCalls: finalTurn.budget?.toolCalls ?? 0,
      llmCalls: finalTurn.budget?.llmCalls ?? 0,
      ms: Date.now() - started,
      artifactTypes: [...new Set(finalTurn.artifacts.map((a) => a.type))].join(","),
      workingSetKind: workingSet?.kind ?? "NONE",
      requestedAction: result.status === "DONE" ? conversationAxisOf(result.plan ?? emptyPlan()).requestedAction : "NONE",
    });
    ctx.out = finalTurn;
    return { turnId: ctx.out!.turnId, terminal: ctx.out!.status === "WAITING_HUMAN" ? "WAITING_HUMAN" : "ANSWERED" };
  }

  /** persist — the store owns the transcript; the checkpoint owns only where the turn is. */
  private async phasePersist(_ctx: TurnCtx): Promise<TurnGraphUpdate> {
    // The composer already saved: the store write and the turn it returns are one unit, and splitting
    // them would create a window in which the seller has an answer the conversation does not have.
    return {};
  }


  /* ══════════════════════ AOP Runtime — the six procedures' actual execution ══════════════════════
   *
   * AOP Execution Closure v1. Every method below is a STEP of a compiled subgraph, and each one
   * delegates to the code that already owned that step. The transitions between them — which step is
   * next, where the run stops, what a resume continues — belong to the graph, not to this class.
   *
   * <b>Nothing here writes a sentence about a procedure's outcome.</b> `terminal` settles a token;
   * composition stays where it lives.
   */

  /** One coverage read, memoised for the turn — the same one every other lane shares. */
  private async opHydrateWorld(_state: ProcedureState, ctx: TurnCtx): Promise<ProcedureUpdate> {
    const world = await ctx.world!();
    ctx.turnWorld = world;
    return {};
  }

  /**
   * <b>Exact object load.</b> The one inquiry or review this procedure acts on, by id, once.
   *
   * A load that finds nothing does not throw and does not guess: it leaves the run without a terminal,
   * and the graph hands the turn back to the ordinary lanes exactly as the `if` that used to sit here
   * fell through to them.
   */
  private async opLoadObject(state: ProcedureState, ctx: TurnCtx): Promise<ProcedureUpdate> {
    const view = ctx.view!;
    const bundle = ctx.bundle!;
    if (state.procedureId === "ANSWER_REVIEW") {
      const object = view.workingSet?.selectedObject;
      if (object?.kind !== "REVIEW") return {};
      ctx.target = null;
      return { refs: { reviewId: object.id, ...(object.productId ? { productId: object.productId } : {}) } };
    }
    const prepared = view.pendingPrepared;
    if (ctx.intent === "REVISE_TONE" && prepared) {
      return { refs: { workItemId: prepared.workItemId, ...(prepared.draftVersion != null ? { draftVersion: prepared.draftVersion } : {}) } };
    }
    let anchor = focusInquiryOf(pickSet(null, view));
    if (anchor && ctx.hints.workItemId && ctx.hints.workItemId !== anchor.workItemId) anchor = null;
    if (!anchor) return {};
    const resolved = inquiryTargetFromHistory(view, anchor.inquiryId)
      ?? await this.verifiedTarget(anchor.workItemId, bundle);
    if (!resolved || resolved.kind !== "INQUIRY") return {};
    ctx.target = resolved;
    return {
      refs: {
        workItemId: resolved.inquiry.workItemId, inquiryId: resolved.inquiry.inquiryId,
        ...(resolved.inquiry.productId ? { productId: resolved.inquiry.productId } : {}),
      },
    };
  }

  /**
   * The precondition, in the procedure that owns it.
   *
   * These were four separate judgements in the conversation service — the operational gate in two
   * places in the composer, the inquiry gate in the direct lane, the review gate in its own branch.
   * They are one step now, and the run stops here when it fails.
   */
  private async opCheckPrecondition(state: ProcedureState, ctx: TurnCtx): Promise<ProcedureUpdate> {
    const world = ctx.turnWorld ?? await ctx.world!();
    ctx.turnWorld = world;
    if (state.procedureId === "ONBOARD_CHANNEL" || state.procedureId === "DAILY_WORK") {
      const gate = operationalPrecondition(world);
      ctx.procedure = { id: state.procedureId, version: state.version, precondition: gate };
      return gate.ok ? {} : { absence: gate.absence };
    }
    if (state.procedureId === "ANSWER_REVIEW") {
      const object = ctx.view!.workingSet?.selectedObject;
      if (object?.kind !== "REVIEW") return {};
      return {};
    }
    // ANSWER_INQUIRY — the object is in hand, so the world is not asked (holding the row proves the source).
    const target = ctx.target;
    const actionability = target && target.kind === "INQUIRY" ? target.actionability : null;
    if (!target || actionability == null) return {};
    const gate = inquiryDraftPrecondition(actionability, true);
    return gate.ok ? {} : { absence: gate.absence };
  }

  /** The Operator graph already ran for this turn; the procedure records that it did. */
  private async opInvestigate(_state: ProcedureState, _ctx: TurnCtx): Promise<ProcedureUpdate> {
    return {};
  }

  private async opEvidence(_state: ProcedureState, _ctx: TurnCtx): Promise<ProcedureUpdate> {
    return {};
  }

  private async opReadOpportunities(_state: ProcedureState, _ctx: TurnCtx): Promise<ProcedureUpdate> {
    return {};
  }

  /** The production draft path — the same call the inquiry screen makes. */
  private async opPrepare(state: ProcedureState, ctx: TurnCtx): Promise<ProcedureUpdate> {
    const target = ctx.target;
    if (!target || target.kind !== "INQUIRY") return {};
    const composed = await this.directPrepare(ctx.view!, target, ctx.bundle!, ctx.stage!);
    ctx.composed = composed;
    return {
      terminal: "ANSWERED",
      ...(composed.pendingPrepared?.draftVersion != null
        ? { refs: { draftVersion: composed.pendingPrepared.draftVersion } } : {}),
    };
  }

  /** A new version over the SAME evidence. The old version is not touched — the ledger is append-only. */
  private async opRevise(_state: ProcedureState, ctx: TurnCtx): Promise<ProcedureUpdate> {
    const view = ctx.view!;
    const prepared = view.pendingPrepared;
    const tone = toneIntentOf(ctx.text);
    if (!prepared || !tone) return {};
    const composed = await this.reviseTone(view, prepared, tone, ctx.bundle!, ctx.stage!);
    ctx.composed = composed;
    return {
      terminal: "ANSWERED",
      ...(composed.pendingPrepared?.draftVersion != null
        ? { refs: { draftVersion: composed.pendingPrepared.draftVersion } } : {}),
    };
  }

  /**
   * The seller is answering the question this conversation put to them.
   *
   * The write goes through the seller-write seam, bound to the candidate it answers, and the original
   * work is redone exactly once — {@code captureAnswerLane} has owned both since Knowledge Capture v1.
   */
  private async opResume(_state: ProcedureState, ctx: TurnCtx): Promise<ProcedureUpdate> {
    const view = ctx.view!;
    if (!view.pendingCapture) return {};
    const composed = await this.captureAnswerLane(view, view.pendingCapture, ctx.text, ctx.bundle!);
    if (!composed) return {};
    ctx.composed = composed;
    return { terminal: "ANSWERED", refs: { candidateId: view.pendingCapture.captureId } };
  }

  /**
   * Stop and put the question or the step to the seller.
   *
   * <b>A pause, never a permission.</b> Reaching it records a cursor; it approves nothing, and the
   * approval boundary is a different step that reads a different record.
   */
  private async opHumanWait(state: ProcedureState, ctx: TurnCtx): Promise<ProcedureUpdate> {
    if (state.procedureId !== "CAPTURE_KNOWLEDGE") return {};
    // The question is already standing on the conversation; this run adds nothing and waits.
    ctx.composed = null;
    return { terminal: "WAITING_HUMAN", interrupt: "KNOWLEDGE_ANSWER" };
  }

  /** The approval boundary is unchanged: it is validated against its own record, by its own owner. */
  private async opValidateApproval(_state: ProcedureState, _ctx: TurnCtx): Promise<ProcedureUpdate> {
    return {};
  }

  /** The side effect, once, behind the existing single-use fence. Not reachable from a chat turn. */
  private async opExecute(_state: ProcedureState, _ctx: TurnCtx): Promise<ProcedureUpdate> {
    return {};
  }

  /**
   * How the run ended — a token, never a sentence.
   *
   * The one place that decides whether this procedure earned its absence claim. For ANSWER_INQUIRY it
   * is also where an ADVICE request over a non-draftable object becomes the advisory: the DECISION
   * («draftable ⇒ the draft is the advice») is the procedure's, and the advisory itself is composed by
   * the function that has always composed it.
   */
  private async opTerminal(state: ProcedureState, ctx: TurnCtx): Promise<ProcedureUpdate> {
    if (state.terminal) return {};
    // ONBOARD_CHANNEL only runs when nothing is connected, so its precondition cannot pass and
    // `BLOCKED_BY_PRECONDITION` is the only terminal it declares. DAILY_WORK can go either way.
    if (state.procedureId === "ONBOARD_CHANNEL") return { terminal: "BLOCKED_BY_PRECONDITION" };
    if (state.procedureId === "DAILY_WORK") {
      return { terminal: state.absence ? "BLOCKED_BY_PRECONDITION" : "ANSWERED" };
    }
    if (state.procedureId === "IMPROVE_FROM_ISSUES") return { terminal: "ANSWERED" };
    if (state.procedureId === "CAPTURE_KNOWLEDGE") return {};
    if (state.procedureId === "ANSWER_INQUIRY") {
      const target = ctx.target;
      if (ctx.intent === "REVISE_TONE" && !ctx.view!.pendingPrepared) {
        ctx.composed = {
          status: "DONE", message: NO_DRAFT_TO_REVISE_SENTENCE, artifacts: [],
          suggestedActions: [promptChip("답변 준비해줘")],
          workingSet: ctx.view!.workingSet, pendingHumanActions: [], pendingPrepared: null,
          budget: { toolCalls: 0, llmCalls: 0, elapsedMs: 0, stopReason: "TONE_REVISION" },
        };
        return { terminal: "BLOCKED_BY_PRECONDITION", absence: "NOT_ACTIONABLE" };
      }
      if (target && target.kind === "INQUIRY"
        && inquiryAnswerStep(ctx.intent, target.actionability) === "ADVISE") {
        ctx.composed = await this.adviseOnAnchoredInquiry(ctx, target);
        return { terminal: "ANSWERED" };
      }
    }
    return {};
  }

  /** The advisory over an object that cannot take a draft — composed where it always was. */
  private async adviseOnAnchoredInquiry(
    ctx: TurnCtx, resolved: Extract<ResolvedTarget, { kind: "INQUIRY" }>,
  ): Promise<Composed> {
    const view = ctx.view!;
    const started = Date.now();
    ctx.stage!("READING", STAGE_LABEL.READING);
    const advice = await adviseOnInquiry(ctx.bundle!, {
      inquiryId: resolved.inquiry.inquiryId, workItemId: resolved.inquiry.workItemId,
      productId: resolved.inquiry.productId, title: resolved.inquiry.title,
      actionability: resolved.actionability as Exclude<InquiryActionability, "DRAFTABLE">,
    });
    const workingSet = anchoredSet(resolved.inquiry, view.workingSet, [
      ...(view.workingSet?.productIds ?? []), ...(resolved.inquiry.productId ? [resolved.inquiry.productId] : []),
    ]);
    return {
      status: "DONE", message: advice.headline, artifacts: advice.artifacts, suggestedActions: advice.suggestedActions,
      workingSet, pendingHumanActions: [], pendingPrepared: view.pendingPrepared, activeTask: "INSPECT",
      budget: { toolCalls: advice.toolCalls, llmCalls: 0, elapsedMs: Date.now() - started, stopReason: "ADVISORY" },
    };
  }

  /** Which optional steps apply to this run. Required steps are never asked. */
  private opShouldRun(stepId: string, state: ProcedureState, ctx: TurnCtx): boolean {
    if (state.terminal) return false;
    switch (stepId) {
      case "prepare":
        // The absence recorded by `gate` does not skip this step: `directPrepare` is the one path that
        // both prepares a draft and refuses an object that cannot take one, and it reaches that verdict
        // through the SAME `inquiryDraftPrecondition` the gate called. An ADVISE over a non-draftable
        // object is the exception — its answer is the advisory, settled at `settle`.
        if (ctx.target == null || ctx.target.kind !== "INQUIRY") return ctx.target != null;
        return ctx.intent !== "REVISE_TONE"
          && inquiryAnswerStep(ctx.intent, ctx.target.actionability) === "PREPARE";
      case "revise":
        return ctx.intent === "REVISE_TONE" && ctx.view?.pendingPrepared != null;
      // The approval boundary and the send are reached from the approval surfaces, never from a chat
      // turn: a sentence has never been able to send anything, and this migration does not change that.
      case "approval": case "execute": return false;
      case "humanWait":
        // ANSWER_REVIEW's guided step. Reached from the review surfaces, never from a chat sentence.
        return false;
      default: return true;
    }
  }

  /** The handler table this service publishes to the AOP runtime. */
  private procedureOps(): ProcedureOps<TurnCtx> {
    return {
      hydrateWorld: (s, c) => this.opHydrateWorld(s, c),
      loadObject: (s, c) => this.opLoadObject(s, c),
      checkPrecondition: (s, c) => this.opCheckPrecondition(s, c),
      investigate: (s, c) => this.opInvestigate(s, c),
      evidence: (s, c) => this.opEvidence(s, c),
      prepare: (s, c) => this.opPrepare(s, c),
      revise: (s, c) => this.opRevise(s, c),
      humanWait: (s, c) => this.opHumanWait(s, c),
      resume: (s, c) => this.opResume(s, c),
      readOpportunities: (s, c) => this.opReadOpportunities(s, c),
      validateApproval: (s, c) => this.opValidateApproval(s, c),
      execute: (s, c) => this.opExecute(s, c),
      terminal: (s, c) => this.opTerminal(s, c),
      shouldRun: (id, s, c) => this.opShouldRun(id, s, c),
    };
  }

  private agentTurn(view: ConversationView, input: {
    status: TurnStatus; message: string; notes?: readonly string[];
    artifacts: readonly Artifact[]; suggestedActions: readonly SuggestedAction[];
    workingSet: WorkingSetView | null; pendingHumanActions: readonly PendingHumanAction[];
    pendingPrepared: PendingPreparedAction | null; resumedFrom?: string; failureCode?: string; failureReason?: string;
    budget?: TurnView["budget"]; answer?: OperatorAnswer; pendingCapture?: PendingKnowledgeCapture | null;
  }): TurnView {
    return {
      turnId: randomUUID(), conversationId: view.conversationId, role: "AGENT",
      message: input.message, artifacts: input.artifacts, suggestedActions: input.suggestedActions,
      ...(input.notes && input.notes.length > 0 ? { notes: [...input.notes] } : {}),
      continuation: {
        workingSet: input.workingSet, pendingHumanAction: input.pendingHumanActions[0] ?? null,
        pendingHumanActions: [...input.pendingHumanActions], pendingPrepared: input.pendingPrepared,
        pendingCapture: input.pendingCapture ?? view.pendingCapture ?? null,
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
    pendingPrepared: PendingPreparedAction | null, pendingCapture: PendingKnowledgeCapture | null,
    activeTask: ActiveTask | null = view.activeTask ?? null,
  ): Promise<void> {
    await store.save({
      ...view,
      turns: boundedTurns([...view.turns, ...turns]),
      workingSet, pendingHumanAction: pendingHumanActions[0] ?? null, pendingHumanActions: [...pendingHumanActions], pendingPrepared,
      pendingCapture, activeTask,
      updatedAt: this.now(),
    });
  }

  /** The answer → the turn: status, message, artifacts, actions, continuation. */
  private async compose(
    view: ConversationView, result: OperatorRunResult, hints: StartTurnRequest, prefix: string,
    bundle: SpringClientBundle, stage: (s: ProgressStage, label: string) => void,
    stillPending: readonly PendingHumanAction[], collected: NonNullable<ConversationRunContext["collected"]>,
    receipts: readonly AcquisitionResultArtifact[],
    world: WorldState,
    /** What this sentence asks of the object on the table — read ONCE at route time, never here. */
    intent: ProcedureIntent,
    /**
     * The seller's own sentence, for the ONE lane that answers it rather than routing on it.
     *
     * <b>This is not a second reading of the sentence.</b> Nothing in `compose` branches on these
     * words: they travel to the Grounded Conversation seam as the question a model answers from the
     * fact sheet, which is the whole point of that lane. The ownership contract is unchanged — the
     * planner is still the only thing that decides what the sentence MEANS.
     */
    said: string,
    afterCapture?: AfterCapture,
  ): Promise<Composed> {
    // One automatic resume per saved capture: a turn that follows a save never opens another gap, and
    // neither does the turn right after a SAVED card (the loop this fence forbids).
    const captureAllowed = !afterCapture && !lastTurnSavedCapture(view);
    let pendingCapture: PendingKnowledgeCapture | null | undefined = undefined;
    // An agent-lane capture question is said LAST: the finding (「등록된 배송 기준이 아직 없습니다」) first, then the ask.
    let trailingQuestion: string | null = null;
    if (result.status === "FAILED") {
      return {
        status: "FAILED", message: result.reason, artifacts: [], suggestedActions: [],
        workingSet: view.workingSet, pendingHumanActions: [], pendingPrepared: view.pendingPrepared,
        failureCode: result.failureCode, failureReason: result.reason,
      };
    }
    const { answer, plan } = result;
    // <b>The axis the run actually used, read back — not settled a second time</b> (Agent Semantic
    // Ownership v1 §4). The graph decides it once per dispatch from the plan's tokens, the previous
    // working set and the thread's channel, and the headline must not say 「방금 본 N건 중」 about a set
    // the read did not use. This used to recompute all of it here — three more reads of the same
    // sentence, with `emitLog = false` on the second call because it knew it was the repeat — which
    // made it possible for the rows and the sentence about them to be scoped differently.
    const effective = plan ?? emptyPlan();
    const axis = answer.axis ?? conversationAxisOf(effective);
    // Whether this turn was ABOUT the company — the plan's own answer, read once for both sentences.
    const aboutCompany = companyIsTheQuestion(answer);
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
      // A question about WHICH inquiry, asked while one is already selected, is not put to the seller
      // again (Response Hygiene v1 §6): the anchor is shown and the next moves are offered instead.
      const anchor = view.workingSet?.kind === "INQUIRIES" ? view.workingSet.selectedInquiry ?? null : null;
      const anchorItem = anchor ? inquiryFromHistory(view, anchor.inquiryId) : null;
      const anchorRow: SelectedInquiryRow | null = anchor && anchorItem ? {
        inquiryId: anchor.inquiryId, workItemId: anchor.workItemId, productId: anchor.productId, channelCode: anchor.channelCode,
        channelNameKo: anchorItem.channelNameKo, productName: anchorItem.productName, title: anchorItem.title ?? null,
        status: anchorItem.status, receivedAt: anchorItem.receivedAt, snippet: anchorItem.snippet ?? null,
      } : null;
      if (anchorRow && clarificationKindOf(plan?.clarificationReason) === "INQUIRY") {
        return {
          status: "DONE",
          message: `지금 보고 있는 문의 기준으로 계속하겠습니다. ${inquiryLine(anchorRow)} 「답변 준비해줘」처럼 무엇을 할지 말씀해 주세요.`,
          artifacts: [selectionSummary(anchorRow)],
          suggestedActions: [promptChip("답변 준비해줘"), ...(anchorRow.productId ? [promptChip("이 상품 기준으로 답변 준비해줘")] : []), promptChip("답변 안 한 문의만 보여줘")],
          workingSet: view.workingSet, pendingHumanActions: [], pendingPrepared: view.pendingPrepared, budget, answer,
        };
      }
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
    /**
     * <b>A finished collection owns its own turn's freshness</b> (Presentation Closure v1 §1).
     *
     * The resumed turn re-plans the original question, so the read it makes is newer than the sync it
     * just consumed and the freshness rule correctly asks for the next collection — which arrived
     * directly under the receipt as 「오늘 12:43 이후 아직 확인하지 못했어요 · 최신 상태 확인」, a card
     * asking for the step the seller had just completed, beside the proof that they completed it.
     *
     * Nothing about freshness or coverage is recomputed here: the verdict, the as-of and the channel
     * state are exactly what they were. What this drops is the SECOND rendering of one channel's
     * collection state in the one turn that already carries its receipt — and only for the channels a
     * receipt names. The next turn asks the question again and gets the answer the contract gives it.
     */
    const settled = withoutSettledCollectionSteps(stamped, receipts);
    // A replan runs a specialist twice and would show the same list twice; the later read is the one kept.
    // The acquisition receipts lead: the seller pressed 「가져오기」 and the first thing they should read
    // under the sentence is what that run brought in, before the rows it was collected for.
    const artifacts: Artifact[] = [...receipts, ...dedupeLists(settled)];
    let pendingPrepared: PendingPreparedAction | null = view.pendingPrepared;
    let headline: string | null = null;
    // A PREPARE with nothing to point at answers with the question alone (Response Hygiene v1 §2/§6):
    // whatever the plan read beside it (a rule, a resolver miss) stays in the evidence disclosure.
    let askedWhich = false;
    const extraChips: SuggestedAction[] = [];
    // R4: a product answer with no list artifact still names products — in its evidence refs and in
    // the entity the run resolved. Those become a PRODUCT_LIST and a PRODUCTS set, so 「첫 번째 거」 has
    // something to point at.
    // …but a turn that drew ONE object's card has already named that object and the product it belongs
    // to (Agent Object v1 §3): rolling the same evidence up into 「이 답변이 가리키는 상품 · 선택한 리뷰
    // 1」 under the card is the object counted a second time, in weaker words.
    const drewObjectCard = artifacts.some((a) => a.type === "REVIEW_DETAIL" || a.type === "INQUIRY_DETAIL");
    if (!primaryOf(artifacts) && !drewObjectCard) {
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

    // The inquiry this turn is about, when it is about exactly one — the conversation's anchor afterwards.
    let selected: SelectedInquiryRow | null = null;
    // A planner-side tone request while a draft is on the table is a revision of THAT draft: whatever
    // the plan read beside it is not shown and does not replace the set (the direct lane catches the
    // usual phrasings before the planner; this is the guard for the ones it did not).
    const toneRevision = axis.requestedAction === "PREPARE_INQUIRY_DRAFT" && axis.tone != null && view.pendingPrepared != null;
    if (toneRevision) {
      artifacts.length = 0;
      workingSet = view.workingSet;
    }

    // ── PREPARE: a draft for the targeted inquiry or review, through the product's own draft path.
    if (axis.requestedAction === "PREPARE_INQUIRY_DRAFT") {
      let targets = await this.resolveTargets(axis.target.selector, axis.target.index, view, hints, bundle, workingSet, artifacts);
      // <b>An action needs the object it acts on.</b> A PREPARE plan that dispatched no inquiry read
      // (live: the planner sent `search_org_knowledge` + `search_answer_memory` for 「재입고 언제 되냐는
      // 문의 답변 준비해줘」 and nothing that could name a row) leaves nothing to draft for, and the seller
      // is asked which inquiry they meant — about a sentence that described exactly one. This is not a
      // second planner choosing a goal: the goal is already PREPARE, and this satisfies its precondition
      // with ONE bounded org-scoped read narrowed by the subject the sentence itself named. Anything
      // other than exactly one row still asks.
      if (targets.length === 0) {
        const located = await this.locateBySubject(hints.text ?? "", axis.filters.topic ?? null, bundle);
        if (located) targets = [located];
      }
      const inquiryTargets = targets.filter((t): t is Extract<ResolvedTarget, { kind: "INQUIRY" }> => t.kind === "INQUIRY");
      if (inquiryTargets.length === 1) selected = inquiryTargets[0]!.inquiry;
      // A list the plan read beside the PREPARE is not what the seller asked for: the draft (or the state
      // of the targeted inquiry) is the answer, and a queue printed under it reads as a second answer.
      if (targets.length > 0) {
        for (let i = artifacts.length - 1; i >= 0; i -= 1) if (artifacts[i]!.type === "INQUIRY_LIST") artifacts.splice(i, 1);
      }
      if (targets.length === 0) {
        headline = "어떤 문의의 답변을 준비할지 알려주세요. 방금 본 목록에서 「첫 번째 거」처럼 말씀해 주시면 됩니다.";
        askedWhich = true;
      } else {
        const preparer = new DraftPreparer(bundle.inquiry, bundle.review);
        for (const resolved of targets) {
          if (resolved.kind === "REVIEW") {
            // The ANSWER_REVIEW precondition (Agent Procedure Layer v1 §2) — one door, so the tone
            // revision cannot skip it. A review nobody can reply to on its channel gets no draft, and
            // neither does one whose reply semantics could not be read.
            const verdict = await this.reviewCapability(bundle, resolved.target);
            const gate = reviewDraftPrecondition(verdict);
            if (!gate.ok) {
              const refused = this.reviewRefusal(resolved.target, gate.absence);
              artifacts.push(refused.artifact);
              headline = headline ?? refused.headline;
              extraChips.push(...refused.chips);
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
          // ANALYZE guard (Conversation Core v1) — now ASKED, not decided (Production Closure v1 §4).
          // 「첫 번째 문의, 뭐라고 답하면 좋을까」 over a non-draftable target is answered with advice,
          // never with the gate's refusal; which step that is belongs to the procedure layer, and this
          // lane no longer re-reads the sentence to work it out.
          if (inquiryAnswerStep(intent, resolved.actionability) === "ADVISE") {
            stage("READING", STAGE_LABEL.READING);
            const advice = await adviseOnInquiry(bundle, {
              inquiryId: resolved.inquiry.inquiryId, workItemId: resolved.inquiry.workItemId,
              productId: resolved.inquiry.productId, title: resolved.inquiry.title,
              // ADVISE is only ever returned for a non-draftable object — the cast states what the
              // verdict already guarantees, exactly as the deterministic lane's advisory does.
              actionability: resolved.actionability as Exclude<InquiryActionability, "DRAFTABLE">,
            });
            artifacts.push(...advice.artifacts);
            headline = headline ?? advice.headline;
            extraChips.push(...advice.suggestedActions);
            continue;
          }
          // Actionability gate + propose→generate + capture question — the SAME single-inquiry step the
          // direct 「뭐라고 답하면 좋을까」 lane runs (§8/§13); extracted so there is exactly one.
          const plannedGap = answer.evidence.find((e) => e.kind === "ORG_POLICY_GAP" && e.locator.outcome === "ABSENT");
          const plannerTopic = plannedGap ? orgTopicOf(String(plannedGap.locator.label ?? "").replace(/ (기준|근거) 없음$/, ""))?.topic ?? null : null;
          const one = await this.prepareOneInquiry(resolved, axis.tone, bundle, stage, captureAllowed, plannerTopic);
          artifacts.push(...one.artifacts);
          headline = headline ?? one.headline;
          if (one.pendingPrepared) pendingPrepared = one.pendingPrepared;
          if (one.pendingCapture !== undefined) pendingCapture = one.pendingCapture;
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

    // ── EXPLAIN_CAPABILITY: what this product can do — for the ASPECT the plan named.
    if (axis.requestedAction === "EXPLAIN_CAPABILITY") {
      const explained = await this.explainCapability(
        bundle, view, axis.filters.channel ?? workingSet?.filters.channelCode ?? null, workingSet,
        axis.filters.capabilityAspect, world,
        envelopeOf({ conversationId: view.conversationId, view, readiness: world.readiness.kind, surface: hints.surface ?? null }),
        said,
      );
      if (explained.artifact) artifacts.push(explained.artifact);
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
      /**
       * <b>An empty checklist is not proof that there is nothing to do</b> — and the DAILY_WORK
       * procedure is the one place that decides which of the two it is. Live on a clean org
       * (2026-09-05) 「뭐부터 하면 되냐고」 answered 「지금 먼저 하실 일은 없습니다」 to an organisation with
       * no connected channel: arithmetic truth over rows that could not exist. Only an empty list asks
       * the question, so a seller with work is unchanged; and only `ZERO_MEASURED` may say 없습니다.
       */
      const found = checklistOf(artifacts, view);
      const empty = found.items.length === 0;
      const gate = empty ? operationalPrecondition(world) : { ok: true as const };
      const step = gate.ok ? null : nextStepFor(gate.absence);
      const checklist = step ? { ...found, items: [{ label: step.label, to: step.to }] } : found;
      artifacts.push(checklist);
      // Every sentence below is the procedure's, including the honest zero — so «없습니다» exists in
      // exactly one place and cannot be said from a state that has not earned it.
      const said = gate.ok
        ? (honestZero(checklist.items.length, answer.findings.length)
            ? absenceSentence("DAILY_WORK", "ZERO_MEASURED", world) : null)
        : absenceSentence("DAILY_WORK", gate.absence, world);
      // An empty checklist over a turn that DID find work claims nothing: its findings are the answer.
      headline = said ?? (checklist.items.length > 0 ? `지금 하실 일을 정리했습니다 (${checklist.items.length}건).` : null);
    }

    // ── Selection without an action: the planner's ordinal/「이 문의」 target over the shown list anchors
    // that row and shows it (「첫 번째 문의, 뭐라고 답할까」 must not fall through to the org queue).
    if (!selected && axis.requestedAction !== "REQUEST_SEND_APPROVAL"
        && (axis.target.selector === "FIRST" || axis.target.selector === "NTH" || (axis.target.selector === "THIS" && hints.workItemId))) {
      const picked = (await this.resolveTargets(axis.target.selector, axis.target.index, view, hints, bundle, workingSet, artifacts))
        .filter((t): t is Extract<ResolvedTarget, { kind: "INQUIRY" }> => t.kind === "INQUIRY");
      if (picked.length === 1) {
        selected = picked[0]!.inquiry;
        // The seller pointed at ONE row: the answer is that row, in the same card the INSPECT lane
        // draws — never the queue printed again under a 「선택한 문의」 summary. Found live: 「두 번째 거
        // 자세히 보여줘」 answered 「답변이 필요한 문의가 2건입니다」 with the whole list beneath it.
        for (let i = artifacts.length - 1; i >= 0; i -= 1) if (artifacts[i]!.type === "INQUIRY_LIST") artifacts.splice(i, 1);
        if (!artifacts.some((a) => a.type === "SUMMARY" || a.type === "DRAFT" || a.type === "INQUIRY_DETAIL")) {
          artifacts.unshift(inquiryDetailArtifact(selected, picked[0]!.actionability, selected.snippet ? excerpt(selected.snippet) : null));
          headline = headline ?? `이 문의를 보고 있습니다. ${INSPECT_SENTENCE[picked[0]!.actionability]}`;
        }
      }
    }
    // A screen launch (`workItemId` hint) resolved the inquiry inside the graph; its verified ref names it.
    if (!selected && hints.workItemId) selected = selectedFromEntities(result, answer, hints.workItemId);
    // ── Anchor preservation: a selected inquiry stays the working set until the seller draws a NEW list.
    // Products found on the way (an R4 list, the inquiry's own binding) are added beside it — never over it.
    const drewList = drewFreshList(result.artifacts, view.workingSet?.selectedInquiry ?? null);
    const carried = !drewList ? view.workingSet?.selectedInquiry ?? null : null;
    const anchor = selected ?? carried;
    if (anchor) {
      workingSet = anchoredSet(anchor, view.workingSet, [
        ...(workingSet?.productIds ?? []), ...(anchor.productId ? [anchor.productId] : []), ...(hints.productId ? [hints.productId] : []),
      ]);
    } else {
      // <b>The other two objects keep their anchor the same way</b> (Agent Object v1 §1). A product or
      // review anchor used to survive exactly one turn: `workingSetOf` returns null for a turn that drew
      // artifacts but no SET, so the object the seller had selected was dropped by the very turn that
      // answered about it — and the second 「이 리뷰…」 went to the org. One rule for all three kinds:
      // the anchor stands until a NEW set is drawn that does not contain it.
      const object = view.workingSet?.selectedObject ?? null;
      if (object && !drewFreshObjectList(result.artifacts, object)) {
        workingSet = anchoredObjectSet(object, workingSet ?? view.workingSet);
      }
    }

    // Knowledge Context v1-A: a POLICY need the company's rules could not meet is a gap the seller can
    // close on the rules screen — offered, not required (nothing here can resume; the seller asks again).
    // Retrieval & Grounding Correctness v1: offered only when a rule is MISSING (ABSENT, or a miss over
    // the rules that exist). A rule that exists and does not apply (NOT_APPLICABLE) is not fixed by
    // registering it again — that gap carries no step.
    const policyGap = answer.evidence.find((e) => e.kind === "ORG_POLICY_GAP" && e.locator.outcome !== "NOT_APPLICABLE");
    const policyTopic = policyGap ? orgTopicOf((policyGap.locator.label ?? "").replace(/ (기준|근거) 없음$/, "")) : null;
    if (policyGap && policyTopic && policyGap.locator.outcome === "ABSENT" && captureAllowed && pendingCapture === undefined
        && !artifacts.some((a) => a.type === "KNOWLEDGE_CAPTURE" || (a.type === "HUMAN_ACTION_REQUIRED" && a.actionType === "KNOWLEDGE_ENTRY"))) {
      // Knowledge Capture v1 (agent lane): a rule that is MISSING is asked for, and the original request is
      // re-run once after the save. A rule that exists and does not apply carries no question.
      const gap: OpenedGap = {
        scope: "ORG", topic: policyTopic.topic, knowledgeType: policyTopic.knowledgeType, topicLabel: policyTopic.label, missingSubject: null,
        inquiryId: workingSet?.selectedInquiry?.inquiryId ?? null, workItemId: workingSet?.selectedInquiry?.workItemId ?? null,
        productId: null, productName: null, variantRequired: false, variantId: null, variantName: null,
        question: questionFor("ORG", policyTopic.topic, null, null, false),
      };
      const opened = this.openCapture(gap, { kind: "GOAL", turnId: "" });
      pendingCapture = opened;
      artifacts.push(captureArtifact(opened, "ASKED", {}));
      trailingQuestion = gap.question;
      log("conversation_capture_asked", { scope: "ORG", topic: policyTopic.topic, variantRequired: false });
    } else if (policyGap && !afterCapture && !artifacts.some((a) => a.type === "KNOWLEDGE_CAPTURE" || (a.type === "HUMAN_ACTION_REQUIRED" && a.actionType === "KNOWLEDGE_ENTRY"))) {
      // (Not on the turn that just saved a rule: 「등록하면 답할 수 있습니다」 beside 「저장했습니다」 is two answers.)
      const topic = (policyGap.locator.label ?? "운영 기준 없음").replace(/ (기준|근거) 없음$/, "");
      artifacts.push({
        artifactId: "a-policy-gap", type: "HUMAN_ACTION_REQUIRED",
        title: `${topic} 기준을 등록하면 답할 수 있습니다`,
        actionType: "KNOWLEDGE_ENTRY", reason: "NO_ANSWER_BASIS", path: "WORKSPACE",
        channelCode: null, channelNameKo: null, accountId: null, dataType: null,
        to: "/settings/policies", requestedAt: this.now(), resumable: false, optional: true,
      });
    }
    // <b>An instruction is not answered with a button that repeats it.</b> When the sentence said "가져와",
    // the review-import card starts its guided run on arrival — and it is a REQUIRED step, not an offer,
    // because the seller asked for the collection rather than for the rows as they stand.
    const acquisitionAsked = isAcquisitionRequest(hints.text ?? "", { reviewsInContext: view.workingSet?.kind === "REVIEWS" });
    if (acquisitionAsked) {
      for (let i = 0; i < artifacts.length; i += 1) {
        const a = artifacts[i]!;
        if (a.type !== "HUMAN_ACTION_REQUIRED" || a.actionType !== "REVIEW_IMPORT") continue;
        artifacts[i] = { ...a, optional: false, autoStart: true };
      }
    }
    /**
     * <b>Nothing found is not the same fact as nothing to find.</b>
     *
     * Measured live on a clean org (2026-09-05): every list this turn drew came back with zero rows and
     * the answer reported them as 문의 0 · 리뷰 0 — true about the read, false about the store, because
     * NOT ONE CHANNEL was connected and no read could have returned anything. {@code ChannelDataState}
     * already says which state may say 없습니다 and it is `ZERO` alone; these rows were `NOT_CONNECTED`.
     *
     * <b>Contained to first use, and it costs a read only when the answer was empty anyway.</b> The
     * coverage read happens only when EVERY row-bearing artifact of this turn is empty, and it changes
     * the answer only for an org that has connected nothing (or connected and collected nothing) — a
     * seller with rows cannot reach this branch, and a coverage read that FAILED is `UNKNOWN`, from
     * which nothing is claimed.
     */
    const rowBearing = artifacts.filter((a) => ROW_BEARING.has(a.type));
    const emptyGate = rowBearing.length > 0 && rowBearing.every(isEmptyRowArtifact)
      ? operationalPrecondition(world) : { ok: true as const };
    const notStarted = emptyGate.ok ? null : absenceSentence("DAILY_WORK", emptyGate.absence, world);
    if (notStarted) {
      // The empty cards go with the sentence: a 「문의 0건」 card under 「아직 연결된 판매 채널이
      // 없어서…」 is the same disproven claim, drawn.
      for (let i = artifacts.length - 1; i >= 0; i -= 1) if (ROW_BEARING.has(artifacts[i]!.type)) artifacts.splice(i, 1);
      // …and an empty set is not a set to point at: 「그중…」 has no referent and the generic chips would
      // offer 「안 좋은 것만 봐줘」 over rows that do not exist. The prior anchor stands untouched.
      workingSet = view.workingSet;
      // …and the one step this state has, when it has one — the procedure's, so the chat card and the
      // checklist item cannot offer different things for the same reason.
      const step = emptyGate.ok ? null : nextStepFor(emptyGate.absence);
      extraChips.push(...(step && !extraChips.some((c) => c.to === step.to)
        ? [{ label: step.label, kind: "LINK" as const, to: step.to }] : []));
    }
    const humans = artifacts.filter((a): a is HumanActionRequiredArtifact => a.type === "HUMAN_ACTION_REQUIRED");
    // An offered refresh (`optional`) is a control under the rows, not a reason to wait: the turn is DONE.
    const human = humans.find((h) => !h.optional) ?? null;
    const primary = primaryOf(artifacts);
    const first = notStarted ?? headline ?? sellerSentence(headlineOf(primary, artifacts, view, axis, answer), aboutCompany) ?? "확인한 내용입니다.";
    // R3: a count finding that says what the headline already said (same numbers, same noun) is one
    // fact twice. Dropped from the prose; it stays in the answer's findings with its evidence.
    // A PREPARE turn about one inquiry answers with the draft (or that inquiry's state); whatever the plan
    // read beside it stays in the evidence disclosure and out of the prose — a queue count under
    // 「이미 답변된 문의라…」 reads as a second, contradicting answer (Conversation Object Integrity v1).
    const draftTurn = axis.requestedAction === "PREPARE_INQUIRY_DRAFT" && (selected != null || askedWhich);
    // A coverage-limit sentence (「…근거를 찾지 못했습니다」) is never a restated count, whatever digits a
    // product name carries — 「전선몰딩 1호」 under a 「상품 1개」 headline is not the same fact twice.
    const knowledgeGap = artifacts.some((a) => a.type === "HUMAN_ACTION_REQUIRED" && a.actionType === "KNOWLEDGE_ENTRY")
      || artifacts.some((a) => a.type === "DRAFT" && a.answerBasis === "NO_ANSWER_BASIS");
    // ① the answer, ② its limits: a coverage-limit sentence (「…아직 저장돼 있지 않습니다」) never precedes
    // the finding that actually answers the question (Response Hygiene v1 §2). Stable within each group.
    const ordered = [...answer.findings.filter((f) => !f.claimsCoverageLimit), ...answer.findings.filter((f) => f.claimsCoverageLimit)];
    // Opportunity Engine v1: a finding whose whole evidence is drawn as a ROW of the object card is not
    // repeated as prose — the card is the object, and the sentence under the headline would be that
    // row's own text a second time (live, 2026-09-04: two full recommendations above a card of seven).
    const rowEvidence = new Set(answer.evidence.filter((e) => e.kind === "IMPROVEMENT_OPPORTUNITY").map((e) => e.evidenceId));
    const drawnAsRows = artifacts.some((a) => a.type === "OPPORTUNITY_LIST");
    // A turn that has just said WHY it is empty does not then list the zeros it found.
    const supported = draftTurn || notStarted ? [] : ordered
      .filter((f) => f.confidence === "SUPPORTED")
      .filter((f) => !(drawnAsRows && f.evidenceIds.length > 0 && f.evidenceIds.every((id) => rowEvidence.has(id))))
      .filter((f) => f.statement !== first && (f.claimsCoverageLimit || !redundantWithHeadline(f.statement, first)))
      .map((f) => sellerSentence(f.statement, aboutCompany))
      .filter((line): line is string => line != null)
      // Response Hygiene v1 §6: a selected inquiry is described by its own card, not again by prose; a
      // 「AI 초안이 준비돼 있습니다」 beside a knowledge gap is two answers to one question.
      .filter((line) => !(selected && /^이 문의(는|에 연결된 상품)/.test(line)))
      .filter((line) => !(knowledgeGap && line.includes("초안이 준비돼 있습니다")));
    const sentences = [prefix + first, ...dedupe(supported).slice(0, FINDINGS_MAX)];
    // Claim levels for the channels whose step just finished — B (rows written in the window) over C
    // (rows ingested); never A. `reviewClaim.ts` keeps ingested ≠ written.
    const claimEvidence: EvidenceArtifact["items"][number][] = [];
    if (collected.length > 0 && primary?.type === "REVIEW_LIST") {
      const names = new Map(primary.freshness.map((f) => [f.channelCode.toUpperCase(), f.channelNameKo ?? f.channelCode]));
      // <b>No window is `null`, never a placeholder one</b> (Outcome Artifact v1 §2). An unbounded read
      // used to be handed a sentinel range so the filter would pass everything — and `windowWord` then
      // printed it: 「… 중 0000-00-00~9999-99-99에 작성된 리뷰는 50건입니다」, live on 2026-09-02. The claim
      // counts exactly the same rows; what it no longer does is name a period it does not have.
      for (const claim of claimsFor(primary.items, primary.scope.period ?? null, collected, names)) {
        /**
         * **The ladder stays; the prose says the number once** (Chat-first Semantic & Surface
         * Finalization v1 §3).
         *
         * 「오늘 확인 가능한 리뷰가 2건입니다」 and 「이번에 확인한 … 오늘 작성된 리뷰는 2건입니다」 are two
         * different grounds for one number — what is held, and what this run brought in — and
         * `reviewClaim.ts` is right to keep them apart. But at the same count a seller reads 2 and 2 and
         * has to work out why we said it twice. So when the numbers agree the claim leaves the paragraph
         * and becomes what it is: the provenance of a number already stated, in the evidence disclosure.
         * When they differ it is genuinely new information and it is said.
         */
        // The same rule, and the same reason, for the receipt card beside it (Outcome Artifact v1 §1):
        // 「이전에 없던 네이버 리뷰 115건을 새로 가져왔습니다」 under a card whose 새로 들어옴 reads 115 is
        // one number in two renderings, and the card is the stronger one. Only when the two agree — a
        // claim that differs from what the record tallied is genuinely new information and is said.
        const receipt = receipts.find((r) => r.channelCode === claim.channelCode);
        if (claim.count === primary.totalCount || claim.count === receipt?.rowsNew) {
          claimEvidence.push({
            label: claim.sentence, count: claim.count,
            from: primary.scope.period?.from ?? null, to: primary.scope.period?.to ?? null,
            asOf: null, covered: true,
          });
          continue;
        }
        sentences.push(claim.sentence);
      }
    }
    // The rows path's own note — 「언제 기준」 per stale channel, a refresh that could not be made, a
    // partial collection — each said once here and nowhere else. Never model prose.
    //
    // <b>These are the answer's LIMITS and they leave the answer's paragraph</b> (Agentic Experience v2).
    // Sentence by sentence, so a fact the findings already said (the per-channel 「언제 기준」) is not read
    // twice, and a limit the answer itself already stated is dropped rather than repeated underneath it.
    // …and neither does it qualify them. 「지금 확인이 필요한 반복 리뷰 문제는 없습니다」 under 「아직
    // 연결된 판매 채널이 없어서…」 is the same disproven absence, said as a limit (live, 2026-09-05).
    const limits = answer.note && !draftTurn && !notStarted
      ? answer.note.split(/(?<=[.!?])\s+/).filter((s) => s.length > 0)
      : [];
    if (trailingQuestion) sentences.push(trailingQuestion);

    // 「확인한 자료 · 문의」 beside 「확인해 드릴 자료가 없습니다」 reads as a contradiction, and it is one:
    // the claim this turn makes rests on the COVERAGE read, not on the empty queue reads under it.
    const evidenceArtifact = notStarted ? null : evidenceOf(answer, claimEvidence);
    if (evidenceArtifact) artifacts.push(evidenceArtifact);

    const pendingHumanActions: PendingHumanAction[] = humans.map((h) => ({
      turnId: "", actionType: h.actionType, path: h.path, channelCode: h.channelCode,
      accountId: h.accountId, dataType: h.dataType, requestedAt: h.requestedAt,
      ...(h.optional ? { optional: true } : {}),
    }));
    const status: TurnStatus = human ? "WAITING_HUMAN" : "DONE";
    const message = dedupeNear(sentences).join(" ");
    return {
      status, message, artifacts,
      notes: dedupeNear(limits).filter((s) => !message.includes(s)),
      // Three next moves at most: a fourth is a menu, and a menu is the shape a chat is not. A lane
      // that named its OWN next moves owns them — the generic set chips beside them offered 「답변
      // 준비해줘」 on an inquiry the same turn had just said was already answered (live 2026-08-31).
      // <b>Whether THIS turn put the set on screen</b>, read off the artifacts the seller is about to
      // see — not off the anchor, which is deliberately carried forward whether or not this turn drew
      // anything. The two used to be one value and the chips read the wrong one: an org-scope answer
      // that draws no list (「우리 배송 정책 뭐였지?」) keeps the previous set as its anchor — correctly,
      // so a later 「그중…」 still has a referent — and then offered 「첫 번째 거 답변 준비해줘」 under the
      // policy sentence, three next moves about rows that answer had nothing to do with.
      suggestedActions: (extraChips.length > 0 ? extraChips : suggestionsFor(primary, workingSet, human, artifacts, drewSetOf(artifacts))).slice(0, 3),
      workingSet, pendingHumanActions, pendingPrepared, budget, answer, pendingCapture,
    };
  }

  // ─────────────── Knowledge Capture v1 ───────────────

  /** A gap as the thread holds it: verified ids only, minted capture id, the turn id stamped later. */
  private openCapture(gap: OpenedGap, resume: PendingKnowledgeCapture["resume"]): PendingKnowledgeCapture {
    return { ...gap, captureId: randomUUID(), turnId: "", state: "ASKED", candidate: null, resume, askedAt: this.now() };
  }

  /**
   * The seller's next sentence while a gap is open. Closed cues decide: 「취소」 closes it, a question or a
   * command goes to the planner with the gap still open, anything else is THE answer — shown back verbatim
   * as a candidate with [저장하고 계속], after the duplicate/conflict fence read the existing rules. No write.
   */
  private async captureAnswerLane(
    view: ConversationView, pending: PendingKnowledgeCapture, text: string, bundle: SpringClientBundle,
  ): Promise<Composed | null> {
    const started = Date.now();
    const keep = (message: string, artifacts: Artifact[], next: PendingKnowledgeCapture | null, reads: number, chips: SuggestedAction[] = []): Composed => ({
      status: "DONE", message, artifacts, suggestedActions: chips,
      workingSet: view.workingSet, pendingHumanActions: [], pendingPrepared: view.pendingPrepared, pendingCapture: next,
      budget: { toolCalls: reads, llmCalls: 0, elapsedMs: Date.now() - started, stopReason: "KNOWLEDGE_CAPTURE" },
    });
    const kind = classifySellerAnswer(text);
    if (kind === "CANCEL") {
      log("conversation_capture_cancelled", { scope: pending.scope });
      return keep(CAPTURE_SENTENCE.cancelled, [captureArtifact(pending, "CANCELLED", {})], null, 0);
    }
    if (kind !== "CANDIDATE") return null;
    const content = normalizeContent(text);
    let variantId = pending.variantId;
    let variantName = pending.variantName;
    let reads = 0;
    if (pending.variantRequired && pending.productId) {
      let options: Array<{ id: string; name: string }> = [];
      try {
        reads += 1;
        const known = await bundle.operator.getProductKnowledge(pending.productId);
        options = known.variants.filter((v) => v.id && v.optionName).map((v) => ({ id: v.id!, name: v.optionName! }));
      } catch { options = []; }
      // A listing with NO variant rows has no 규격 to bind to: the whole listing is the only truthful scope
      // (the draft then asks the customer, as Knowledge Gap Resolution v1 §5 says). Found live.
      const named = options.length === 0 ? { kind: "GENERIC" as const } : variantFromAnswer(content, options);
      if (named.kind === "UNRESOLVED") {
        // A 규격-dependent fact with no 규격 named is not saved as a fact about the whole listing.
        return keep(CAPTURE_SENTENCE.variantUnresolved(options.map((o) => o.name)), [], pending, reads);
      }
      if (named.kind === "VARIANT") { variantId = named.id; variantName = named.name; }
    }
    const title = titleOf(content);
    let existing: ExistingKnowledge[] = [];
    try {
      reads += 1;
      existing = pending.scope === "ORG"
        ? (await bundle.inquiry.listOrgKnowledge()).map((r) => ({ id: r.id, title: r.title, body: r.body, type: r.knowledgeType }))
        : (await bundle.inquiry.listProductKnowledgeSources(pending.productId!)).map((r) => ({ id: r.id, title: r.title, body: r.body, type: r.sourceType, variantId: r.variantId }));
    } catch { existing = []; }
    const verdict = judgeCandidate(content, title, existing, { type: pending.knowledgeType, variantId, scopeKind: pending.scope });
    const settingsChip: SuggestedAction = { label: "설정에서 직접 편집", kind: "LINK", to: settingsPathFor(pending.scope, pending.productId) };
    if (verdict.kind === "DUPLICATE") {
      log("conversation_capture_refused", { scope: pending.scope, reason: "DUPLICATE" });
      return keep(CAPTURE_SENTENCE.duplicate(pending.topicLabel), [captureArtifact(pending, "DUPLICATE", { content, existing: verdict.existing })], null, reads, [settingsChip]);
    }
    if (verdict.kind === "CONFLICT") {
      log("conversation_capture_refused", { scope: pending.scope, reason: verdict.reason });
      return keep(CAPTURE_SENTENCE.conflict(pending.topicLabel), [captureArtifact(pending, "CONFLICT", { content, existing: verdict.existing })], null, reads, [settingsChip]);
    }
    const fingerprint = fingerprintOf({ scope: pending.scope, productId: pending.productId, variantId, knowledgeType: pending.knowledgeType, content });
    const next: PendingKnowledgeCapture = { ...pending, state: "CANDIDATE", variantId, variantName, candidate: { content, title, fingerprint } };
    log("conversation_capture_candidate", { scope: pending.scope, chars: content.length, variant: variantId != null });
    return keep(CAPTURE_SENTENCE.candidate(pending.topicLabel), [captureArtifact(next, "CANDIDATE", { content, fingerprint })], next, reads);
  }

  /**
   * 「저장하고 계속」 / 「취소」 on the candidate. The decision must name the open capture AND the fingerprint of
   * the sentence the card showed; anything else is stale and writes nothing. A SAVE writes once through the
   * seller's own knowledge seam, then resumes the original work exactly once: the inquiry's draft path (after
   * re-checking the inquiry is still workable) or the turn whose goal was being answered.
   */
  private async decideCapture(
    token: string, id: string, view: ConversationView, decision: NonNullable<StartTurnRequest["captureDecision"]>,
    bundle: SpringClientBundle, store: ConversationStore, progress: ProgressFn, signal: AbortSignal | undefined, started: number,
  ): Promise<TurnView> {
    const pending = view.pendingCapture ?? null;
    const userTurn: TurnView = {
      turnId: randomUUID(), conversationId: id, role: "USER", text: decision.decision === "SAVE" ? "저장하고 계속" : "취소",
      message: decision.decision === "SAVE" ? "저장하고 계속" : "취소", artifacts: [], suggestedActions: [],
      continuation: { workingSet: view.workingSet, pendingHumanAction: null, pendingHumanActions: [], pendingPrepared: view.pendingPrepared, pendingCapture: pending },
      status: "DONE", createdAt: this.now(),
    };
    const finish = async (composed: Composed): Promise<TurnView> => {
      const agentTurn = this.agentTurn(view, { ...composed, pendingCapture: composed.pendingCapture ?? null });
      const pendingPrepared = composed.pendingPrepared ? { ...composed.pendingPrepared, turnId: agentTurn.turnId } : null;
      const pendingCapture = composed.pendingCapture ?? null;
      const finalTurn: TurnView = { ...agentTurn, continuation: { ...agentTurn.continuation, pendingPrepared, pendingCapture } };
      await this.persist(store, view, [userTurn, finalTurn], view.workingSet, pendingActionsOf(view), pendingPrepared, pendingCapture);
      log("conversation_turn", { status: finalTurn.status, toolCalls: finalTurn.budget?.toolCalls ?? 0, llmCalls: finalTurn.budget?.llmCalls ?? 0, ms: Date.now() - started, artifactTypes: [...new Set(finalTurn.artifacts.map((a) => a.type))].join(","), workingSetKind: view.workingSet?.kind ?? "NONE", requestedAction: "KNOWLEDGE_CAPTURE" });
      return finalTurn;
    };
    const done = (message: string, artifacts: Artifact[], next: PendingKnowledgeCapture | null, budget: { toolCalls: number; llmCalls: number }, pendingPrepared = view.pendingPrepared, chips: SuggestedAction[] = []): Composed => ({
      status: "DONE", message, artifacts, suggestedActions: chips, workingSet: view.workingSet, pendingHumanActions: [], pendingPrepared,
      pendingCapture: next, budget: { ...budget, elapsedMs: Date.now() - started, stopReason: "KNOWLEDGE_CAPTURE" },
    });
    const bound = pending && pending.captureId === decision.captureId && pending.state === "CANDIDATE" && pending.candidate?.fingerprint === decision.fingerprint;
    if (!bound) {
      log("conversation_capture_stale", { hadPending: pending != null });
      return finish(done(CAPTURE_SENTENCE.stale, [], pending, { toolCalls: 0, llmCalls: 0 }));
    }
    if (decision.decision === "CANCEL") {
      log("conversation_capture_cancelled", { scope: pending.scope });
      return finish(done(CAPTURE_SENTENCE.cancelled, [captureArtifact(pending, "CANCELLED", {})], null, { toolCalls: 0, llmCalls: 0 }));
    }
    let savedId: string;
    try {
      savedId = (await new KnowledgeCaptureWriter(bundle.inquiry).write(pending)).id;
    } catch (err) {
      log("conversation_capture_write_failed", { scope: pending.scope, error: err instanceof Error ? err.name : "unknown" });
      const settingsChip: SuggestedAction = { label: "설정에서 직접 편집", kind: "LINK", to: settingsPathFor(pending.scope, pending.productId) };
      return finish(done(CAPTURE_SENTENCE.saveFailed, [captureArtifact(pending, "CANDIDATE", { content: pending.candidate!.content, fingerprint: pending.candidate!.fingerprint })], pending, { toolCalls: 0, llmCalls: 0 }, view.pendingPrepared, [settingsChip]));
    }
    log("conversation_capture_saved", { scope: pending.scope, topic: pending.topic ?? pending.knowledgeType, variant: pending.variantId != null, resume: pending.resume.kind });
    const savedLine = CAPTURE_SENTENCE.saved(pending.topicLabel);
    if (pending.resume.kind === "GOAL") {
      // The original request is re-run through the same resume path a finished human step uses — one
      // planner call, the saved rule now readable — with the save said first. Persist the decision, then run.
      const artifact = captureArtifact(pending, "SAVED", { content: pending.candidate!.content, resume: "PENDING_RESUME" });
      await this.persist(store, view, [userTurn], view.workingSet, pendingActionsOf(view), view.pendingPrepared, null);
      return this.turnNow(token, id, { resumeOfTurnId: pending.resume.turnId }, progress, {
        signal, afterCapture: { message: `${savedLine} ${CAPTURE_SENTENCE.resumeGoal}`, artifact },
      });
    }
    // INQUIRY_DRAFT: the same inquiry, re-checked, then the product's own draft path once — no planner.
    const { workItemId, inquiryId, tone } = pending.resume;
    let detail: Awaited<ReturnType<typeof bundle.inquiry.getInquiryDetail>> | null = null;
    try { detail = await bundle.inquiry.getInquiryDetail(workItemId); } catch { detail = null; }
    const actionability = actionabilityOf({ workItemId, phase: detail?.phase, status: detail?.status });
    // The ANSWER_INQUIRY precondition again — the resume must not draft for a row the gate refuses.
    if (!inquiryDraftPrecondition(actionability, detail != null).ok || detail == null) {
      log("conversation_capture_resumed", { resume: "INQUIRY_NOT_ACTIONABLE", actionability });
      return finish(done(`${savedLine} ${CAPTURE_SENTENCE.savedNotActionable}`, [captureArtifact(pending, "SAVED", { content: pending.candidate!.content, resume: "INQUIRY_NOT_ACTIONABLE" })], null, { toolCalls: 1, llmCalls: 0 }));
    }
    progress({ type: "stage", stage: "PREPARING_DRAFT", label: STAGE_LABEL.PREPARING_DRAFT, at: this.now() });
    const target: DraftTarget = {
      workItemId, inquiryId, channelCode: detail.channelCode ?? null, channelNameKo: detail.channelNameKo ?? null,
      productId: detail.productId ?? pending.productId, productName: detail.productName ?? pending.productName,
    };
    let draft: DraftArtifact;
    let generated: GeneratedDraftView | null = null;
    try {
      const prepared = await new DraftPreparer(bundle.inquiry, bundle.review).prepareWithView(target, tone, `a-draft-${workItemId}`);
      draft = prepared.artifact;
      generated = prepared.view;
    } catch (err) {
      log("conversation_draft_failed", { objectKind: "INQUIRY", error: err instanceof Error ? err.name : "unknown" });
      return finish(done(`${savedLine} ${DRAFT_FAILED_SENTENCE}`, [captureArtifact(pending, "SAVED", { content: pending.candidate!.content, resume: "DRAFT_STILL_GAP" })], null, { toolCalls: 1, llmCalls: 0 }));
    }
    const cited = (generated?.evidence ?? []).some((e) => e.sourceId === savedId);
    const grounded = draft.version != null && draft.answerBasis !== "NO_ANSWER_BASIS" && !draft.unavailableMessage;
    log("conversation_capture_resumed", { resume: grounded ? "DRAFT_GROUNDED" : "DRAFT_STILL_GAP", cited, answerBasis: draft.answerBasis });
    if (!grounded) {
      // The fact is saved; it did not make THIS question answerable. Said honestly — the new knowledge is
      // never pushed into a draft by hand, and no second question is opened on the same breath.
      //
      // <b>Two different failures, and only one of them is about the rule.</b> When the draft path was
      // UNAVAILABLE (the capability is off in this deployment), the saved rule fell short of nothing —
      // it was never tried. Claiming 「이 문의에 바로 적용할 근거로는 아직 부족합니다」 there is a wrong
      // statement about the seller's own rule, so the card carries no resume line and the prose says
      // the real reason once.
      const unavailable = draft.unavailableMessage != null;
      const line = draft.unavailableMessage ?? [CAPTURE_SENTENCE.savedStillGap, draft.answerBasisNote && !GENERIC_BASIS_NOTE.test(draft.answerBasisNote) ? draft.answerBasisNote : null].filter(Boolean).join(" ");
      return finish(done(`${savedLine} ${line}`, [
        captureArtifact(pending, "SAVED", { content: pending.candidate!.content, ...(unavailable ? {} : { resume: "DRAFT_STILL_GAP" as const }) }),
        draft,
      ], null, { toolCalls: 1, llmCalls: draft.version != null ? 1 : 0 }));
    }
    const asksBack = draft.answerBasis === "NEEDS_CLARIFICATION";
    const line = `${savedLine} ${cited ? "저장한 기준을 근거로 " : ""}${asksBack ? "고객에게 되묻는 답변 초안을 다시 준비했습니다." : "답변 초안을 다시 준비했습니다."}`;
    const pendingPrepared: PendingPreparedAction = { turnId: "", kind: "INQUIRY_DRAFT", workItemId, inquiryId, draftVersion: draft.version, contentFingerprint: draft.contentFingerprint };
    return finish(done(line, [captureArtifact(pending, "SAVED", { content: pending.candidate!.content, resume: "DRAFT_GROUNDED" }), draft], null, { toolCalls: 1, llmCalls: 1 }, pendingPrepared));
  }

  /** Which objects a draft/send sentence points at — an index into what the previous turn showed. */
  private async resolveTargets(
    selector: string, index: number | null, view: ConversationView, hints: StartTurnRequest,
    bundle: SpringClientBundle, workingSet: WorkingSetView | null, drawn: readonly Artifact[] = [],
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
    // Inquiry identity ≠ work-item identity: a ROWS set is indexed by inquiry id, a WORKLOAD set by
    // work item id — both are looked up in the shown rows by either key, so 「첫 번째 거」 resolves whether
    // or not the row has a work item. Whether a draft can attach is the row's own actionability.
    const ids = set?.kind === "INQUIRIES" ? set.ids : [];
    // <b>An ordinal indexes what the seller was LOOKING AT; a singular target may be what this turn
    // found.</b> 「첫 번째 거」 said with nothing on screen points at nothing, and resolving it against
    // rows the same turn drew would answer an ordinal the seller could not have counted. So the ordinal
    // selectors read the persisted set only, and `drawn` is available to the THIS/NONE branch — where
    // the question is not "which of these" but "the one this turn is about".
    const pickShown = (rowIds: readonly string[]): ResolvedTarget[] =>
      rowIds.map((id) => inquiryTargetFromHistory(view, id)).filter((t): t is ResolvedTarget => t != null);
    const pick = (rowIds: readonly string[]): ResolvedTarget[] =>
      rowIds.map((id) => inquiryTargetFromHistory(view, id, drawn)).filter((t): t is ResolvedTarget => t != null);
    // The selected inquiry, when the set is anchored on one — 「이 문의」 / 「이 상품 기준으로」 / a bare verb.
    const anchored = set?.kind === "INQUIRIES" && set.selectedInquiry ? pick([set.selectedInquiry.inquiryId]) : [];
    switch (selector) {
      case "FIRST":
        return pickShown(ids.slice(0, 1));
      case "NTH":
        return index != null && index >= 1 ? pickShown(ids.slice(index - 1, index)) : [];
      case "ALL":
        return pickShown(ids.slice(0, ALL_TARGETS_MAX));
      case "THIS":
      default: {
        // The inquiry the seller is standing on (the screen's hint), the draft just prepared, the
        // anchored inquiry, or the one inquiry in the set. A hint is verified by the same org-scoped
        // read the runtime uses.
        if (hints.workItemId) {
          const known = inquiryTargetFromHistory(view, hints.workItemId, drawn);
          if (known) return [known];
          try {
            const detail = await bundle.inquiry.getInquiryDetail(hints.workItemId);
            const row = {
              workItemId: detail.workItemId, inquiryId: detail.inquiryId, channelCode: detail.channelCode,
              channelNameKo: detail.channelNameKo, productId: detail.productId ?? null, productName: detail.productName ?? null,
            };
            const actionability = actionabilityOf({ workItemId: detail.workItemId, phase: detail.phase, status: detail.status });
            return [{
              kind: "INQUIRY",
              inquiry: { ...row, title: detail.title ?? null, status: detail.status, receivedAt: detail.receivedAt ?? null, snippet: detail.details ?? null },
              actionability,
              target: actionability === "DRAFTABLE" ? row : null,
              executableIdentity: detail.executableIdentity ?? "NONE",
              sourceSubtype: detail.sourceSubtype ?? null,
            }];
          } catch {
            return [];
          }
        }
        if (anchored.length === 1) return anchored;
        return ids.length === 1 ? pick(ids) : [];
      }
    }
  }

  /**
   * The closed intents the lane answers without the planner. `null` ⇒ not one of them.
   * Tone revision: same inquiry (or review), same evidence, one new draft version, zero reads.
   * Ordinal / label / pronoun selection (Agent Interaction Model v2 §2/§4): the row the sentence
   * points at inside the VISIBLE set becomes the anchor and is INSPECTED — never a re-query of the
   * org, never the same list printed again. Ambiguity shows the candidates; it never guesses.
   * Direct PREPARE (§13): 「뭐라고 답하면 좋을까」 over the anchored inquiry runs the product's own
   * draft path with no planner call.
   */
  private async directLane(
    view: ConversationView, text: string, hints: StartTurnRequest, bundle: SpringClientBundle,
    stage: (s: ProgressStage, label: string) => void, world: () => Promise<WorldState>,
  ): Promise<Composed | null> {
    // ── The knowledge answer, the tone revision and the two draft intents used to be the first four
    // branches of this lane. They are procedure TRANSITIONS — CAPTURE_KNOWLEDGE's resume step and
    // ANSWER_INQUIRY's revise/prepare steps — and they now run as those procedures' subgraphs, chosen
    // by the AOP router before this lane is asked (AOP Execution Closure v1 §3). What is left here is
    // dispatch: closed intents about the object on the table that no business procedure owns.
    // ── ACQUISITION (Chat-first Completion & Continuity v1 §1). An instruction to collect is a closed
    // action on a channel the conversation is already about — no plan can improve it and, measured live,
    // every plan made it worse: 「그럼 최신화해줘」 came back as a re-print of the same rows on one attempt
    // and as 「지금 먼저 하실 일은 없습니다」 on another, because the sentence names no object to route on.
    // The channel comes from the sentence or from the thread's focus; with neither, the planner keeps it.
    if (isAcquisitionRequest(text, { reviewsInContext: view.workingSet?.kind === "REVIEWS" })) {
      const channel = channelInSentence(text) ?? channelFocusOf(view.turns, text);
      // The channel's row comes from THIS turn's world — one snapshot, so the card and any sentence
      // beside it cannot be timed differently (`acquisitionStep.ts` names the defect that caused).
      const rows = channel ? (await world()).coverage : null;
      const known = rows ? rows.find((r) => r.dataType === "REVIEW" && r.channelCode.toUpperCase() === channel!.toUpperCase()) ?? null : null;
      const plan = channel
        ? await acquisitionPlanFor(bundle, channel, hints.localAgent ?? "UNKNOWN", this.now(), known)
        : null;
      // **The same instruction, a different action per channel — decided by CAPABILITY** (§3). An
      // AUTOMATIC channel is the product's own collection: it runs it and says what happened. Asking that
      // seller for a step would be asking for something that does not exist.
      if (plan?.kind === "AUTOMATIC") {
        const outcome = await new Refresher(bundle.inquiry).refresh(plan.accountId, "REVIEW");
        return {
          status: "DONE",
          message: outcome.ok
            ? `${plan.channelName} 리뷰를 새로 가져왔습니다.`
            : `${plan.channelName} 리뷰를 최신 상태로 갱신하지 못했습니다 (${REFRESH_FAILURE_LABEL[outcome.failure]}).`,
          artifacts: [], suggestedActions: [], workingSet: view.workingSet,
          pendingHumanActions: [], pendingPrepared: view.pendingPrepared,
          budget: { toolCalls: 2, llmCalls: 0, elapsedMs: 0, stopReason: "ACQUISITION" },
        };
      }
      // The instruction already happened: this card starts on arrival rather than asking for it again.
      const step = plan?.kind === "GUIDED"
        ? { ...plan, artifact: { ...plan.artifact, autoStart: true } }
        : null;
      if (step) {
        stage("WAITING_HUMAN", STAGE_LABEL.WAITING_HUMAN);
        return {
          status: "WAITING_HUMAN", message: step.message, artifacts: acquisitionArtifacts(step),
          suggestedActions: [],
          workingSet: view.workingSet,
          pendingHumanActions: [{
            turnId: "", actionType: step.artifact.actionType, path: step.artifact.path,
            channelCode: step.artifact.channelCode, accountId: step.artifact.accountId,
            dataType: step.artifact.dataType, requestedAt: step.artifact.requestedAt,
          }],
          pendingPrepared: view.pendingPrepared,
          budget: { toolCalls: 0, llmCalls: 0, elapsedMs: 0, stopReason: "ACQUISITION" },
        };
      }
    }

    // ── FRESHNESS (Chat-first Semantic & Surface Finalization v1 §1). 「오늘 네이버 리뷰 있어?」,
    // 「네이버 리뷰 최신이야?」, 「언제까지 확인했어?」 are three parts this product owns — the object it
    // stores, the channel whose coverage it knows, the period it can name — and nothing about them is
    // discovered by planning them. Planning them is where they went wrong: the same sentence failed once
    // across four QA passes and answered a checklist on another. So the closed shape is ROUTED here, not
    // recovered afterwards, and the lane reuses the coverage verdict, the as-of word and the rows
    // sentence rather than computing its own. Anything it cannot answer in full — a channel the product
    // could refresh, whose partial/failure/claim semantics the planner path owns — returns null and the
    // run proceeds exactly as before.
    const freshnessAsk = view.workingSet ? null : freshnessQuestionOf(text);
    if (freshnessAsk) {
      const answered = await answerFreshnessQuestion(
        bundle, freshnessAsk, channelInSentence(text) ?? channelFocusOf(view.turns, text),
        hints.localAgent ?? "UNKNOWN",
        // The run's OWN reference day, exactly as the graph reads it — a lane that asked the server clock
        // would judge 「오늘」 against a different day from the answer beside it.
        hints.referenceDate ? `${hints.referenceDate}T00:00:00.000Z` : this.now(),
      );
      if (answered) {
        if (answered.waiting) stage("WAITING_HUMAN", STAGE_LABEL.WAITING_HUMAN);
        return {
          status: answered.waiting ? "WAITING_HUMAN" : "DONE",
          message: answered.message,
          artifacts: [...answered.artifacts],
          suggestedActions: [...answered.suggestedActions],
          workingSet: answered.workingSet,
          pendingHumanActions: answered.pending
            ? [{
                turnId: "", actionType: answered.pending.actionType, path: answered.pending.path,
                channelCode: answered.pending.channelCode, accountId: answered.pending.accountId,
                dataType: answered.pending.dataType, requestedAt: answered.pending.requestedAt,
              }]
            : [],
          pendingPrepared: view.pendingPrepared,
          budget: { toolCalls: answered.toolCalls, llmCalls: 0, elapsedMs: 0, stopReason: "FRESHNESS" },
        };
      }
    }

    const set = pickSet(null, view);

    // ── A reference with no referent (Conversation Contract Correctness v2). 「그거 어떻게 처리하지?」
    // said with nothing on the table names no object and points at none. Planned anyway it became an
    // investigation of the org's ORDERS, its REVIEWS and a checklist — three subjects the seller never
    // mentioned, produced by a twelve-second model call. The tools a run may spend must be justified by
    // what the sentence names or by what is already on the table; when neither exists, the honest answer
    // is the question, and it costs no call at all.
    if (!set && !view.pendingPrepared && isReferenceOnly(text)) {
      log("conversation_reference_unresolved", { hadSet: false });
      return {
        status: "DONE", message: clarificationSentence("GENERAL"), artifacts: [],
        suggestedActions: [promptChip("답변 안 한 문의만 보여줘"), promptChip("최근 리뷰 보여줘")],
        workingSet: null, pendingHumanActions: [], pendingPrepared: null,
        budget: { toolCalls: 0, llmCalls: 0, elapsedMs: 0, stopReason: "NO_REFERENT" },
      };
    }

    let anchor = focusInquiryOf(set);
    // A screen launch that names a DIFFERENT inquiry is about that inquiry, not the thread's anchor —
    // the existing planner path resolves and verifies the hint (Contextual Agent Contract Completion v1).
    if (anchor && hints.workItemId && hints.workItemId !== anchor.workItemId) anchor = null;

    // ANALYZE and PREPARE over the anchored inquiry are ANSWER_INQUIRY's steps and run as that
    // procedure's subgraph. The judgement they carried — «a draftable object's advice IS the draft,
    // anything else gets the advisory» — is the procedure's terminal, not a branch here.

    // 「이 문의」 / 「이 고객」 / 「아까 그 문의」 — the anchored object, inspected. Zero planner, ≤1 read.
    if (anchor && pronounInspectOf(text)) {
      const resolved = inquiryTargetFromHistory(view, anchor.inquiryId) ?? await this.verifiedTarget(anchor.workItemId, bundle);
      if (resolved && resolved.kind === "INQUIRY") return this.inspect(view, resolved, bundle, null);
    }

    // 「이 리뷰 자세히 봐줘」 — the same lane for the other object (Agent Object v1). One exact READ of the
    // review the seller selected, no planner. It is here rather than in the graph because the planner has
    // no token for "this object": it expressed the sentence as review ROWS with limit 1, which read the
    // product's most recent review and answered a ★1 question with a ★5 (measured live 2026-09-01).
    const objectAnchor = set?.selectedObject ?? null;
    if (objectAnchor?.kind === "REVIEW" && pronounInspectOf(text)) {
      const inspected = await this.inspectReview(view, objectAnchor, bundle);
      if (inspected) return inspected;
    }

    const index = ordinalSelectionOf(text);
    if (index != null) {
      if (!set) return null;
      if (set.kind === "REVIEWS") {
        const id = set.ids[index - 1];
        const target = id ? reviewTargetFromHistory(view, id) : null;
        if (!target || target.kind !== "REVIEW") return null;
        // <b>Naming a row by its position is the same act as pressing it</b> — Pilot Readiness Closure
        // v1 §6. This branch used to narrow the set and say 「N번째 리뷰를 골랐습니다」, which is the
        // product telling the seller that something happened somewhere else: the click path and the
        // 「이 리뷰」 path both draw the review's own card, and an ordinal is neither more ambiguous nor
        // cheaper. One selection, one card, whichever way the seller pointed at the row.
        const object: SelectedObject = {
          kind: "REVIEW",
          id: id!,
          productId: target.target.productId ?? null,
          channelCode: target.target.channelCode ?? null,
        };
        const inspected = await this.inspectReview(view, object, bundle);
        if (inspected) return inspected;
        // The exact read failed. The selection is still real — it came from a row this thread drew —
        // so the anchor is kept and the card is not invented from the row's own fields.
        return {
          status: "DONE", message: `${index}번째 리뷰를 골랐습니다. 자세한 내용은 지금 불러오지 못했습니다.`,
          artifacts: [], suggestedActions: [promptChip("이 리뷰 답변해줘")],
          workingSet: anchoredObjectSet(object, set), pendingHumanActions: [],
          pendingPrepared: view.pendingPrepared, activeTask: "INSPECT",
          budget: { toolCalls: 0, llmCalls: 0, elapsedMs: 0, stopReason: "SELECTED" },
        };
      }
      const id = set.ids[index - 1];
      const target = id ? inquiryTargetFromHistory(view, id) : null;
      if (!target || target.kind !== "INQUIRY") {
        return {
          status: "DONE", message: `방금 본 목록에는 ${index}번째 문의가 없습니다.`, artifacts: [], suggestedActions: [],
          workingSet: view.workingSet, pendingHumanActions: [], pendingPrepared: view.pendingPrepared,
          budget: { toolCalls: 0, llmCalls: 0, elapsedMs: 0, stopReason: "SELECTED" },
        };
      }
      log("conversation_selected", { objectKind: "INQUIRY", index, actionability: target.actionability });
      return this.inspect(view, target, bundle, index);
    }

    // ── FILTER (Conversation Core v1): 「배송 관련 문의만 봐줘」 · 「네이버 것만」 · 「답변 안 한 것만」 ·
    // 「그중 최근 2개」 — a deterministic narrowing of the rows on screen. Zero model calls; bounded
    // detail reads only for a topic the row's own title cannot answer (the same in-process comparison
    // the workload filter makes). A sentence the closed grammar cannot fully consume is the planner's.
    // ── PRIORITIZE (§B): 「그중 급한 것부터」 · 「뭐부터 봐야 해?」 — the rows on screen, ordered by how
    // long each customer has waited, with the criterion said out loud. Zero reads, zero model calls.
    if (set?.kind === "INQUIRIES" && visiblePriorityOf(text)) {
      const ranked = await this.applyVisibleFilter(view, set, EMPTY_FILTER, bundle, true, hints.referenceDate);
      if (ranked) return ranked;
    }
    if (set?.kind === "INQUIRIES") {
      const filter = visibleFilterOf(text);
      if (filter) {
        const filtered = await this.applyVisibleFilter(view, set, filter, bundle);
        if (filtered) return filtered;
      }
    }

    // Label selection over the visible rows: 「배송 문의 봐줘」 · 「종이컵 문의」 · 「네이버 배송 문의」.
    if (set?.kind === "INQUIRIES") {
      const rows = this.visibleRowsOf(view, set);
      const selection = visibleSelectionOf(text, rows);
      if (selection.kind === "SELECTED") {
        const target = inquiryTargetFromHistory(view, selection.id);
        if (target && target.kind === "INQUIRY") {
          log("conversation_selected", { objectKind: "INQUIRY", by: "LABEL", actionability: target.actionability });
          return this.inspect(view, target, bundle, null);
        }
      }
      if (selection.kind === "AMBIGUOUS") {
        const items = selection.ids
          .map((rid) => inquiryFromHistory(view, rid))
          .filter((item): item is InquiryItem => item != null);
        if (items.length >= 2) {
          const narrowed: WorkingSetView = {
            kind: "INQUIRIES", label: "선택할 문의", count: items.length,
            ids: items.map((i) => i.inquiryId), filters: set.filters,
            productIds: [...new Set(items.map((i) => i.productId).filter((p): p is string => p != null))],
            workItemIds: items.map((i) => i.workItemId).filter((w): w is string => w != null), turnId: "",
          };
          log("conversation_selection_ambiguous", { candidates: items.length });
          const unanswered = items.filter((i) => i.status.toUpperCase() !== "ANSWERED");
          const answered = items.filter((i) => i.status.toUpperCase() === "ANSWERED");
          return {
            status: "DONE", message: `말씀하신 조건에 맞는 문의가 ${items.length}건입니다. 하나를 골라 주세요.`,
            artifacts: [{
              artifactId: "a-select-candidates", type: "INQUIRY_LIST", title: "선택할 문의",
              groups: [
                ...(unanswered.length > 0 ? [{ key: "UNANSWERED" as const, label: "답변 필요", items: unanswered }] : []),
                ...(answered.length > 0 ? [{ key: "ANSWERED" as const, label: "답변함", items: answered }] : []),
              ],
              totalCount: items.length,
            }],
            suggestedActions: [promptChip("첫 번째 거"), promptChip("두 번째 거")],
            workingSet: narrowed, pendingHumanActions: [], pendingPrepared: view.pendingPrepared, activeTask: null,
            budget: { toolCalls: 0, llmCalls: 0, elapsedMs: 0, stopReason: "SELECTION_AMBIGUOUS" },
          };
        }
      }
    }
    return null;
  }

  /** The rows the seller can currently see, from the persisted artifacts — never a new read. */
  private visibleRowsOf(view: ConversationView, set: WorkingSetView): VisibleRow[] {
    return set.ids
      .map((id) => inquiryFromHistory(view, id))
      .filter((item): item is InquiryItem => item != null)
      .map((item) => ({
        id: item.inquiryId, title: item.title ?? null, productName: item.productName,
        channelCode: item.channelCode, channelNameKo: item.channelNameKo,
      }));
  }

  /** A row this conversation never showed, verified by the same org-scoped READ the runtime uses. */
  private async verifiedTarget(workItemId: string | null, bundle: SpringClientBundle): Promise<ResolvedTarget | null> {
    if (!workItemId) return null;
    try {
      const detail = await bundle.inquiry.getInquiryDetail(workItemId);
      const row = {
        workItemId: detail.workItemId, inquiryId: detail.inquiryId, channelCode: detail.channelCode,
        channelNameKo: detail.channelNameKo, productId: detail.productId ?? null, productName: detail.productName ?? null,
      };
      const actionability = actionabilityOf({ workItemId: detail.workItemId, phase: detail.phase, status: detail.status });
      return {
        kind: "INQUIRY",
        inquiry: { ...row, title: detail.title ?? null, status: detail.status, receivedAt: detail.receivedAt ?? null, snippet: detail.details ?? null },
        actionability,
        target: actionability === "DRAFTABLE" ? row : null,
        executableIdentity: detail.executableIdentity ?? "NONE",
        sourceSubtype: detail.sourceSubtype ?? null,
      };
    } catch {
      return null;
    }
  }

  /**
   * A clicked PRODUCT, verified.
   *
   * The thread's own record first — a product this conversation drew came out of an org-scoped read and
   * needs no second one. Only an id the thread cannot account for costs a read, and it is the same read
   * a product-screen launch makes (`OperatorAgentRuntime.contextEntities`): another org's id, a deleted
   * row and a typo all come back as a failure, and a failure changes nothing.
   */
  private async verifiedProduct(
    view: ConversationView, productId: string, bundle: SpringClientBundle,
  ): Promise<SelectedObject | null> {
    if (productFromHistory(view, productId)) {
      return { kind: "PRODUCT", id: productId, productId, channelCode: null };
    }
    try {
      const signals = await bundle.operator.getProductSignals(productId);
      return { kind: "PRODUCT", id: signals.productId, productId: signals.productId, channelCode: null };
    } catch {
      return null;
    }
  }

  /**
   * The ONE inquiry the sentence's own subject word names, or null — the PREPARE precondition read.
   *
   * Bounded and org-scoped: the same work-queue read the plan would have made, narrowed by the term the
   * closed extractor took from the seller's sentence (`subjectTerm.ts`). Zero or several matches return
   * null, and the turn asks which one; a read that fails returns null too, so the worst case is the
   * behaviour before this existed.
   */
  private async locateBySubject(
    text: string, topic: PlanFilters["topic"], bundle: SpringClientBundle,
  ): Promise<ResolvedTarget | null> {
    // The sentence's OWN narrowing, in whichever vocabulary carries it: the closed topic family the
    // planner named, or the subject word the extractor took. Never both — a topic already names the
    // subject, and narrowing by the same noun twice is one narrowing said twice.
    const family = topic && topic !== "OTHER" ? topic : null;
    const term = family ? null : subjectTermOf(text);
    if (!family && !term) return null;
    try {
      const found = await listInquiryWorkload(bundle.inquiry, { term, topic: family, maxDetailReads: FILTER_DETAIL_CAP });
      if (found.items.length !== 1) return null;
      const one = found.items[0]!;
      log("conversation_prepare_located", { by: "SUBJECT_TERM", candidates: found.items.length });
      return await this.verifiedTarget(one.workItemId, bundle);
    } catch {
      return null;
    }
  }

  /** The direct PREPARE over one resolved inquiry — shared by the PREPARE and ANALYZE(DRAFTABLE) lanes. */
  private async directPrepare(
    view: ConversationView, resolved: Extract<ResolvedTarget, { kind: "INQUIRY" }>, bundle: SpringClientBundle,
    stage: (s: ProgressStage, label: string) => void,
  ): Promise<Composed> {
    const started = Date.now();
    const captureAllowed = !lastTurnSavedCapture(view);
    const one = await this.prepareOneInquiry(resolved, null, bundle, stage, captureAllowed, null);
    const workingSet = anchoredSet(resolved.inquiry, view.workingSet, [
      ...(view.workingSet?.productIds ?? []), ...(resolved.inquiry.productId ? [resolved.inquiry.productId] : []),
    ]);
    log("conversation_direct_prepare", { actionability: resolved.actionability, captureOpened: one.pendingCapture != null });
    return {
      status: "DONE", message: one.headline ?? "답변 초안을 준비했습니다.",
      artifacts: one.artifacts,
      // (No chips beside a prepared draft: the card's own two controls are those actions.)
      suggestedActions: [],
      workingSet, pendingHumanActions: [], pendingPrepared: one.pendingPrepared ?? view.pendingPrepared,
      ...(one.pendingCapture !== undefined ? { pendingCapture: one.pendingCapture } : {}),
      activeTask: one.pendingCapture ? "CAPTURE_KNOWLEDGE" : one.pendingPrepared ? "PREPARE_REPLY" : view.activeTask ?? null,
      budget: { toolCalls: 1, llmCalls: one.pendingPrepared ? 1 : 0, elapsedMs: Date.now() - started, stopReason: "DIRECT_PREPARE" },
    };
  }

  /**
   * FILTER (Conversation Core v1): narrow the VISIBLE inquiry rows by closed axes — channel · topic ·
   * status · order · limit — with no planner and no org re-read. Topic matching reads the row's own
   * persisted title/product name first; a row that cannot answer from its title spends one bounded
   * detail READ (in-process comparison, never persisted — the same rule the workload filter follows).
   * `null` ⇒ the sentence asks for more than the set can carry (a larger limit) and the planner decides.
   */
  private async applyVisibleFilter(
    view: ConversationView, set: WorkingSetView, filter: VisibleFilter, bundle: SpringClientBundle,
    urgency = false, referenceDate?: string,
  ): Promise<Composed | null> {
    const started = Date.now();
    const rows = set.ids
      .map((id) => inquiryFromHistory(view, id))
      .filter((item): item is InquiryItem => item != null);
    if (rows.length === 0) return null;
    // Persistence bounds the rows a thread keeps; a set this lane cannot fully see is the planner's
    // WORKING_SET re-read — filtering a fifth of the rows would be a silently wrong answer.
    if (rows.length < set.ids.length) return null;
    // A limit larger than the set cannot be a refine of it (scopeOverride's NEW_LIMIT, same rule here).
    if (filter.limit != null && filter.limit > rows.length) return null;

    let detailReads = 0;
    const matched: InquiryItem[] = [];
    for (const row of rows) {
      if (filter.channel && (row.channelCode ?? "").toUpperCase() !== filter.channel) continue;
      if (filter.status === "UNANSWERED" && row.status.toUpperCase() === "ANSWERED") continue;
      if (filter.status === "ANSWERED" && row.status.toUpperCase() !== "ANSWERED") continue;
      if (filter.topic) {
        let hit = matchesTopic(filter.topic, [row.title, row.productName]);
        if (!hit && row.workItemId && detailReads < FILTER_DETAIL_CAP) {
          detailReads += 1;
          try {
            const detail = await bundle.inquiry.getInquiryDetail(row.workItemId);
            hit = matchesTopic(filter.topic, [detail.title, detail.details]);
          } catch {
            hit = false;
          }
        }
        if (!hit) continue;
      }
      // The seller's own subject word over the rows on screen — the row's own text first (its subject
      // line, its product, the snippet it was drawn with), then one bounded detail read.
      if (filter.term) {
        let hit = matchesTerm(filter.term, [row.title, row.productName, row.snippet]);
        if (!hit && row.workItemId && detailReads < FILTER_DETAIL_CAP) {
          detailReads += 1;
          try {
            const detail = await bundle.inquiry.getInquiryDetail(row.workItemId);
            hit = matchesTerm(filter.term, [detail.title, detail.details]);
          } catch {
            hit = false;
          }
        }
        if (!hit) continue;
      }
      matched.push(row);
    }
    if (urgency) {
      // The longest wait first — the one urgency signal this product holds (`urgency.ts`).
      matched.splice(0, matched.length, ...rankByUrgency(matched));
    } else if (filter.order) {
      matched.sort((a, b) => filter.order === "OLDEST"
        ? a.receivedAt.localeCompare(b.receivedAt)
        : b.receivedAt.localeCompare(a.receivedAt));
    }
    const kept = filter.limit != null ? matched.slice(0, filter.limit) : matched;

    const budget = { toolCalls: detailReads, llmCalls: 0, elapsedMs: Date.now() - started, stopReason: urgency ? "VISIBLE_PRIORITY" : "VISIBLE_FILTER" };
    const desc = filterWords(filter);
    const orderWord = filter.order === "OLDEST" ? "가장 오래된" : "가장 최근";
    const today = (referenceDate ?? this.now()).slice(0, 10);
    log("conversation_visible_filter", {
      axes: [filter.channel && "channel", filter.topic && "topic", filter.term && "term", filter.status && "status", filter.limit != null && "limit", filter.order && "order", urgency && "urgency"].filter(Boolean).join(","),
      of: rows.length, matched: kept.length, detailReads,
    });
    if (kept.length === 0) {
      // R2: a filter that left nothing keeps the previous set as the anchor — 「없습니다」 is the answer.
      return {
        status: "DONE", message: `방금 본 문의 ${rows.length}건 중 ${desc}문의는 없습니다.`,
        artifacts: [], suggestedActions: [promptChip("답변 안 한 문의만 보여줘")],
        workingSet: view.workingSet, pendingHumanActions: [], pendingPrepared: view.pendingPrepared, budget,
      };
    }
    const message = urgency
      ? `방금 본 문의 ${kept.length}건을 먼저 볼 순서로 정리했습니다. ${URGENCY_CRITERION} ${URGENCY_LIMIT}`
      : desc.length === 0 && filter.limit != null
        ? `방금 본 문의 ${rows.length}건 중 ${orderWord} ${kept.length}건입니다.`
        : filter.limit != null && matched.length > kept.length
          ? `방금 본 문의 ${rows.length}건 중 ${desc}문의는 ${matched.length}건이고, 그중 ${orderWord} ${kept.length}건입니다.`
          : `방금 본 문의 ${rows.length}건 중 ${desc}문의는 ${kept.length}건입니다.`;

    // Consecutive runs of the same answered state become one group each — the rows step's own rule.
    const groups: Array<{ key: "UNANSWERED" | "ANSWERED"; label: string; items: InquiryItem[] }> = [];
    for (const row of kept) {
      const key = row.status.toUpperCase() === "ANSWERED" ? "ANSWERED" as const : "UNANSWERED" as const;
      const shown: InquiryItem = urgency ? { ...row, waitingDays: waitingDaysOf(row.receivedAt, today) } : row;
      const last = groups.at(-1);
      if (last && last.key === key) last.items.push(shown);
      else groups.push({ key, label: key === "UNANSWERED" ? "답변 필요" : "답변함", items: [shown] });
    }
    const title = urgency
      ? "먼저 볼 문의"
      : desc.length === 0 && filter.limit != null
        ? `방금 본 문의 중 ${orderWord} ${kept.length}건`
        : `방금 본 문의 중 ${desc}문의${filter.limit != null && matched.length > kept.length ? ` · ${orderWord} ${kept.length}건` : ""}`;
    const artifact: InquiryListArtifact = {
      artifactId: `a-filter-${randomUUID()}`, type: "INQUIRY_LIST", title, groups, totalCount: kept.length,
      scope: {
        period: set.filters.period ?? null,
        channelCode: filter.channel ?? set.filters.channelCode ?? null,
        status: filter.status ?? set.filters.status ?? "ALL",
        order: filter.order ?? set.filters.order ?? "NEWEST",
        limit: filter.limit,
        ...(filter.term ? { term: filter.term } : {}),
        ...(urgency ? { rank: "URGENCY" as const } : {}),
      },
      more: { label: "문의 화면에서 보기", to: "/inquiries", count: kept.length },
    };
    const workingSet: WorkingSetView = {
      kind: "INQUIRIES", label: title, count: kept.length,
      ids: kept.map((i) => i.inquiryId).slice(0, WORKING_SET_MAX_IDS),
      filters: {
        ...(set.filters.period ? { period: set.filters.period } : {}),
        channelCode: filter.channel ?? set.filters.channelCode ?? null,
        ...(filter.status ? { status: filter.status } : set.filters.status ? { status: set.filters.status } : {}),
        order: filter.order ?? set.filters.order ?? "NEWEST",
        ...(filter.topic ? { topic: filter.topic } : set.filters.topic ? { topic: set.filters.topic } : {}),
        ...(filter.term ? { term: filter.term } : set.filters.term ? { term: set.filters.term } : {}),
        inquiryIntent: set.filters.inquiryIntent ?? "ROWS",
      },
      productIds: [...new Set(kept.map((i) => i.productId).filter((p): p is string => p != null))].slice(0, WORKING_SET_MAX_IDS),
      workItemIds: kept.map((i) => i.workItemId).filter((w): w is string => w != null).slice(0, WORKING_SET_MAX_IDS),
      turnId: "",
    };
    return {
      status: "DONE",
      message,
      artifacts: [artifact],
      suggestedActions: [
        promptChip("첫 번째 거 답변 준비해줘"),
        ...(filter.status !== "UNANSWERED" ? [promptChip("답변 안 한 것만 보여줘")] : []),
      ],
      workingSet, pendingHumanActions: [], pendingPrepared: view.pendingPrepared, activeTask: null, budget,
    };
  }

  /**
   * INSPECT for the OTHER object (Agent Object v1 §1): the selected review, read exactly.
   *
   * The same shape as {@link inspect} — one read, the object's own card, the anchor kept, zero planner
   * and zero model calls. `null` when the read failed: a card assembled from the anchor's own fields
   * would be this runtime describing a review it could not read, so the turn falls through to the
   * planner instead of inventing one.
   */
  private async inspectReview(
    view: ConversationView, object: SelectedObject, bundle: SpringClientBundle,
  ): Promise<Composed | null> {
    if (!bundle.operator.getReviewDetail) return null;
    let detail: ReviewDetailResponse;
    try {
      detail = await bundle.operator.getReviewDetail(object.id);
    } catch {
      return null;
    }
    const replyCapability = await this.reviewReplyCapability(bundle, detail);
    const artifact: ReviewDetailArtifact = {
      artifactId: `a-review-${detail.id}`, type: "REVIEW_DETAIL", title: "선택한 리뷰",
      reviewId: detail.id, channelCode: detail.channelCode, channelNameKo: detail.channelNameKo,
      writtenOn: detail.writtenOn, rating: detail.rating, negative: detail.negative,
      productId: detail.productId, productName: detail.productName,
      body: detail.body ? excerpt(detail.body) : null,
      ...(detail.bodyRedacted ? { bodyRedacted: true } : {}),
      issues: detail.issues.map((i) => ({ issueId: i.issueId, title: i.title, severity: i.severity, to: `/memory/${i.issueId}` })),
      replyCapability,
      to: "/reviews",
    };
    log("conversation_review_inspect", { issues: detail.issues.length, rating: detail.rating ?? -1, replyCapability });
    return {
      status: "DONE",
      message: `${reviewLine(detail)} 리뷰입니다. ${issueSentence(detail)}`,
      artifacts: [artifact],
      suggestedActions: [promptChip("같은 상품의 비슷한 리뷰도 보여줘")],
      workingSet: anchoredObjectSet(object, view.workingSet),
      pendingHumanActions: [], pendingPrepared: view.pendingPrepared, activeTask: "INSPECT",
      budget: { toolCalls: replyCapability === "UNKNOWN" ? 1 : 2, llmCalls: 0, elapsedMs: 0, stopReason: "SELECTED" },
    };
  }

  /**
   * Can the seller reply to THIS review at its channel? — Pilot Readiness Closure v1 §6.
   *
   * <b>UNKNOWN was a budget decision, not an honest one.</b> This lane used to hardcode it because it
   * had chosen to make one read; the consequence was a card that never offered the reply control on
   * the path a seller actually reaches by clicking a row, while the planner path offered it for the
   * same review. The answer is a second org-scoped READ against the account the review came in on —
   * the same `capabilityOf` resolver, over the same view, that every other execution decision uses.
   *
   * <b>What is still not guessed.</b> An absent capability view resolves to NOT_SUPPORTED inside
   * `reviewExecutionOf` (correctly, for a fail-closed execution decision), but this card is not an
   * execution decision — it is a description. So a read that answers nothing stays UNKNOWN: 「확인하지
   * 못했습니다」 and 「지원하지 않습니다」 are different claims and only one of them was observed.
   */
  private async reviewReplyCapability(
    bundle: SpringClientBundle, detail: ReviewDetailResponse,
  ): Promise<ReviewReplyCapability> {
    const code = (detail.channelCode ?? "").toUpperCase();
    if (!code || !detail.sellerAccountId || !bundle.operator.getReviewChannelCapability) {
      return "UNKNOWN";
    }
    let reviewChannel: Awaited<ReturnType<NonNullable<typeof bundle.operator.getReviewChannelCapability>>> | null = null;
    try {
      reviewChannel = (await bundle.operator.getReviewChannelCapability(detail.sellerAccountId)) ?? null;
    } catch {
      return "UNKNOWN";
    }
    if (!reviewChannel) return "UNKNOWN";
    const verdict = capabilityOf(
      { channelCode: code, objectKind: "REVIEW" },
      { overview: null, transports: null, publish: null, reviewChannel, localAgent: "UNKNOWN" },
    );
    return verdict.execution === "NOT_SUPPORTED" ? "NOT_SUPPORTED" : "DRAFTABLE";
  }

  /**
   * INSPECT (§4): the selected inquiry as one compact object — the row's own closed facts plus a
   * bounded excerpt of the customer's message (one READ when the row has a work item; the excerpt is
   * transient and never persisted). No org re-query, no list re-print, no workload conversion.
   */
  private async inspect(
    view: ConversationView, resolved: Extract<ResolvedTarget, { kind: "INQUIRY" }>, bundle: SpringClientBundle,
    index: number | null,
  ): Promise<Composed> {
    const row = resolved.inquiry;
    // What the customer wrote, always: the bounded snippet the row was DRAWN with stands in when there
    // is no work item to read (an answered inquiry has none), so selecting a row never shows a title and
    // nothing — the defect PO QA named as 「본문이 바로 보이지 않음」.
    let excerptText: string | null = row.snippet ? excerpt(row.snippet) : null;
    let reads = 0;
    if (row.workItemId) {
      try {
        reads += 1;
        const detail = await bundle.inquiry.getInquiryDetail(row.workItemId);
        const fuller = excerpt(detail.details ?? detail.title ?? null);
        if (fuller.length > 0) excerptText = fuller;
      } catch {
        // The row's own snippet stands; a failed read costs the fuller text and nothing else.
      }
    }
    const detailArtifact = inquiryDetailArtifact(row, resolved.actionability, excerptText);
    const workingSet = anchoredSet(row, view.workingSet, [
      ...(view.workingSet?.productIds ?? []), ...(row.productId ? [row.productId] : []),
    ]);
    const head = index != null ? `${index}번째 문의입니다.` : "이 문의를 보고 있습니다.";
    return {
      status: "DONE", message: `${head} ${INSPECT_SENTENCE[resolved.actionability]}`,
      artifacts: [detailArtifact],
      suggestedActions: [
        ...(resolved.actionability === "DRAFTABLE" ? [promptChip("답변 준비해줘")] : []),
        ...(row.productId ? [promptChip("이 상품 기준으로 답변 준비해줘")] : []),
        promptChip("답변 안 한 문의만 보여줘"),
      ],
      workingSet, pendingHumanActions: [], pendingPrepared: view.pendingPrepared, activeTask: "INSPECT",
      budget: { toolCalls: reads, llmCalls: 0, elapsedMs: 0, stopReason: "SELECTED" },
    };
  }

  /**
   * ONE inquiry through the product's own draft path — the shared PREPARE step behind both the
   * planner's PREPARE_INQUIRY_DRAFT and the direct 「뭐라고 답하면 좋을까」 lane. Actionability gate
   * first (no read, no model call for a non-workable row), then propose→generate, then — on a
   * NO_ANSWER_BASIS — the Knowledge Capture question when the composer named ONE askable fact.
   */
  private async prepareOneInquiry(
    resolved: Extract<ResolvedTarget, { kind: "INQUIRY" }>, tone: ToneHint | null, bundle: SpringClientBundle,
    stage: (s: ProgressStage, label: string) => void, captureAllowed: boolean, plannerTopic: string | null,
  ): Promise<{
    artifacts: Artifact[]; headline: string | null; pendingPrepared?: PendingPreparedAction;
    pendingCapture?: PendingKnowledgeCapture | null;
  }> {
    // The ANSWER_INQUIRY precondition — asked HERE and nowhere else (Agent Procedure Layer v1 §2).
    // An answered, in-flight or unworkable inquiry gets its state said: no proposal, no retrieval, no
    // model call (found live: READ ×4 + one draft call, then a 409).
    const target = resolved.target;
    const gate = inquiryDraftPrecondition(resolved.actionability, target != null);
    // (`target == null` repeats the argument the gate was given — it is the compiler's narrowing, not a
    // second judgement; the decision is the gate's.)
    if (!gate.ok || target == null) {
      const line = objectRefusalSentence("ANSWER_INQUIRY", "NOT_ACTIONABLE", resolved.actionability, "");
      return { artifacts: [inquiryStateSummary(resolved.inquiry, line)], headline: line };
    }
    stage("PREPARING_DRAFT", STAGE_LABEL.PREPARING_DRAFT);
    let draft: DraftArtifact;
    let generated: GeneratedDraftView | null = null;
    try {
      const prepared = await new DraftPreparer(bundle.inquiry, bundle.review).prepareWithView(target, tone, `a-draft-${target.workItemId}`);
      draft = prepared.artifact;
      generated = prepared.view;
    } catch (err) {
      // The draft path refused (a phase the gate could not see, a backend outage): said as a
      // sentence on a DONE turn — never a vanished turn. The vendor/backend text stays out.
      log("conversation_draft_failed", { objectKind: "INQUIRY", error: err instanceof Error ? err.name : "unknown" });
      return { artifacts: [inquiryStateSummary(resolved.inquiry, DRAFT_FAILED_SENTENCE)], headline: DRAFT_FAILED_SENTENCE };
    }
    const artifacts: Artifact[] = [draft];
    if (draft.unavailableMessage) return { artifacts, headline: draft.unavailableMessage };
    if (draft.answerBasis === "NO_ANSWER_BASIS" || !draft.version) {
      // ① what is missing (the backend's own sentence) ② the one next step. The card's title says
      // 「답변 기준이 필요합니다」 once; the prose does not say it a second time.
      const specificNote = draft.answerBasisNote && !GENERIC_BASIS_NOTE.test(draft.answerBasisNote) ? draft.answerBasisNote : null;
      // Knowledge Capture v1: when the composer's own verdict names ONE fact the seller can state,
      // ask for it here — a specific question, held open for the next sentence — instead of only
      // pointing at a screen. NOT_APPLICABLE never asks for the same rule again (`captureGapOf`).
      const gap = captureAllowed ? captureGapOf(generated?.knowledgeGap, {
        inquiryId: target.inquiryId, workItemId: target.workItemId, productId: target.productId, productName: target.productName, tone,
      }, plannerTopic) : null;
      if (gap) {
        const opened = this.openCapture(gap, { kind: "INQUIRY_DRAFT", workItemId: target.workItemId, inquiryId: target.inquiryId, tone });
        artifacts.push(captureArtifact(opened, "ASKED", {}));
        log("conversation_capture_asked", { scope: gap.scope, topic: gap.topic ?? gap.knowledgeType, variantRequired: gap.variantRequired });
        return {
          artifacts, pendingCapture: opened,
          headline: [specificNote, gap.question].filter((line): line is string => !!line && line.trim().length > 0).join(" "),
        };
      }
      artifacts.push({
        artifactId: `a-knowledge-${target.workItemId}`, type: "HUMAN_ACTION_REQUIRED",
        title: "답변 기준 추가",
        actionType: "KNOWLEDGE_ENTRY", reason: "NO_ANSWER_BASIS", path: "WORKSPACE",
        channelCode: target.channelCode, channelNameKo: target.channelNameKo, accountId: null,
        dataType: "INQUIRY", to: `/inquiries/${target.inquiryId}`, requestedAt: this.now(), resumable: false,
      });
      return {
        artifacts,
        headline: [specificNote, draft.answerBasisAction ?? "답변 기준을 하나 더 등록하면 초안을 만들 수 있습니다."]
          .filter((line): line is string => !!line && line.trim().length > 0).join(" "),
      };
    }
    // A tone variant that moved a fact: refused, previous head kept, and said so.
    if (draft.note && !draft.tone) return { artifacts, headline: draft.note };
    // A draft that asks the customer back is said as that — the seller must not read a question
    // as a short answer (Core Daily Loop UX v1; Response Hygiene v1 §2).
    const asksBack = draft.answerBasis === "NEEDS_CLARIFICATION";
    return {
      artifacts,
      headline: tone ? "말투를 바꿔 초안을 다시 준비했습니다."
        : asksBack ? "고객에게 되묻는 답변 초안을 준비했습니다." : "답변 초안을 준비했습니다.",
      pendingPrepared: {
        turnId: "", kind: "INQUIRY_DRAFT", workItemId: target.workItemId, inquiryId: target.inquiryId,
        draftVersion: draft.version, contentFingerprint: draft.contentFingerprint,
      },
    };
  }

  /**
   * A click on a shown row (§3/§9): the SAME anchor transition a typed selection makes, persisted with
   * the conversation and appended to the transcript as nothing — the row's own highlight is the
   * feedback. An id the thread never showed is a hint, not a fact: one org-scoped READ verifies it
   * (the same rule a screen-launch `workItemId` follows), and an unverifiable id changes nothing.
   */
  private async applyClickSelection(
    view: ConversationView, select: NonNullable<StartTurnRequest["select"]>, bundle: SpringClientBundle,
    store: ConversationStore, started: number,
  ): Promise<TurnView> {
    const respond = (workingSet: WorkingSetView | null, activeTask: ActiveTask | null): TurnView => ({
      turnId: `select-${randomUUID()}`, conversationId: view.conversationId, role: "AGENT",
      message: "", artifacts: [], suggestedActions: [],
      continuation: {
        workingSet, pendingHumanAction: view.pendingHumanAction, pendingHumanActions: pendingActionsOf(view),
        pendingPrepared: view.pendingPrepared, pendingCapture: view.pendingCapture ?? null, activeTask,
      },
      status: "DONE", createdAt: this.now(),
    });
    // Working Context v1 §1: leaving the anchor. The set the seller is looking at stays exactly as it
    // is — only the ONE selected inquiry and the task in flight are dropped, and a capture that was
    // held open for that inquiry goes with it (the same rule a move to another inquiry applies).
    if (select.kind === "CLEAR") {
      const set = view.workingSet;
      // Both anchors, because there is only ever one: 「해제」 on a product must not leave an inquiry
      // anchor the bar had stopped naming.
      const cleared = set ? { ...set, selectedInquiry: null, selectedObject: null } : null;
      const pendingCapture = carriedCapture(view.pendingCapture ?? null, cleared);
      await this.persist(store, view, [], cleared, pendingActionsOf(view), view.pendingPrepared, pendingCapture, null);
      log("conversation_turn", {
        status: "DONE", toolCalls: 0, llmCalls: 0, ms: Date.now() - started,
        artifactTypes: "", workingSetKind: cleared?.kind ?? "", requestedAction: "CLEAR_SELECT",
      });
      return respond(cleared, null);
    }
    // A PRODUCT or a REVIEW anchor — the same transition, verified by what can actually prove it.
    if (select.kind === "PRODUCT" || select.kind === "REVIEW") {
      const object = select.kind === "PRODUCT"
        ? await this.verifiedProduct(view, select.productId, bundle)
        : verifiedReview(view, select.reviewId);
      if (!object) {
        log("conversation_select_unresolved", {});
        return respond(view.workingSet, view.activeTask ?? null);
      }
      const workingSet = anchoredObjectSet(object, view.workingSet);
      // A capture is held open for an inquiry; standing on another object leaves that inquiry.
      const pendingCapture = carriedCapture(view.pendingCapture ?? null, workingSet);
      await this.persist(store, view, [], workingSet, pendingActionsOf(view), view.pendingPrepared, pendingCapture, "INSPECT");
      log("conversation_turn", {
        status: "DONE", toolCalls: select.kind === "PRODUCT" ? 1 : 0, llmCalls: 0, ms: Date.now() - started,
        artifactTypes: "", workingSetKind: workingSet.kind, requestedAction: "CLICK_SELECT",
      });
      return respond(workingSet, "INSPECT");
    }
    const resolved = inquiryTargetFromHistory(view, select.inquiryId) ?? await this.verifiedTarget(select.workItemId ?? null, bundle);
    if (!resolved || resolved.kind !== "INQUIRY" || resolved.inquiry.inquiryId !== select.inquiryId) {
      log("conversation_select_unresolved", {});
      return respond(view.workingSet, view.activeTask ?? null);
    }
    const workingSet = anchoredSet(resolved.inquiry, view.workingSet, [
      ...(view.workingSet?.productIds ?? []), ...(resolved.inquiry.productId ? [resolved.inquiry.productId] : []),
    ]);
    // A capture held open for a DIFFERENT inquiry drops when the seller moves (the same rule a turn applies).
    const pendingCapture = carriedCapture(view.pendingCapture ?? null, workingSet);
    await this.persist(store, view, [], workingSet, pendingActionsOf(view), view.pendingPrepared, pendingCapture, "INSPECT");
    log("conversation_turn", {
      status: "DONE", toolCalls: 0, llmCalls: 0, ms: Date.now() - started,
      artifactTypes: "", workingSetKind: workingSet.kind, requestedAction: "CLICK_SELECT",
    });
    return respond(workingSet, "INSPECT");
  }

  /**
   * What a refused ANSWER_REVIEW precondition looks like on screen — one composer, so the two callers
   * cannot drift into saying different things about the same channel verdict.
   */
  private reviewRefusal(
    target: ReviewDraftTarget, absence: "NOT_SUPPORTED" | Exclude<ReturnType<typeof reviewDraftPrecondition>, { ok: true }>["absence"],
  ): { artifact: Artifact; headline: string; chips: SuggestedAction[] } {
    const channel = target.channelNameKo ?? target.channelCode ?? "이 채널";
    if (absence === "NOT_SUPPORTED") {
      return {
        artifact: reviewUnsupportedSummary(target),
        headline: objectRefusalSentence("ANSWER_REVIEW", absence, "DRAFTABLE", summaryLineFor(target.channelCode)),
        chips: REVIEW_UNSUPPORTED_CHIPS.map(promptChip),
      };
    }
    // Acceptance Closure §10: a channel whose reply semantics could not be read gets no draft — a draft
    // for a place that may not exist is the Coupang loophole by another door.
    const line = objectRefusalSentence("ANSWER_REVIEW", absence, "DRAFTABLE", channel);
    return {
      artifact: reasonSummary(`a-cap-${target.reviewId}`, "리뷰 답글 초안을 준비하지 않았습니다", [line]),
      headline: line, chips: [],
    };
  }

  /** The tone-revision lane: the draft on the table, one closed tone token, the same object. No planner, no read. */
  private async reviseTone(
    view: ConversationView, prepared: PendingPreparedAction, tone: ToneHint, bundle: SpringClientBundle,
    stage: (s: ProgressStage, label: string) => void,
  ): Promise<Composed> {
    const started = Date.now();
    const preparer = new DraftPreparer(bundle.inquiry, bundle.review);
    const keep = (message: string, artifacts: Artifact[], pendingPrepared: PendingPreparedAction | null): Composed => ({
      status: "DONE", message, artifacts, suggestedActions: suggestionsFor(artifacts[0] ?? null, view.workingSet, null, artifacts),
      workingSet: view.workingSet, pendingHumanActions: [], pendingPrepared,
      budget: { toolCalls: 0, llmCalls: 0, elapsedMs: Date.now() - started, stopReason: "TONE_REVISION" },
    });
    log("conversation_tone_revision", { objectKind: prepared.kind === "REVIEW_DRAFT" ? "REVIEW" : "INQUIRY", tone });
    stage("PREPARING_DRAFT", STAGE_LABEL.PREPARING_DRAFT);
    if (prepared.kind === "REVIEW_DRAFT") {
      const resolved = reviewTargetFromHistory(view, prepared.workItemId);
      if (!resolved || resolved.kind !== "REVIEW") return keep(NO_DRAFT_TO_REVISE_SENTENCE, [], prepared);
      const verdict = await this.reviewCapability(bundle, resolved.target);
      // The same gate the PREPARE path asks. Before this layer this lane asked nothing and revised the
      // tone of a draft for a channel that cannot take one.
      const gate = reviewDraftPrecondition(verdict);
      if (!gate.ok) {
        const refused = this.reviewRefusal(resolved.target, gate.absence);
        return keep(refused.headline, [refused.artifact], prepared);
      }
      const draft = await preparer.prepareReview(resolved.target, tone, `a-draft-${resolved.target.reviewId}`, verdict);
      if (draft.note && !draft.tone) return keep(draft.note, [draft], prepared);
      return keep("말투를 바꿔 리뷰 답글 초안을 다시 준비했습니다.", [draft], {
        turnId: "", kind: "REVIEW_DRAFT", workItemId: resolved.target.reviewId, inquiryId: resolved.target.actionRef,
        accountId: resolved.target.accountId, draftVersion: draft.version, contentFingerprint: draft.contentFingerprint,
      });
    }
    const resolved = inquiryTargetFromHistory(view, prepared.workItemId);
    if (!resolved || resolved.kind !== "INQUIRY" || !resolved.target) return keep(NO_DRAFT_TO_REVISE_SENTENCE, [], prepared);
    let draft: DraftArtifact;
    try {
      draft = await preparer.prepare(resolved.target, tone, `a-draft-${resolved.target.workItemId}`);
    } catch (err) {
      log("conversation_draft_failed", { objectKind: "INQUIRY", error: err instanceof Error ? err.name : "unknown" });
      return keep(DRAFT_FAILED_SENTENCE, [inquiryStateSummary(resolved.inquiry, DRAFT_FAILED_SENTENCE)], prepared);
    }
    if (draft.note && !draft.tone) return keep(draft.note, [draft], prepared);
    if (!draft.version) return keep(draft.unavailableMessage ?? draft.answerBasisNote ?? "답변 기준이 필요합니다.", [draft], prepared);
    return keep("말투를 바꿔 초안을 다시 준비했습니다.", [draft], {
      turnId: "", kind: "INQUIRY_DRAFT", workItemId: resolved.target.workItemId, inquiryId: resolved.target.inquiryId,
      draftVersion: draft.version, contentFingerprint: draft.contentFingerprint,
    });
  }

  /**
   * What reviewnary itself can do — the catalogue it is wired to, the channels it is connected to, and
   * the boundary it works inside (`operator/capability/AssistantCapability.ts`).
   *
   * <b>No model, and no list kept by hand.</b> The domains come from the same tool catalogue the runtime
   * builds for a run — constructing it is also the WRITE fence, since {@link OperatorToolRegistry}
   * throws on anything that is not READ — and the connected channels come from ONE org-scoped coverage
   * read, the same one every channel-aware answer makes. A read that fails costs the channel sentence
   * and nothing else: the rest of the answer is about this runtime and is true without it.
   */
  private async productSelfAnswer(
    view: ConversationView, bundle: SpringClientBundle, world: WorldState,
    aspect: CapabilityAspect, channel: string | null, envelope: ContextEnvelope, said: string,
  ): Promise<{ artifact: SummaryArtifact | null; headline: string; chips: SuggestedAction[] }> {
    const registry = new OperatorToolRegistry(
      buildOperatorTools({ operator: bundle.operator, inquiry: bundle.inquiry, issue: bundle.issue }),
    );
    const input: SelfKnowledgeInputs = {
      registeredTools: registry.names(), actionClasses: registry.actionClasses(),
      readiness: world.readiness, coverage: world.coverage,
    };
    /**
     * <b>The Grounded Conversation lane answers first, and the composer below is its fallback.</b>
     *
     * Grounded Conversation Lane v1 §3. The five composed answers under this line are correct for the
     * five questions they were written for, and that is exactly the ceiling this package removes: a
     * sixth question — 「너랑 사방넷이랑 뭐가 달라?」, 「내가 매일 여기 들어와야 돼?」 — needed a sixth
     * token and a sixth composer. Here the same derivations become a FACT SHEET and a model answers
     * whatever was actually asked.
     *
     * <b>Every failure lands on the old answer.</b> Capability off, quota met, floor refused, model
     * declined, guard rejected the prose — all five return null, and what a seller reads is what
     * shipped before this lane. That is also why the scenario suite is unchanged: its client has no
     * `converse` method at all, so this lane does not run in CI and CANNOT change a recorded answer.
     */
    const grounded = await this.groundedProductAnswer(bundle, input, world, envelope, said, channel);
    if (grounded) return grounded;

    // A named channel narrows the two aspects that have a per-channel truth; the other three are about
    // the product and take none. The reads are made only on the turn that needs them.
    const scoped = channel && (aspect === "AFTER_CONNECT" || aspect === "CHANNEL_ACTION")
      ? await this.channelMatrix(bundle, input, channel)
      : [];
    const offer = channel ? channelOffers(input.coverage).find((o) => o.code === channel.toUpperCase()) ?? null : null;
    const composed = aspect === "SUPPORTED_CHANNELS" ? supportedChannelsAnswer(input)
      : aspect === "AFTER_CONNECT"
        ? afterConnectAnswer(input, offer ? { offer, facts: scoped[0] ?? null } : undefined)
        : aspect === "HOW_TO_CONNECT" ? howToConnectAnswer(input)
          : aspect === "CHANNEL_ACTION"
            ? channelActionAnswer(channel ? scoped : await this.channelMatrix(bundle, input, null), world.readiness)
            : overviewAnswer(input);
    // <b>A fact is said once — per aspect.</b> The rule already existed and was written per
    // CONVERSATION, which is what produced the reported repeat: after the overview card, every later
    // product question returned one fixed getting-started answer whatever it asked. The same aspect
    // asked twice is a repeat; a different aspect is a different fact.
    const artifactId = saidOnceId(aspect, channel);
    const repeat = view.turns.some((t) => t.artifacts.some((a) => a.artifactId === artifactId));
    const answer = repeat ? shortenRepeat(composed, world.readiness) : composed;
    // `channel` is a closed token (NAVER|COUPANG|CAFE24), and it is what tells one CHANNEL_ACTION turn
    // from another — a trace without it cannot explain why a turn was read as a repeat.
    log("assistant_capability", {
      readiness: world.readiness.kind, connected: world.readiness.connected.length,
      aspect, channel: channel ?? "NONE", repeat,
    });
    return {
      artifact: answer.lines.length === 0
        ? null
        : reasonSummary(artifactId, ASPECT_TITLE[aspect], [...answer.lines]),
      headline: answer.headline,
      chips: [
        ...answer.chips.map((c) => promptChip(c)),
        ...(answer.link ? [{ label: answer.link.label, kind: "LINK" as const, to: answer.link.to }] : []),
      ],
    };
  }

  /**
   * <b>Answer the question that was asked, from facts this deployment can prove.</b>
   *
   * The inputs are the ones §3 names and nothing else: the seller's own sentence, the last few
   * sentences of this thread, the context envelope as closed tokens, and the product fact sheet — the
   * tool catalogue, the action classes, the coverage snapshot this turn already holds, and the
   * per-channel verdicts from the same resolver the execution paths read.
   *
   * <b>Context engineering, not a decision tree.</b> The only routing done here is WHICH facts to
   * fetch: a sentence that named a channel gets that channel's verdicts, one that named none gets the
   * table's. Nothing about the ANSWER is decided by that choice — the selection is of facts, never of
   * wording, which is the line §6 draws.
   *
   * <b>READ only, structurally.</b> The seam it calls looks nothing up and stores nothing; the reads
   * it makes are the capability overviews and this deployment's own wiring. There is no path from here
   * to a draft, an approval or a channel.
   */
  private async groundedProductAnswer(
    bundle: SpringClientBundle, input: SelfKnowledgeInputs, world: WorldState,
    envelope: ContextEnvelope, said: string, channel: string | null,
  ): Promise<{ artifact: null; headline: string; chips: SuggestedAction[] } | null> {
    const question = said.trim();
    if (!bundle.operator.converse || question.length === 0) return null;
    const matrix = await this.channelMatrix(bundle, input, channel);
    const facts = productFactSheet(input, matrix);
    let answered: string | null = null;
    try {
      const result = await bundle.operator.converse({
        question,
        facts,
        context: envelopeTokens(envelope),
        recentTurns: envelopeTurnLines(envelope),
      });
      answered = result.available ? result.answer : null;
    } catch {
      // A seam that is unreachable is a seam that is off. Same consequence, same branch.
      answered = null;
    }
    const verdict = checkGroundedAnswer(answered);
    log("grounded_conversation", {
      answered: verdict.ok, reason: verdict.reason ?? "OK", facts: facts.length,
      turns: envelope.recentTurns.length, channels: matrix.length,
      focus: envelope.focus?.kind ?? "NONE", readiness: envelope.readiness,
    });
    if (!verdict.ok) return null;
    return {
      artifact: null,
      headline: verdict.text!,
      // The one action a seller with nothing connected has. The model writes the sentence; the runtime
      // still owns which button exists — a link is a product decision, not a phrase.
      chips: world.readiness.kind === "NO_CHANNEL"
        ? [{ label: CONNECT_ACTION.label, kind: "LINK" as const, to: CONNECT_ACTION.to }]
        : [],
    };
  }

  /**
   * What each channel can actually do — one channel when the sentence named one, otherwise every
   * channel the coverage table lists.
   *
   * <b>Answerable before the first connection, and that is the point.</b> Every read here is
   * CHANNEL-keyed (`/api/channels/{code}/capabilities/overview`) or org-wide (the audited inquiry
   * transports, this deployment's publish wiring) — none needs a seller account — so the one seller
   * who most needs this answer, the one deciding whether to connect, can have it. The review-reply
   * verdict is the exception: it is read from a connected account, so before connection its source is
   * absent and {@link ProductSelfKnowledge} renders that as 「연결하신 뒤에 확인해 드릴 수 있습니다」
   * rather than as 「안 됩니다」. Bounded: at most three overviews plus two org reads, on this turn only.
   */
  private async channelMatrix(
    bundle: SpringClientBundle, input: SelfKnowledgeInputs, channel: string | null,
  ): Promise<ChannelActionFacts[]> {
    const offers = channelOffers(input.coverage);
    const wanted = channel ? offers.filter((o) => o.code === channel.toUpperCase()) : offers;
    if (wanted.length === 0) return [];
    const [transports, publish, accounts, channels] = await Promise.all([
      bundle.operator.listInquiryReplyTransports?.().catch(() => null) ?? Promise.resolve(null),
      bundle.inquiry.getPublishCapability().catch(() => null),
      // The review-reply verdict lives on the seller's own account. A CONNECTED shop can be told it;
      // withholding a readable fact is how 「연결하신 뒤에 확인해 드릴 수 있습니다」 reached a seller whose
      // channel had been connected for months. A shop with no account for a channel reads nothing here
      // and gets the honest 「연결하신 뒤에」 — the same sentence, now only where it is true.
      wanted.some((o) => o.connected) ? bundle.inquiry.listSellerAccounts().catch(() => []) : Promise.resolve([]),
      wanted.some((o) => o.connected) ? bundle.operator.listChannels().catch(() => []) : Promise.resolve([]),
    ]);
    const accountFor = (code: string) => {
      const channelId = channels.find((c) => c.code.toUpperCase() === code)?.id ?? null;
      return channelId ? accounts.find((a) => a.channelId === channelId && !a.fileUpload)?.id ?? null : null;
    };
    const overviews = await Promise.all(wanted.map((o) =>
      bundle.operator.getChannelCapabilityOverview?.(o.code).catch(() => null) ?? Promise.resolve(null)));
    const reviewChannels = await Promise.all(wanted.map((o) => {
      const accountId = o.connected ? accountFor(o.code) : null;
      return accountId
        ? bundle.operator.getReviewChannelCapability?.(accountId).catch(() => null) ?? Promise.resolve(null)
        : Promise.resolve(null);
    }));
    return wanted.map((o, i) => channelActionFacts(o.code, o.name, {
      overview: overviews[i] ?? null, transports, publish,
      reviewChannel: reviewChannels[i] ?? null, localAgent: "UNKNOWN",
    }, o.connected));
  }

  /** The execution capability of a review's channel, read for its own API-mode account. Fail closed. */
  /**
   * What reviewnary can and cannot do on one channel for the kind of object the seller is looking at —
   * acquisition and execution, from the same verdict the actions use, in two sentences and no API names.
   */
  private async explainCapability(
    bundle: SpringClientBundle, view: ConversationView, channel: string | null, workingSet: WorkingSetView | null,
    plannedAspect: CapabilityAspect | null, world: WorldState,
    envelope: ContextEnvelope, said: string,
  ): Promise<{ artifact: SummaryArtifact | null; headline: string; chips: SuggestedAction[] }> {
    const objectKind: ObjectKind = workingSet?.kind === "INQUIRIES" ? "INQUIRY" : "REVIEW";
    const code = channel?.toUpperCase() ?? null;
    /**
     * <b>Which product question this is — the plan's own axis.</b>
     *
     * It used to be `informationNeeds.length === 0`, a proxy that failed in both directions and is the
     * defect this closes: 「지원하는 이커머스 종류가 뭐가 있지?」 planned WITH a need, so it fell to the
     * channel branch and was answered 「어느 채널에 대한 질문인지 알려주세요 (네이버 · 쿠팡 · 카페24)」 —
     * a question whose own refusal contains its answer. `null` (a backend predating the field) resolves
     * to what the plan already carries, so the shapes that worked before are byte-identical.
     */
    const aspect: CapabilityAspect = plannedAspect ?? fallbackAspect(
      code != null,
      view.turns.some((t) => t.artifacts.some((a) => a.artifactId === ASSISTANT_CAPABILITY_ID)),
      world.readiness,
    );
    // A named channel + an object on screen is the per-OBJECT question 「쿠팡 건은 왜 답변 못 해?」, and
    // its answer is that object's verdict — read below, unchanged. Everything else about capability is
    // a question about the product, and `ProductSelfKnowledge` is the one place that answers those.
    const aboutThisObject = code != null && workingSet != null;
    if (!aboutThisObject) return this.productSelfAnswer(view, bundle, world, aspect, code, envelope, said);
    const name = channelNameOf(view, code!) ?? code!;
    const what = objectKind === "REVIEW" ? "리뷰 답글" : "문의 답변";
    let verdict: ChannelCapabilityVerdict;
    const channelCode = code!;
    if (objectKind === "REVIEW") {
      const item = lastReviewItemOf(view, channelCode);
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
      // The draft the action binds to, and whether an approval already stands for it — ONE read of the
      // review's own reply-prep view, always (Guided Reply UX Smoothing v1 §1). It used to be skipped when
      // this conversation had just prepared a draft, which was cheaper and wrong in the one case that
      // matters: the card would name a version the seller prepared while the standing approval — the thing
      // that decides whether a run can even be minted — was never looked at.
      let prep;
      try {
        prep = await bundle.review.getReviewReplyPrep(t.accountId, t.actionRef);
      } catch {
        return null;
      }
      const approvalState = replyApprovalStateOf(prep);
      if (approvalState.kind === "NO_DRAFT") return null;
      const { version: draftVersion, contentFingerprint } = approvalState.head;
      if (verdict.execution === "GUIDED_BROWSER_EXECUTION") {
        // <b>Whether a guided run may start is the BACKEND's question</b> (Agent Runtime Production
        // Closure v1 §3). The channel verdict above says the channel supports guided reply; it does
        // not know that this review was already answered on the channel, or that its acquisition
        // cannot prove a channel-side identity — and the mint refuses both. The reply screen was
        // taught to read `canStartSubmissionRun` in Pilot Release Closure v1; the conversation was
        // still deciding for itself, so an approved reply on an already-answered review promised
        // 「판매자센터에 넣어 두겠습니다」 that no mint could keep.
        if (approvalState.kind === "APPROVED" && !prep.capabilities.canStartSubmissionRun) {
          const line = guidedUnavailableSentence(prep.guidedUnavailableReason ?? null, name);
          return { artifact: reasonSummary(`a-send-${t.reviewId}`, "이 리뷰는 가이드형 답변을 시작할 수 없습니다", [line, COPY_ONLY_SENTENCE]), headline: line, chips: [] };
        }
        // The seller has not approved THIS version: the next thing that happens is their decision, not a
        // browser window. Asking for it here — with the draft in full, in the thread that knows which
        // review this is — is what replaces 「리뷰 화면에서 승인한 뒤 돌아오세요」.
        if (approvalState.kind === "NEEDS_APPROVAL") {
          const needed: ApprovalRequiredArtifact = {
            artifactId: `a-approval-required-${t.reviewId}`, type: "APPROVAL_REQUIRED", title: "이 답변을 보내도 될까요?",
            objectKind: "REVIEW", reviewId: t.reviewId, accountId: t.accountId, actionRef: t.actionRef,
            channelCode: t.channelCode ?? "", channelNameKo: t.channelNameKo, productName: t.productName,
            draftVersion, contentFingerprint, execution: verdict.execution, executableIdentity: "MARKETPLACE",
            to: reviewReplyTaskLink(t.reviewId),
          };
          return {
            artifact: needed,
            headline: `승인하시면 reviewnary가 ${name} 판매자센터에서 이 리뷰의 답글 입력칸에 아래 문장을 그대로 넣어 둡니다. 등록은 판매자님이 누릅니다.`,
            chips: [],
          };
        }
        const guided: GuidedExecutionArtifact = {
          artifactId: `a-guided-${t.reviewId}`, type: "GUIDED_EXECUTION", title: `${name}에 입력하기`,
          actionType: "REVIEW_REPLY", objectKind: "REVIEW", channelCode: t.channelCode ?? "", channelNameKo: t.channelNameKo,
          accountId: t.accountId, reviewId: t.reviewId, actionRef: t.actionRef, draftVersion, contentFingerprint,
          requiresLocalAgent: true, to: reviewReplyTaskLink(t.reviewId),
        };
        return {
          artifact: guided,
          headline: `승인하신 답변이 있습니다. ${name} 판매자센터에서 이 리뷰의 답글 입력칸에 그대로 넣어 두겠습니다. 등록은 판매자님이 누릅니다.`,
          chips: [],
        };
      }
      const approval: ApprovalArtifact = {
        artifactId: `a-approval-${t.reviewId}`, type: "APPROVAL", title: "답글 전송 승인",
        objectKind: "REVIEW", targetId: t.reviewId, accountId: t.accountId, actionRef: t.actionRef,
        channelCode: t.channelCode, channelNameKo: t.channelNameKo, draftVersion, contentFingerprint,
        execution: "API_EXECUTION", executableIdentity: "MARKETPLACE", to: reviewReplyTaskLink(t.reviewId),
      };
      return { artifact: approval, headline: "다음 답글을 전송하려면 승인이 필요합니다. 전송은 승인 뒤 기존 실행 경로로만 진행됩니다.", chips: [] };
    }

    // An inquiry with no draftable work item has no draft to send — the state sentence already said so.
    if (!resolved.target) return null;
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

/**
 * The inquiry a reference resolves to — the FOCUS of the conversation.
 *
 * <b>Selection is one way to have a referent, not the only one.</b> The deterministic lanes bound
 * 「이 고객」·「답변 준비해줘」 to `selectedInquiry` alone, so a refine that left exactly ONE row on screen
 * had a referent everybody could see and nobody could name: 「파손 관련 문의 보여줘」 → 「그중 네이버 것만」
 * → 「이 고객한테 뭐라고 답해야 해?」 fell through to the planner, which read the org's whole queue and
 * ended the turn WAITING_HUMAN. The planner's own `resolveTargets` had always treated a one-row set as
 * the target, so the two paths disagreed about what 「이 문의」 means; this is the one answer.
 *
 * A set of two or more has no unique referent and returns null — the sentence is then a selection
 * question, and the lanes that ask it are the ones that run.
 */
function focusInquiryOf(set: WorkingSetView | null): SelectedInquiry | null {
  if (set?.kind !== "INQUIRIES") return null;
  if (set.selectedInquiry) return set.selectedInquiry;
  if (set.ids.length !== 1) return null;
  return {
    inquiryId: set.ids[0]!, workItemId: set.workItemIds.length === 1 ? set.workItemIds[0]! : null,
    productId: set.productIds.length === 1 ? set.productIds[0]! : null,
    channelCode: set.filters.channelCode ?? null,
  };
}

/**
 * The set a draft/send sentence indexes into — the one the seller was LOOKING AT when they said it
 * (the conversation's), and only when there is none, the list this turn happened to draw. Found live:
 * a PREPARE plan that also read the org queue made 「첫 번째 거」 the first row of that queue, not of the
 * three rows on screen (Conversation Object Integrity v1).
 */
/**
 * <b>Is the conversation still standing on the same object it was?</b>
 *
 * Grounded Conversation Lane v1 §4. The step in flight is carried when the anchor did not move, and
 * the test for that used to read {@code selectedInquiry} alone — so a thread anchored on a REVIEW or a
 * PRODUCT lost its task on the first conversational turn: 「답글 준비해줘」 leaves PREPARE_REPLY on a
 * review, 「왜 이렇게 썼어?」 answers about that same review, and the context bar stops saying what the
 * conversation is doing with it. The anchor is one of three kinds — {@code selectedObject} clears
 * {@code selectedInquiry} and back — so the comparison has to be over the ANCHOR, not over one of its
 * shapes.
 */
function sameAnchor(next: WorkingSetView | null, previous: WorkingSetView | null): boolean {
  const key = (set: WorkingSetView | null): string | null =>
    set?.selectedObject ? `${set.selectedObject.kind}:${set.selectedObject.id}`
      : set?.selectedInquiry ? `INQUIRY:${set.selectedInquiry.inquiryId}` : null;
  const a = key(next);
  return a != null && a === key(previous);
}

function pickSet(workingSet: WorkingSetView | null, view: ConversationView): WorkingSetView | null {
  const candidates = [view.workingSet, workingSet];
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
async function syncCompleted(bundle: SpringClientBundle, pending: PendingHumanAction): Promise<{ completed: boolean; failed: boolean; partial: boolean; finishedAt: string | null; successRows: number | null; runId: string | null }> {
  const none = { completed: false, failed: false, partial: false, finishedAt: null, successRows: null, runId: null };
  if (!pending.accountId || !pending.dataType) return none;
  // Two shapes of the same fact, matched as tightly as each shape allows (Acceptance Closure §8-B):
  //  - a connector/guided run is stamped with the ACCOUNT and `dataType` — it must be this account's;
  //  - a file upload carries no account, only the channel and `uploadType` — it must be this account's
  //    channel, upload-shaped (no account on the row), and of the requested type.
  // Either way it must have FINISHED after the step was requested, and be the kind of step that was
  // asked for. A run some other tab started on another account never satisfies this one.
  const accounts = await bundle.inquiry.listSellerAccounts();
  const channelId = accounts.find((a) => a.id === pending.accountId)?.channelId ?? null;
  // **Scoped to the channel the step is about.** The unfiltered read returns the org's newest runs and
  // stops there, so a completion could fall out of the list behind the routine collection of every other
  // channel — measured on the real org, the E2E acquisition was no longer in it hours later, and a seller
  // pressing 「계속 확인하기」 would have been told the collection had not finished. `dataType` is
  // deliberately NOT sent: an upload-shaped row carries the type in `uploadType`, and a server-side
  // filter on the other column would drop exactly the rows this check exists to find.
  const runs = await bundle.inquiry.listSyncRuns(channelId ? { channelId } : {});
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
    // The run's own id — the only thing the summary needs, because the backend answers what it did.
    runId: latest?.id ?? null,
  };
}

/**
 * The artifacts of a completion turn, minus the collection step for a channel this turn already
 * reports (Presentation Closure v1 §1).
 *
 * Only REVIEW_IMPORT, only channels a receipt names, and only when there is a receipt: a turn with
 * nothing to show about the run keeps the step, because then the card is the only thing that says
 * where the collection stands. No freshness or coverage value is read here — this decides which of two
 * renderings of one already-computed state survives in one turn.
 */
export function withoutSettledCollectionSteps(
  artifacts: readonly Artifact[], receipts: readonly AcquisitionResultArtifact[],
): Artifact[] {
  if (receipts.length === 0) return [...artifacts];
  const collected = new Set(receipts.map((r) => r.channelCode.toUpperCase()));
  return artifacts.filter((a) => !(
    a.type === "HUMAN_ACTION_REQUIRED" && a.actionType === "REVIEW_IMPORT"
    && a.channelCode != null && collected.has(a.channelCode.toUpperCase())
  ));
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
  const LISTS = new Set(["INQUIRY_LIST", "REVIEW_LIST", "PRODUCT_LIST", "ISSUE_LIST", "OPPORTUNITY_LIST", "ORDER_SUMMARY", "CHART"]);
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
    // New-list Scope Integrity (Conversation Core v1 §9): the set's axes DESCRIBE what is on screen —
    // they are not defaults for the next sentence. A fixed instruction, like `contextLine`'s: closed
    // vocabulary about run state, no data. The deterministic backstop is `scopeOverride`'s axis strip.
    parts.push("집합 규칙: 위 괄호의 값은 지금 화면에 있는 집합의 설명이지 이번 문장의 조건이 아닙니다. "
      + "그 집합을 좁히는 문장(「그중」·「여기서」·「~만」)에서만 filters.scope=\"WORKING_SET\"으로 두고 새 조건만 더하세요. "
      + "새 목록을 요청하는 문장(「최근 문의 N개 보여줘」·「오늘 문의 보여줘」)은 filters.scope=\"ORG\"이고, "
      + "filters의 채널·상태·기간·주제는 이번 문장에 적힌 것만 적으세요 — 위 괄호의 값을 복사하지 마세요.");
  }
  if (set?.kind === "INQUIRIES" && set.selectedInquiry) {
    parts.push("직전 선택: INQUIRY (판매자가 방금 문의 하나를 골랐습니다 — 「이 문의」·「답변 준비해줘」는 그 문의를 가리킵니다)");
  }
  // The same fact for the other two objects: WHICH one is never sent (an id is not a plan input), only
  // that one is standing — so 「이 상품」·「이 리뷰」 is a resolved reference and not a question to ask back.
  if (set?.selectedObject?.kind === "PRODUCT") {
    parts.push("직전 선택: PRODUCT (판매자가 방금 상품 하나를 골랐습니다 — 「이 상품」은 그 상품을 가리킵니다)");
  } else if (set?.selectedObject?.kind === "REVIEW") {
    // Agent Object v1: the exact single-review read exists, so a question about the selected review is
    // answerable — the planner declares a REVIEW_SIGNAL need instead of asking which review it was.
    parts.push("직전 선택: REVIEW (판매자가 방금 리뷰 하나를 골랐습니다 — 「이 리뷰」는 그 리뷰를 가리키며, "
      + "그 리뷰 하나를 정확히 읽는 조회가 있습니다: REVIEW_SIGNAL 필요 정보로 두면 됩니다)");
  }
  if (view.pendingPrepared) {
    parts.push(view.pendingPrepared.kind === "REVIEW_DRAFT"
      ? "직전 준비: REVIEW_DRAFT (판매자가 방금 준비된 리뷰 답글 초안을 보고 있습니다)"
      : "직전 준비: INQUIRY_DRAFT (판매자가 방금 준비된 초안을 보고 있습니다)");
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

const PRIMARY_ORDER: readonly Artifact["type"][] = [
  "DRAFT", "APPROVAL_REQUIRED", "APPROVAL", "GUIDED_EXECUTION", "REVIEW_LIST", "INQUIRY_LIST", "PRODUCT_LIST", "ORDER_SUMMARY", "ISSUE_LIST",
  "OPPORTUNITY_LIST",
  "WORKSPACE_LINK", "CHART", "METRIC", "TABLE", "LIST", "SUMMARY", "CHECKLIST",
];

/**
 * The artifact types that ARE a working set on screen — the same five {@link workingSetOf} builds one
 * from. Listed here rather than derived from that switch because the two answer different questions:
 * that one asks "what is the conversation standing on now", which has a carried-forward answer, and
 * this one asks "did this turn draw it", which must not.
 */
const SET_ARTIFACT_TYPES: readonly Artifact["type"][] =
  ["INQUIRY_LIST", "REVIEW_LIST", "PRODUCT_LIST", "ORDER_SUMMARY", "ISSUE_LIST"];

function drewSetOf(artifacts: readonly Artifact[]): boolean {
  return artifacts.some((a) => SET_ARTIFACT_TYPES.includes(a.type));
}

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
      // A label only when a period was named — the same rule the rows path applies, so the headline and
      // the finding are one sentence and the dedupe can see they are.
      return rowsSentence(previous?.count ?? null, rating, token ? periodLabel(token, primary.scope.period?.days) : "",
        primary.totalCount, anyStale, token);
    }
    case "PRODUCT_LIST": {
      // 「방금 본 리뷰를 …묶었습니다」 is true of exactly one shape: a grouping follow-up over a REVIEWS set.
      // Any other product answer (a policy read on a product, a knowledge miss) says its first finding.
      const groupedReviews = axis.filters.scope === "WORKING_SET" && view.workingSet?.kind === "REVIEWS";
      if (groupedReviews) return `방금 본 리뷰를 상품 ${primary.items.length}개로 묶었습니다.`;
      const first = answer.findings.find((f) => f.confidence === "SUPPORTED") ?? answer.findings.find((f) => f.confidence === "NEEDS_REVIEW");
      return first?.statement ?? `상품 ${primary.items.length}개를 확인했습니다.`;
    }
    case "INQUIRY_LIST": {
      // A ranked list says the order and its criterion — never 「N건입니다」, which is the answer to a
      // question about how many, not about which one first. The sentence is the READ's own (it knows
      // the queue's real size); recomposing it here from the card's title said the same fact twice in
      // two shapes, which is exactly the repetition this package exists to remove.
      if (primary.scope?.rank === "URGENCY") {
        const ranked = answer.findings.find((f) => f.statement.includes(URGENCY_CRITERION));
        if (ranked) return ranked.statement;
        const shown = primary.groups.reduce((n, g) => n + g.items.length, 0);
        const head = primary.groups.flatMap((g) => g.items)[0] ?? null;
        return urgencySentence(primary.title, Math.max(primary.totalCount, shown), shown,
          head ? { title: head.title ?? null, waitingDays: head.waitingDays ?? null } : null);
      }
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
      const label = periodLabel(primary.period.token, primary.period.days);
      const name = primary.channelCode
        ? (primary.channels[0]?.channelNameKo ?? primary.channelCode) + " " : "";
      const head = `${label} ${name}매출은 ${won(t.sales)}(주문 ${t.orders}건)`;
      if (t.salesDeltaPercent == null) return `${head}입니다.`;
      return `${head}으로 직전 기간보다 ${Math.abs(t.salesDeltaPercent)}% ${t.salesDeltaPercent < 0 ? "줄었습니다" : "늘었습니다"}.`;
    }
    case "ISSUE_LIST":
      return `반복되는 문제 ${primary.items.length}건을 확인했습니다.`;
    case "OPPORTUNITY_LIST":
      return primary.items.length === 0
        ? "지금 제안할 개선 기회가 없습니다."
        : `개선할 만한 기회 ${primary.items.length}건을 확인했습니다.`;
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

/**
 * Sentences that say the same limit twice in two shapes (the resolver's 「"이 상품"에 해당하는 상품을 찾지
 * 못했습니다」 and the scope gate's 「「이 상품」에 해당하는 상품을 찾지 못해, …」) are one fact: the first
 * form is kept (Response Hygiene v1 §6). Exact repeats collapse as before.
 */
const NEAR_KEYS: ReadonlyArray<RegExp> = [/에 해당하는 상품을 찾지 못/, /저장된 과거 답변/, /등록된 회사 정보/];
export function dedupeNear(sentences: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const seenKey = new Set<number>();
  for (const entry of sentences) {
    // <b>Deduped sentence by sentence, not entry by entry.</b> A headline and a note can carry the same
    // fact in differently-sized strings — 「어떤 상품을 묻는지 확인하지 못했습니다. 상품명이나 SKU를 함께
    // 알려주세요.」 arrived once as one entry and once as two, and whole-string equality saw no repeat, so
    // the seller read the same two sentences twice with an unrelated line wedged between them.
    const kept: string[] = [];
    for (const one of entry.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter((x) => x.length > 0)) {
      if (seen.has(one)) continue;
      const key = NEAR_KEYS.findIndex((re) => re.test(one));
      if (key >= 0) {
        if (seenKey.has(key)) continue;
        seenKey.add(key);
      }
      seen.add(one);
      kept.push(one);
    }
    if (kept.length > 0) out.push(kept.join(" "));
  }
  return out;
}

function promptChip(label: string): SuggestedAction {
  return { label, kind: "PROMPT", prompt: label };
}

/** The seller's words for a visible filter's predicate axes (channel · topic · status), trailing space. */
const FILTER_CHANNEL_WORD: Record<string, string> = { NAVER: "네이버", COUPANG: "쿠팡", CAFE24: "카페24" };
function filterWords(filter: VisibleFilter): string {
  const parts: string[] = [];
  if (filter.channel) parts.push(FILTER_CHANNEL_WORD[filter.channel] ?? filter.channel);
  if (filter.topic) parts.push(TOPIC_LABEL[filter.topic]);
  // The seller's own subject word, said back verbatim — a 0 under it is a 0 about that subject.
  if (filter.term) parts.push(`${filter.term} 관련`);
  if (filter.status) parts.push(filter.status === "UNANSWERED" ? "답변 안 한" : "답변한");
  return parts.length > 0 ? `${parts.join(" ")} ` : "";
}

/** The all-null filter a PRIORITIZE reuses: no narrowing, only an order. */
const EMPTY_FILTER: VisibleFilter = { channel: null, topic: null, term: null, status: null, limit: null, order: null, urgency: false };

/** The working set the primary artifact leaves behind — ids and closed filters, bounded. */
function workingSetOf(
  artifacts: readonly Artifact[], axis: ReturnType<typeof conversationAxisOf>, view: ConversationView,
): WorkingSetView | null {
  const primary = primaryOf(artifacts.filter((a) => a.type !== "DRAFT" && a.type !== "APPROVAL_REQUIRED" && a.type !== "APPROVAL" && a.type !== "GUIDED_EXECUTION"
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
          ...(primary.scope?.topic ?? axis.filters.topic ? { topic: primary.scope?.topic ?? axis.filters.topic } : {}),
          ...(primary.scope?.term ? { term: primary.scope.term } : {}),
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

/**
 * An inquiry the conversation has shown, by inquiry id OR work item id.
 *
 * <b>`drawn` is the rows THIS turn produced, and it is searched first.</b> The persisted history is the
 * previous turns only — the current turn's artifacts are not saved until it ends — so a turn that both
 * FOUND a row and was asked to act on it could not see its own result: 「케이블 커버에 전선 몇 가닥
 * 들어가는지 물어본 문의 답변 준비해줘」 read the queue, drew exactly one row, and then answered
 * 「어떤 문의의 답변을 준비할지 알려주세요」 with that row printed underneath. The target step must be
 * able to see the objects the same turn put on the table.
 */
function inquiryFromHistory(view: ConversationView, id: string, drawn: readonly Artifact[] = []): InquiryItem | null {
  const scan = (artifacts: readonly Artifact[]): InquiryItem | null => {
    for (const artifact of artifacts) {
      if (artifact.type !== "INQUIRY_LIST") continue;
      for (const group of artifact.groups) {
        const item = group.items.find((it) => it.inquiryId === id || it.workItemId === id);
        if (item) return item;
      }
    }
    return null;
  };
  const fresh = scan(drawn);
  if (fresh) return fresh;
  for (let i = view.turns.length - 1; i >= 0; i -= 1) {
    const found = scan(view.turns[i]!.artifacts);
    if (found) return found;
  }
  return null;
}

function inquiryTargetFromHistory(view: ConversationView, id: string, drawn: readonly Artifact[] = []): ResolvedTarget | null {
  const item = inquiryFromHistory(view, id, drawn);
  if (!item) return null;
  const actionability = actionabilityOf({ workItemId: item.workItemId, phase: item.phase, status: item.status });
  return {
    kind: "INQUIRY",
    inquiry: {
      inquiryId: item.inquiryId, workItemId: item.workItemId, productId: item.productId, channelCode: item.channelCode,
      channelNameKo: item.channelNameKo, productName: item.productName, title: item.title ?? null, status: item.status,
      receivedAt: item.receivedAt ?? null, snippet: item.snippet ?? null,
    },
    actionability,
    // Only a DRAFTABLE row has a work item the product's draft path will accept.
    target: actionability === "DRAFTABLE" && item.workItemId ? {
      workItemId: item.workItemId, inquiryId: item.inquiryId, channelCode: item.channelCode,
      channelNameKo: item.channelNameKo, productId: item.productId, productName: item.productName,
    } : null,
    // Absent on a row from an older backend ⇒ NONE: a channel label is not a marketplace binding.
    executableIdentity: item.executableIdentity ?? "NONE",
    sourceSubtype: item.sourceSubtype ?? null,
  };
}

/**
 * ONE inquiry as a card: the row's closed facts and, when it is known, the customer's own sentence.
 * Shared by the INSPECT lane and by a planner turn that resolved exactly one row — the two must not
 * draw the selected inquiry in two different shapes.
 */
function inquiryDetailArtifact(row: SelectedInquiryRow, actionability: InquiryActionability, excerptText: string | null): InquiryDetailArtifact {
  return {
    artifactId: `a-inspect-${row.inquiryId}`, type: "INQUIRY_DETAIL",
    title: row.title ?? "제목 없는 문의",
    inquiryId: row.inquiryId, workItemId: row.workItemId,
    channelCode: row.channelCode, channelNameKo: row.channelNameKo,
    status: row.status, receivedAt: row.receivedAt,
    productId: row.productId, productName: row.productName,
    stateLabel: STATUS_WORD[row.status.toUpperCase()] ?? "상태 미확인",
    excerpt: excerptText,
    actionability,
    to: `/inquiries/${row.inquiryId}`,
  };
}

/** The seller-facing refusal when the draft path itself failed. Deterministic; the backend's text never travels. */
export const DRAFT_FAILED_SENTENCE = "초안을 준비하는 중 문제가 생겨 이번에는 만들지 못했습니다. 잠시 후 다시 시도해 주세요.";
export const NO_DRAFT_TO_REVISE_SENTENCE = "말투를 바꿀 초안을 찾지 못했습니다. 먼저 「답변 준비해줘」로 초안을 만들어 주세요.";

const STATUS_WORD: Record<string, string> = { UNANSWERED: "답변 필요", ANSWERED: "답변함" };

/** What an INSPECT says after naming the row — closed per actionability, never a backend message. */
const INSPECT_SENTENCE: Record<InquiryActionability, string> = {
  DRAFTABLE: "「답변 준비해줘」라고 하시면 이 문의의 초안을 준비합니다.",
  ALREADY_ANSWERED: "이미 답변된 문의입니다.",
  AWAITING_SEND: "승인된 답변이 전송을 기다리고 있는 문의입니다.",
  NOT_WORKABLE: "지금은 답변 준비 대상이 아닌 문의입니다.",
};

function inquiryLine(row: SelectedInquiryRow): string {
  const parts = [row.channelNameKo ?? row.channelCode ?? "채널", STATUS_WORD[row.status.toUpperCase()] ?? "상태 미확인"];
  if (row.receivedAt) parts.push(`${row.receivedAt.slice(0, 10)} 접수`);
  if (row.productName) parts.push(row.productName);
  return parts.join(" · ");
}

/** The state of a non-draftable inquiry, as an artifact the seller can act on — the row, the sentence, the link. */
function inquiryStateSummary(row: SelectedInquiryRow, line: string): SummaryArtifact {
  return {
    artifactId: `a-state-${row.inquiryId}`, type: "SUMMARY", title: "초안을 만들지 않은 문의",
    lines: [row.title ? `「${row.title}」` : inquiryLine(row), ...(row.title ? [inquiryLine(row)] : []), line],
  };
}

/** The selected inquiry, shown so the seller sees WHICH row the next verb will act on. */
function selectionSummary(row: SelectedInquiryRow): SummaryArtifact {
  return {
    artifactId: `a-selected-${row.inquiryId}`, type: "SUMMARY", title: "선택한 문의",
    lines: [row.title ? `「${row.title}」` : "제목 없는 문의", inquiryLine(row)],
  };
}


/**
 * The working set anchored on one inquiry: the INQUIRIES kind the follow-up rules already read, exactly
 * one id, the previous set's closed filters (so 「그중 …」 still refines the same read), the products
 * beside it, and the selection itself. The label is the selection, never a customer word.
 */
function anchoredSet(row: SelectedInquiry, previous: WorkingSetView | null, productIds: readonly string[]): WorkingSetView {
  // The list the selection was made from stays the set (「세 번째 거」 after 「첫 번째 거」 still counts on
  // the same three rows; 「그중 네이버만」 still refines the same read); the selection rides beside it.
  //
  // A set is keyed by ONE of two identities and which one depends on the read that produced it: a ROWS
  // list is inquiry ids, a work-queue list is work-item ids (`ids: bounded(rows ? … : workItemIds)`).
  // Testing only the inquiry id therefore never matched a work-queue list, so clicking a row of the
  // queue silently collapsed the set to that one row — and 「세 번째 거」 or 「그중 네이버만」 after the
  // click acted on a set of one. The row carries both ids; recognise the set by either.
  const inSet = (set: WorkingSetView): boolean =>
    set.ids.includes(row.inquiryId) || (row.workItemId != null && set.workItemIds.includes(row.workItemId));
  const list = previous?.kind === "INQUIRIES" && inSet(previous) ? previous : null;
  const inherited = previous?.kind === "INQUIRIES" ? previous.filters : {};
  const selectedInquiry: SelectedInquiry = {
    inquiryId: row.inquiryId, workItemId: row.workItemId, productId: row.productId, channelCode: row.channelCode,
  };
  return {
    kind: "INQUIRIES", label: list?.label ?? "선택한 문의", count: list?.count ?? 1, ids: list ? [...list.ids] : [row.inquiryId],
    filters: { ...inherited, inquiryIntent: inherited.inquiryIntent ?? "ROWS" },
    productIds: [...new Set(productIds)].slice(0, WORKING_SET_MAX_IDS),
    workItemIds: list ? [...list.workItemIds] : row.workItemId ? [row.workItemId] : [],
    // One anchor at a time: standing on an inquiry leaves whatever product or review was anchored.
    selectedInquiry, selectedObject: null, turnId: "",
  };
}

/** Did THIS turn's own specialists draw a list the seller asked for? (An R4 product grouping is not one.) */
function drewFreshList(turnArtifacts: readonly Artifact[], anchor: SelectedInquiry | null): boolean {
  const list = turnArtifacts.find((a) => a.type === "INQUIRY_LIST" || a.type === "REVIEW_LIST" || a.type === "ISSUE_LIST" || a.type === "ORDER_SUMMARY");
  if (!list) return false;
  // A refine that narrowed the list to the anchored inquiry itself is still about that inquiry.
  if (anchor && list.type === "INQUIRY_LIST") {
    const ids = list.groups.flatMap((g) => g.items.map((i) => i.inquiryId));
    if (ids.length === 1 && ids[0] === anchor.inquiryId) return false;
  }
  return true;
}

/**
 * Did this turn draw a set that leaves the anchored PRODUCT or REVIEW behind?
 *
 * The object analogue of {@link drewFreshList}, and the same rule: a list that still holds the anchored
 * object (「비슷한 리뷰도 있어?」 returns this review among its product's rows) has not moved the seller
 * off it, so the anchor stands and 「이 리뷰」 still means the same review.
 */
function drewFreshObjectList(turnArtifacts: readonly Artifact[], object: SelectedObject): boolean {
  const list = turnArtifacts.find((a) => SET_ARTIFACT_TYPES.includes(a.type));
  if (!list) return false;
  if (object.kind === "REVIEW" && list.type === "REVIEW_LIST") {
    return !list.items.some((i) => i.reviewId === object.id);
  }
  if (object.kind === "PRODUCT" && list.type === "PRODUCT_LIST") {
    return !list.items.some((i) => i.productId === object.id);
  }
  return true;
}

/** The inquiry a screen launch resolved inside the graph — read back from the ref the runtime minted for it. */
function selectedFromEntities(result: Extract<OperatorRunResult, { status: "DONE" }>, answer: OperatorAnswer, workItemId: string): SelectedInquiryRow | null {
  const entity = result.entities.find((e) => e.kind === "INQUIRY" && e.id === workItemId);
  if (!entity) return null;
  const ref = answer.evidence.find((e) => e.kind === "INQUIRY" && e.locator.workItemId === workItemId);
  const inquiryId = typeof ref?.locator.inquiryId === "string" ? ref.locator.inquiryId : null;
  if (!inquiryId) return null;
  return {
    inquiryId, workItemId,
    productId: typeof ref?.locator.productId === "string" ? ref.locator.productId : null,
    channelCode: typeof ref?.locator.channelCode === "string" ? ref.locator.channelCode : null,
    channelNameKo: null,
    productName: typeof ref?.locator.productName === "string" ? ref.locator.productName : null,
    title: null,
    status: typeof ref?.locator.status === "string" ? ref.locator.status : "",
    receivedAt: ref?.events?.from ?? null,
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

/** A product row the conversation has drawn — the proof that an org-scoped read returned it. */
function productFromHistory(view: ConversationView, productId: string): { productId: string } | null {
  for (let i = view.turns.length - 1; i >= 0; i -= 1) {
    for (const artifact of view.turns[i]!.artifacts) {
      if (artifact.type !== "PRODUCT_LIST") continue;
      if (artifact.items.some((p) => p.productId === productId)) return { productId };
    }
  }
  return null;
}

/**
 * A clicked REVIEW, verified by the only proof this runtime has.
 *
 * There is no single-review endpoint, so the check is the thread's own record: a review row the
 * conversation drew came back from an org-scoped read of this seller's reviews. An id that appears in
 * no drawn list is refused rather than trusted — and refusing costs the seller nothing, because a row
 * they can click is by definition a row on their screen.
 */
function verifiedReview(view: ConversationView, reviewId: string): SelectedObject | null {
  const item = reviewFromHistory(view, reviewId);
  if (!item) return null;
  return { kind: "REVIEW", id: item.reviewId, productId: item.productId ?? null, channelCode: item.channelCode ?? null };
}

/**
 * The working set anchored on a product or a review — the same shape {@link anchoredSet} builds for an
 * inquiry: the list the selection was made from stays the set (「그중 …」 still refines the same rows),
 * the object rides beside it, and the OTHER anchor is dropped because there is only ever one.
 */
function anchoredObjectSet(object: SelectedObject, previous: WorkingSetView | null): WorkingSetView {
  const kind: WorkingSetView["kind"] = object.kind === "PRODUCT" ? "PRODUCTS" : "REVIEWS";
  const list = previous?.kind === kind && previous.ids.includes(object.id) ? previous : null;
  return {
    kind,
    label: list?.label ?? (object.kind === "PRODUCT" ? "선택한 상품" : "선택한 리뷰"),
    count: list?.count ?? 1,
    ids: list ? [...list.ids] : [object.id],
    filters: list?.filters ?? {},
    productIds: [...new Set([...(list?.productIds ?? []), ...(object.productId ? [object.productId] : [])])].slice(0, WORKING_SET_MAX_IDS),
    workItemIds: list ? [...list.workItemIds] : [],
    selectedInquiry: null,
    selectedObject: object,
    turnId: "",
  };
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

/**
 * The id of the 「제가 도와드릴 수 있는 일」 card — read back off the thread so the same card is not
 * drawn twice. An id, not a sentence: what makes it the same card is that it IS the same card.
 */
export const ASSISTANT_CAPABILITY_ID = "a-assistant-capability";

/**
 * One artifact id per product-question ASPECT — which is also what «said once» is keyed on.
 *
 * The overview keeps {@link ASSISTANT_CAPABILITY_ID} so a conversation that has already drawn that
 * card still counts as having drawn it.
 */
const ASPECT_ARTIFACT_ID: Readonly<Record<CapabilityAspect, string>> = {
  PRODUCT_OVERVIEW: ASSISTANT_CAPABILITY_ID,
  SUPPORTED_CHANNELS: "a-supported-channels",
  AFTER_CONNECT: "a-after-connect",
  CHANNEL_ACTION: "a-channel-action",
  HOW_TO_CONNECT: "a-getting-started",
};

/**
 * The «said once» key — the aspect, and the channel when the aspect has one.
 *
 * <b>Found live 2026-09-07, one level below the defect this package opened on.</b> With the aspect
 * alone as the key, 「네이버 연결하면 정확히 뭘 해줘?」 · 「리뷰 답글도 자동으로 보내?」 · 「쿠팡은 어디까지
 * 가능해?」 are three CHANNEL_ACTION turns, so the second and third were answered 「말씀드린 것까지가…」 —
 * three different questions collapsed onto one answer, which is the shape this whole package exists to
 * remove. NAVER's matrix and Coupang's are different FACTS, and a fact is said once means once per
 * fact.
 */
function saidOnceId(aspect: CapabilityAspect, channel: string | null): string {
  const base = ASPECT_ARTIFACT_ID[aspect];
  const scoped = aspect === "CHANNEL_ACTION" || aspect === "AFTER_CONNECT";
  return scoped && channel ? `${base}-${channel.toUpperCase()}` : base;
}

const ASPECT_TITLE: Readonly<Record<CapabilityAspect, string>> = {
  PRODUCT_OVERVIEW: "제가 도와드릴 수 있는 일",
  SUPPORTED_CHANNELS: "연결할 수 있는 판매 채널",
  AFTER_CONNECT: "연결한 뒤에 하는 일",
  CHANNEL_ACTION: "채널별로 되는 것과 안 되는 것",
  HOW_TO_CONNECT: "시작하는 방법",
};

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

/**
 * Why the guided step is not on offer, in this surface's register — from the SERVER's closed reason.
 *
 * The reason is decided in exactly one place (`ReviewReplyService`, the same rule the mint applies)
 * and said in two, because a chat sentence and a panel line are not the same register. Neither prints
 * the token, and an unknown reason gets the honest fallback rather than a guess.
 */
export function guidedUnavailableSentence(reason: string | null, channelName: string): string {
  switch (reason) {
    case "CHANNEL_ALREADY_ANSWERED":
      return "이 리뷰에는 채널에 이미 답변이 등록돼 있어, 답변이 두 번 달리지 않도록 안내를 시작하지 않습니다.";
    case "SOURCE_NOT_EXECUTABLE":
      return `이 리뷰는 ${channelName} 판매자센터 화면에서 찾아 드릴 수 없어, 안내를 시작할 수 없습니다.`;
    default:
      return `지금은 ${channelName} 판매자센터 안내를 시작할 수 없습니다.`;
  }
}

/** Evidence kinds whose locator label is a seller-authored title (a rule, a document, a remembered answer, an issue). */
const EVIDENCE_DETAIL_KINDS = new Set(["ORG_POLICY", "PRODUCT_KNOWLEDGE_DOC", "PAST_ANSWER", "REVIEW_ISSUE", "ISSUE_EVIDENCE", "REPEATED_INQUIRY", "IMPROVEMENT_OPPORTUNITY"]);

function evidenceOf(
  answer: OperatorAnswer, extra: ReadonlyArray<EvidenceArtifact["items"][number]> = [],
): EvidenceArtifact | null {
  if (answer.evidence.length === 0 && extra.length === 0) return null;
  // The seller's word for the source, then the row's own title when it reads as words (a document
  // title, a strength label) — never a token, a stamp or an id (Response Hygiene v1 §1).
  const labelOf = (kind: string, detail: string | null | undefined): string => {
    const source = SOURCE_LABEL[kind] ?? "자료";
    if (!EVIDENCE_DETAIL_KINDS.has(kind) || !isSellerSafeLabel(detail) || !/[가-힣]/.test(detail) || detail === source) return source;
    return detail.includes(source) ? detail : `${source} · ${detail}`;
  };
  return {
    artifactId: "a-evidence", type: "EVIDENCE", title: "확인한 자료",
    items: answer.evidence.slice(0, EVIDENCE_ITEMS_MAX).map((e) => ({
      label: labelOf(e.kind, e.locator.label),
      count: e.locator.count ?? null,
      from: e.events?.from ?? null, to: e.events?.to ?? null, asOf: e.asOf,
      covered: e.coverage === "COVERED",
      ...(e.locator.productId ? { link: `/products/${e.locator.productId}` }
        : e.locator.inquiryId ? { link: `/inquiries/${e.locator.inquiryId}` } : {}),
    })).concat(extra),
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

/**
 * Up to three prompt chips from the set's kind, plus the workspace link. Examples, never capabilities.
 *
 * @param drewSet whether THIS turn put the set on screen. A conversation stays anchored on the last set
 *     it saw so that 「그중…」 keeps a referent, and that carried-forward anchor used to reach here: an
 *     org-scope answer about a shipping policy came with 「첫 번째 거 답변 준비해줘」 attached, naming
 *     rows the answer had nothing to do with. Chips about a LIST need the list; chips about the
 *     ANCHORED inquiry do not, because the context bar is still naming it on screen.
 */
function suggestionsFor(
  primary: Artifact | null, workingSet: WorkingSetView | null, human: HumanActionRequiredArtifact | null,
  artifacts: readonly Artifact[], drewSet = true,
): SuggestedAction[] {
  const chips: SuggestedAction[] = [];
  if (human) {
    // 「계속 확인하기」 re-checks a step's own record; a step with nothing to re-check (registering a
    // rule) must not offer it. And a turn that is WAITING on the seller offers that step and nothing
    // else — a chip repeating the request that just stopped is the loop the seller is already in.
    if (human.resumable) chips.push({ label: "계속 확인하기", kind: "RESUME" });
    if (human.actionType === "REVIEW_IMPORT" && artifacts.some((a) => a.type === "REVIEW_LIST" && a.items.length > 0)) {
      chips.push({ label: "일단 확인된 리뷰 보기", kind: "LINK", to: "/reviews" });
    }
    return chips;
  }
  if (primary?.type === "DRAFT" && primary.version) {
    // The draft card carries 「말투 다듬기」 and 「보내기 준비」 as its own controls; a chip row repeating
    // them under the card is the same two actions twice (Conversation UX v2 §D).
  } else if (primary?.type === "APPROVAL_REQUIRED" || primary?.type === "APPROVAL" || primary?.type === "GUIDED_EXECUTION") {
    // The next move is the artifact's own control; no prompt competes with it.
  } else if (workingSet) {
    switch (workingSet.kind) {
      case "REVIEWS": {
        // Agent Object v1: standing ON one review, the next moves are about THAT review — and the
        // reply move is offered only when the channel actually takes one (the card's own capability).
        const detail = artifacts.find((a) => a.type === "REVIEW_DETAIL");
        if (workingSet.selectedObject?.kind === "REVIEW") {
          if (detail?.type === "REVIEW_DETAIL" && detail.replyCapability === "DRAFTABLE") {
            chips.push(promptChip("답글 초안 준비해줘"));
          }
          chips.push(promptChip("같은 상품의 비슷한 리뷰도 보여줘"));
          break;
        }
        if (drewSet) chips.push(promptChip("안 좋은 것만 봐줘"), promptChip("상품별로 묶어줘"), promptChip("문의에서도 같은 문제가 있는지 봐줘"));
        break;
      }
      case "INQUIRIES":
        if (workingSet.selectedInquiry) {
          chips.push(promptChip("답변 준비해줘"));
          if (workingSet.selectedInquiry.productId) chips.push(promptChip("이 상품 기준으로 답변 준비해줘"));
          chips.push(promptChip("답변 안 한 문의만 보여줘"));
        } else if (drewSet) {
          // The chips are examples of what to say NEXT about what is on screen, so they follow the set:
          // one row has no 「첫 번째」 and no narrowing left to offer, and a set already ordered by
          // urgency is not re-offered a 「가장 최근 1개」 (Conversation UX v2 §D).
          const one = workingSet.count === 1;
          const ranked = artifacts.some((a) => a.type === "INQUIRY_LIST" && a.scope?.rank === "URGENCY");
          if (!one && !ranked) {
            chips.push(promptChip(workingSet.filters.inquiryIntent === "ROWS" ? "답변 안 한 것만 보여줘" : "배송 관련부터"));
            if (workingSet.filters.inquiryIntent === "ROWS") chips.push(promptChip("그중 가장 최근 1개만"));
          }
          // A RANKED list opens the row it judged first, and that row carries 「답변 준비」 as its own
          // control (Agentic Experience v2 §5). A chip under the card offering the same move is that
          // action twice, six inches apart, with the seller deciding which one is the real one.
          if (!ranked) chips.push(promptChip(one ? "답변 준비해줘" : "첫 번째 거 답변 준비해줘"));
        }
        break;
      case "ORDERS":
        if (drewSet) chips.push(promptChip("카페24만 봐봐"), promptChip("그때 리뷰나 문의에도 변화 있었어?"));
        break;
      case "PRODUCTS":
        if (drewSet) chips.push(promptChip("문의에서도 같은 문제가 있는지 봐줘"));
        break;
      case "ISSUES":
        if (drewSet) chips.push(promptChip("어느 상품이 제일 많아?"));
        break;
    }
  }
  const links = chips.slice(0, 3);
  // A chip that repeats a control already on screen is a second copy of one action (Conversation UX
  // v2 §D): the list card carries its own 「문의 화면에서 …」 link, and 「전체 N건」 beside a RANKED list
  // would also contradict it — the set is the few rows the answer named, not the queue behind them.
  const alreadyLinked = artifacts.some((a) =>
    (a.type === "INQUIRY_LIST" || a.type === "REVIEW_LIST" || a.type === "LIST")
    && a.more?.to === WORKSPACE_OF[workingSet?.kind ?? "INQUIRIES"].to);
  const ranked = artifacts.some((a) => a.type === "INQUIRY_LIST" && a.scope?.rank === "URGENCY");
  // …and a single row needs no 「전체 1건 처리하기」: the card in front of the seller IS that one row.
  if (workingSet && workingSet.count > 1 && !alreadyLinked && !ranked) {
    const ws = WORKSPACE_OF[workingSet.kind];
    links.push({ label: `전체 ${workingSet.count}건 처리하기`, kind: "LINK", to: ws.to });
  }
  return links;
}

/* ─────────────── R3 / R4 / R6 helpers ─────────────── */

const NUMBER = /\d[\d,]*/g;

/** The backend's generic basis note — the card's title already says it, so the prose does not. */
const GENERIC_BASIS_NOTE = /^답변 기준이 필요합니다\.?$/;

/**
 * <b>Was the company profile the whole question, or one input among several?</b> — asked of the plan,
 * which already answered it (Agent Semantic Ownership v1 §3).
 *
 * The 「회사 정보에는…」 finding is produced in exactly one place, the `COMPANY_PROFILE` branch of
 * InquiryOps, so its existence proves the planner wanted the profile. What it does NOT prove is that
 * the seller asked to READ it: traced live 2026-09-06, 「우리 회사 특성 고려하면 배송 문의에 어떻게
 * 답하는 게 좋을까」 declares `COMPANY_PROFILE` beside `POLICY` and `PAST_ANSWER`, and reading the whole
 * introduction back on that turn is the noise §3 was written to stop. Being the run's ONLY need is the
 * difference, and it is the planner's own token — no sentence is read.
 *
 * <b>It replaces a regex that got this wrong in the seller's favour and against it.</b> The old
 * `/(회사|우리|저희).{0,12}(어떤 곳|소개|…)/` missed 「우리 회사는 어떤 회사야?」 and 「우리 회사에 대해
 * 알려줘」 — both planned as the sole `COMPANY_PROFILE` need — and replaced the seller's own summary
 * with 「등록된 회사 정보를 참고했습니다」 on the two most ordinary ways to ask.
 */
export function companyIsTheQuestion(answer: OperatorAnswer): boolean {
  return answer.needs.length === 1 && answer.needs[0]!.kind === "COMPANY_PROFILE";
}

/**
 * A finding's statement as the seller reads it (Response Hygiene v1 §3): the registered 회사 정보 is
 * referred to, not read back, unless the company itself was the question; a statement that carries an
 * internal token is not shown at all (the trace still has it).
 */
export function sellerSentence(statement: string, aboutCompany: boolean): string | null {
  if (statement.startsWith("회사 정보에는 이렇게 등록돼 있습니다")) {
    return aboutCompany ? statement : "등록된 회사 정보를 참고했습니다.";
  }
  if (INTERNAL_TOKEN.test(statement)) return null;
  return statement;
}

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
    // A ref that carries the id without the name is named by the entity the run resolved (found live:
    // a remembered answer's product read as 「(이름 없는 상품)」 under the product it was about).
    const resolvedName = entities.find((e) => e.kind === "PRODUCT" && e.id === productId)?.label ?? null;
    const row = rows.get(productId) ?? { name: ref.locator.productName ?? resolvedName ?? "(이름 없는 상품)", facts: new Map() };
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

/**
 * `CHANNEL_CONNECT` has been in {@code HumanActionType} and in {@link humanItem}'s labels since the
 * vocabulary was written and NOTHING had ever produced it. It is produced as a checklist ITEM rather
 * than a `HUMAN_ACTION_REQUIRED` artifact on purpose — that artifact makes the turn `WAITING_HUMAN` and
 * leaves a pending action later turns try to settle from {@code GET /api/sync-runs}, and connecting a
 * channel is not a sync run. What the item SAYS, and when it appears, is
 * {@link import("../operator/procedure/Procedure").nextStepFor}'s — one place, two callers.
 */

/** Artifacts that report ROWS — the ones whose emptiness is a claim about the seller's store. */
const ROW_BEARING: ReadonlySet<Artifact["type"]> = new Set<Artifact["type"]>([
  "INQUIRY_LIST", "REVIEW_LIST", "LIST", "PRODUCT_LIST", "OPPORTUNITY_LIST",
]);

/** Whether one row-bearing artifact came back with nothing in it. */
function isEmptyRowArtifact(a: Artifact): boolean {
  if (a.type === "INQUIRY_LIST") return a.groups.every((g) => g.items.length === 0);
  if (a.type === "REVIEW_LIST" || a.type === "LIST" || a.type === "PRODUCT_LIST" || a.type === "OPPORTUNITY_LIST") {
    return a.items.length === 0;
  }
  return false;
}

function humanItem(actionType: string, channel: string | null, to: string | null): { label: string; to?: string } {
  const label = actionType === "REVIEW_IMPORT" ? `${channel ?? "채널"} 리뷰 가져오기`
    : actionType === "KNOWLEDGE_ENTRY" ? "답변 기준 등록하기"
      : actionType === "CHANNEL_CONNECT" ? `${channel ?? "채널"} 연결하기` : "규격 확인하기";
  return { label, ...(to ? { to } : {}) };
}

/** Type-level use so an unused-import lint never removes the draft artifact shape from this file's vocabulary. */
export type { DraftArtifact as ConversationDraftArtifact };

/* ───────────── Knowledge Capture v1 helpers ───────────── */

/** The card for one capture state. `content` is the seller's normalized sentence and nothing else. */
function captureArtifact(
  pending: PendingKnowledgeCapture, state: KnowledgeCaptureArtifact["state"],
  extra: { content?: string; fingerprint?: string; existing?: ExistingKnowledge; resume?: KnowledgeCaptureArtifact["resume"] },
): KnowledgeCaptureArtifact {
  return {
    artifactId: `a-capture-${pending.captureId}-${state.toLowerCase()}`, type: "KNOWLEDGE_CAPTURE",
    title: state === "SAVED" ? `${pending.topicLabel} 기준 저장됨` : state === "CANDIDATE" ? `${pending.topicLabel} 기준으로 저장` : `${pending.topicLabel} 기준`,
    captureId: pending.captureId, state, scope: pending.scope, topicLabel: pending.topicLabel,
    productId: pending.productId, productName: pending.productName, variantName: pending.variantName,
    inquiryId: pending.inquiryId, question: pending.question,
    content: extra.content ?? null, fingerprint: extra.fingerprint ?? null,
    existing: extra.existing ? { title: extra.existing.title, excerpt: excerpt(extra.existing.body) } : null,
    resume: extra.resume ?? null, settingsTo: settingsPathFor(pending.scope, pending.productId),
  };
}

/** A capture opened this turn gets this turn's id (and, for a GOAL resume, the turn to re-run). */
function stampCapture(pending: PendingKnowledgeCapture | null, turnId: string): PendingKnowledgeCapture | null {
  if (!pending) return null;
  const resume = pending.resume.kind === "GOAL" && pending.resume.turnId === "" ? { kind: "GOAL" as const, turnId } : pending.resume;
  return pending.turnId === "" ? { ...pending, turnId, resume } : pending;
}

/** A carried gap survives a turn unless the seller now stands on a different inquiry. */
function carriedCapture(pending: PendingKnowledgeCapture | null, workingSet: WorkingSetView | null): PendingKnowledgeCapture | null {
  if (!pending) return null;
  const now = workingSet?.selectedInquiry?.inquiryId ?? null;
  if (pending.inquiryId && now && now !== pending.inquiryId) return null;
  return pending;
}

/** Did the previous AGENT turn save a capture? Then this turn is its one resume and opens no new gap. */
function lastTurnSavedCapture(view: ConversationView): boolean {
  const last = [...view.turns].reverse().find((t) => t.role === "AGENT");
  return last?.artifacts.some((a) => a.type === "KNOWLEDGE_CAPTURE" && a.state === "SAVED") ?? false;
}
