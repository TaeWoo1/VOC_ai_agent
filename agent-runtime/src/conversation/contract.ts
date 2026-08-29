/**
 * Reviewnary Agentic Operating Workspace v2 — the CONVERSATION wire contract.
 *
 * <p>This is the one surface the frontend's conversation UI calls. It sits BESIDE the run contract
 * (`http/contract.ts`), not on top of it: a run is one investigation, a conversation is the seller's
 * working relationship with the AI operator across many turns — it remembers what was looked at, what
 * was filtered, what is waiting on a human, and what was prepared.
 *
 * <p><b>Three rules this file exists to hold.</b>
 * <ol>
 *   <li><b>Artifacts are a closed vocabulary.</b> The model never names a component; the runtime
 *       composes one of the {@link ArtifactType}s below from tool evidence, and a result that fits no
 *       dedicated artifact is a {@code LIST} / {@code TABLE} / {@code SUMMARY}. Adding a type here is a
 *       product decision, never a per-request one.</li>
 *   <li><b>Identity + bounded context, never a second copy of the customer.</b> The persisted form of a
 *       turn keeps ids, closed-vocabulary labels, counts and dates. Fields marked <i>transient</i>
 *       (a review preview, an inquiry title, a draft body) are present on the live response and
 *       STRIPPED by {@code persistable()} before the conversation is stored — a reload re-reads them
 *       from the surface that owns them.</li>
 *   <li><b>Nothing here sends.</b> {@code HUMAN_ACTION_REQUIRED} asks the seller for one step;
 *       {@code APPROVAL} names the exact draft version a Human Approval would bind to; execution and
 *       verification remain the backend Action Executor's, reached only through the existing
 *       inquiry approval path. The runtime's tool catalogue is still 100% READ.</li>
 * </ol>
 */
import { z } from "zod";
import type { OperatorAnswer } from "../operator/state/OperatorState";
import type { ChannelDataState } from "../spring/types";

/* ───────────────────────────────── artifacts ───────────────────────────────── */

export type ArtifactType =
  | "SUMMARY"
  | "METRIC"
  | "LIST"
  | "TABLE"
  | "REVIEW_LIST"
  | "INQUIRY_LIST"
  | "PRODUCT_LIST"
  | "ISSUE_LIST"
  | "ORDER_SUMMARY"
  | "CHART"
  | "DRAFT"
  | "EVIDENCE"
  | "CHECKLIST"
  | "HUMAN_ACTION_REQUIRED"
  | "APPROVAL"
  | "GUIDED_EXECUTION"
  | "EXECUTION_RESULT"
  | "WORKSPACE_LINK";

export type StatusTone = "good" | "warn" | "bad" | "info" | "neutral";

export interface WorkspaceLink {
  readonly label: string;
  /** An app route. Never an external URL. */
  readonly to: string;
  readonly count?: number;
}

interface ArtifactBase {
  readonly artifactId: string;
  readonly type: ArtifactType;
  /** The seller's word for what this is — 「오늘 들어온 리뷰」, never a tool or enum name. */
  readonly title: string;
  /** What was NOT seen, when anything was not. Rendered whenever present. */
  readonly note?: string;
}

export interface SummaryArtifact extends ArtifactBase {
  readonly type: "SUMMARY";
  readonly lines: readonly string[];
}

export interface MetricArtifact extends ArtifactBase {
  readonly type: "METRIC";
  readonly metrics: ReadonlyArray<{
    readonly label: string;
    readonly value: number;
    readonly unit: "건" | "원" | "%" | "";
    readonly previous?: number | null;
    readonly deltaPercent?: number | null;
    readonly to?: string;
  }>;
}

export interface ListArtifact extends ArtifactBase {
  readonly type: "LIST";
  readonly items: ReadonlyArray<{
    readonly id: string;
    readonly primary: string;
    readonly secondary?: string;
    readonly status?: { readonly label: string; readonly tone: StatusTone };
    readonly to?: string;
  }>;
  readonly totalCount?: number;
  readonly more?: WorkspaceLink;
}

export interface TableArtifact extends ArtifactBase {
  readonly type: "TABLE";
  readonly columns: ReadonlyArray<{ readonly key: string; readonly label: string; readonly align?: "left" | "right" }>;
  readonly rows: ReadonlyArray<Readonly<Record<string, string | number | null>>>;
}

export type PeriodToken =
  | "TODAY"
  | "YESTERDAY"
  | "LAST_7_DAYS"
  | "LAST_14_DAYS"
  | "LAST_30_DAYS"
  | "THIS_WEEK"
  | "LAST_WEEK";

export interface DateWindow {
  readonly from: string;
  readonly to: string;
  readonly token: PeriodToken | null;
}

export type FreshnessVerdict = "FRESH" | "UNPROVEN" | "NOT_COLLECTED" | "NOT_SUPPORTED" | "NOT_CONNECTED";

/** One channel's ability to say 「새 리뷰」 right now. Read from `/api/channels/coverage` semantics. */
export interface FreshnessRow {
  readonly channelCode: string;
  readonly channelNameKo: string | null;
  readonly state: ChannelDataState;
  readonly verdict: FreshnessVerdict;
  readonly lastSuccessfulSyncAt: string | null;
  readonly newestObservedAt: string | null;
}

export interface ReviewItem {
  readonly reviewId: string;
  readonly accountId: string;
  readonly channelCode: string;
  readonly channelNameKo: string | null;
  readonly writtenOn: string | null;
  readonly rating: number | null;
  readonly negative: boolean;
  /** transient — the backend's sanitized preview, stripped before persistence. */
  readonly preview?: string | null;
  readonly productId: string | null;
  readonly productName: string | null;
  readonly executableIdentity?: ExecutableIdentity;
  readonly to: string;
}

export interface ReviewListArtifact extends ArtifactBase {
  readonly type: "REVIEW_LIST";
  readonly scope: {
    readonly channelCode: string | null;
    readonly period: DateWindow | null;
    readonly rating: "ALL" | "LOW";
    readonly productId?: string | null;
  };
  readonly totalCount: number;
  readonly items: readonly ReviewItem[];
  readonly freshness: readonly FreshnessRow[];
  /**
   * Whether THIS question needed current rows (「오늘 / 어제 / 이번 주」). A stale channel under a
   * required read is a gap the answer must name; under a non-required read the rows answer the
   * question as of their last observation and a refresh is merely offered. Absent (older turns) = false.
   */
  readonly freshnessRequired?: boolean;
  /** The observation date the as-of phrases were rendered against (`YYYY-MM-DD`, seller time). */
  readonly referenceDate?: string;
  readonly more?: WorkspaceLink;
}

export type InquiryGroupKey = "DRAFT_READY" | "NEEDS_CLARIFICATION" | "KNOWLEDGE_MISSING" | "UNANSWERED" | "ANSWERED";

export interface InquiryItem {
  /** The open/proposed work item, when one exists. A ROWS read shows answered inquiries too, and those have none. */
  readonly workItemId: string | null;
  readonly inquiryId: string;
  readonly channelCode: string | null;
  readonly channelNameKo: string | null;
  readonly receivedAt: string;
  readonly phase: string;
  readonly status: string;
  /** transient — the customer's subject line, stripped before persistence. */
  readonly title?: string | null;
  readonly productId: string | null;
  readonly productName: string | null;
  readonly answerBasis: string | null;
  readonly sourceSubtype?: string | null;
  readonly executableIdentity?: ExecutableIdentity;
  readonly to: string;
}

export interface InquiryListArtifact extends ArtifactBase {
  readonly type: "INQUIRY_LIST";
  readonly groups: ReadonlyArray<{ readonly key: InquiryGroupKey; readonly label: string; readonly items: readonly InquiryItem[] }>;
  readonly totalCount: number;
  readonly more?: WorkspaceLink;
  /**
   * The QuerySpec a ROWS read executed (Query Accuracy v1) — absent on a WORKLOAD list. The working set
   * copies it so a follow-up (「그중 네이버만」) refines the same read instead of starting a new one.
   */
  readonly scope?: {
    readonly period: DateWindow | null;
    readonly channelCode: string | null;
    readonly status: "UNANSWERED" | "ANSWERED" | "ALL";
    readonly order: "NEWEST" | "OLDEST";
    readonly limit: number | null;
  };
}

export interface ProductListArtifact extends ArtifactBase {
  readonly type: "PRODUCT_LIST";
  readonly items: ReadonlyArray<{
    readonly productId: string;
    readonly productName: string;
    readonly facts: ReadonlyArray<{ readonly label: string; readonly count: number }>;
    readonly to: string;
  }>;
}

export interface IssueListArtifact extends ArtifactBase {
  readonly type: "ISSUE_LIST";
  readonly items: ReadonlyArray<{
    readonly issueId: string;
    readonly title: string;
    readonly severity: string;
    readonly evidenceCount: number;
    readonly firstOn: string | null;
    readonly lastOn: string | null;
    readonly productId: string | null;
    readonly productName: string | null;
    readonly to: string;
  }>;
}

export interface OrderSummaryArtifact extends ArtifactBase {
  readonly type: "ORDER_SUMMARY";
  readonly period: DateWindow & { readonly days: number };
  readonly channelCode: string | null;
  readonly totals: {
    readonly orders: number;
    readonly sales: number;
    readonly previousOrders: number | null;
    readonly previousSales: number | null;
    readonly ordersDeltaPercent: number | null;
    readonly salesDeltaPercent: number | null;
  };
  readonly channels: ReadonlyArray<{
    readonly channelCode: string;
    readonly channelNameKo: string;
    readonly orders: number;
    readonly sales: number;
    readonly state: ChannelDataState;
  }>;
  readonly exampleDataIncluded: boolean;
  readonly exclusions: readonly string[];
  readonly to: string;
}

export interface ChartArtifact extends ArtifactBase {
  readonly type: "CHART";
  readonly unit: "원" | "건";
  readonly series: ReadonlyArray<{ readonly key: string; readonly label: string; readonly points: ReadonlyArray<{ readonly date: string; readonly value: number }> }>;
  readonly period: DateWindow;
  readonly caption?: string;
  readonly to?: string;
}

export interface DraftArtifact extends ArtifactBase {
  readonly type: "DRAFT";
  /** Defaults to INQUIRY for existing consumers. */
  readonly objectKind?: ObjectKind;
  /** REVIEW drafts: the review id + reply-work action ref + account; `workItemId`/`inquiryId` then carry the review id. */
  readonly accountId?: string;
  readonly actionRef?: string;
  readonly workItemId: string;
  readonly inquiryId: string;
  readonly channelCode: string | null;
  readonly channelNameKo: string | null;
  readonly version: number | null;
  readonly contentFingerprint: string | null;
  /** transient — the AI-written reply, re-read from the inquiry screen on reload. */
  readonly comments?: string | null;
  readonly authorKind: string | null;
  readonly answerBasis: string | null;
  readonly answerBasisNote: string | null;
  readonly knowledgeState: string | null;
  readonly evidenceCount: number;
  /**
   * Passages per lane, by the backend's own lane word (상품 정보 · 운영 정책 · 과거 답변 · 주문 상태) —
   * metadata only, kept on reload. The passage text lives on the inquiry screen (Knowledge Context v1-A).
   */
  readonly evidenceSummary?: ReadonlyArray<DraftEvidenceSummary>;
  readonly productId: string | null;
  readonly productName: string | null;
  readonly unavailableMessage: string | null;
  readonly tone: ToneHint | null;
  readonly to: string;
}

export interface DraftEvidenceSummary {
  readonly scopeLabel: string;
  readonly count: number;
}

export interface EvidenceArtifact extends ArtifactBase {
  readonly type: "EVIDENCE";
  readonly items: ReadonlyArray<{
    readonly label: string;
    readonly count: number | null;
    readonly from: string | null;
    readonly to: string | null;
    readonly asOf: string | null;
    readonly covered: boolean;
    readonly link?: string;
  }>;
}

export interface ChecklistArtifact extends ArtifactBase {
  readonly type: "CHECKLIST";
  readonly items: ReadonlyArray<{ readonly label: string; readonly detail?: string; readonly to?: string }>;
}

export type HumanActionType = "REVIEW_IMPORT" | "CHANNEL_CONNECT" | "KNOWLEDGE_ENTRY" | "VARIANT_CLARIFICATION";
/**
 * HOW the seller's step happens. `EXPORT_ACTION_WINDOW` / `WING_READ_ACTION_WINDOW` are reviewnary-guided
 * seller-center flows through the paired local agent (the product prepares the screen, the seller performs
 * only the platform's own confirmations, reviewnary detects and ingests); `MANUAL_SYNC` is the product's
 * own one-press API collection; `FILE_UPLOAD` is the explicit fallback when no local agent is paired;
 * `WORKSPACE` is a screen where the seller supplies something.
 */
export type HumanActionPath = "MANUAL_SYNC" | "ACTION_WINDOW" | "EXPORT_ACTION_WINDOW" | "WING_READ_ACTION_WINDOW" | "FILE_UPLOAD" | "WORKSPACE";
export type HumanActionReason = "FRESHNESS_UNPROVEN" | "NOT_COLLECTED" | "NOT_CONNECTED" | "NO_ANSWER_BASIS";

/**
 * A step only the seller can take, stated as a first-class state rather than a failure.
 *
 * `path` says HOW: `MANUAL_SYNC` — the product's own one-press collection (`POST /api/seller-accounts/
 * {accountId}/sync`, a READ of the channel the seller already connected); `ACTION_WINDOW` / `FILE_UPLOAD`
 * — an existing manual flow reached through `to`; `WORKSPACE` — a screen where the seller supplies
 * something (a knowledge entry). The conversation resumes the original request afterwards.
 */
export interface HumanActionRequiredArtifact extends ArtifactBase {
  readonly type: "HUMAN_ACTION_REQUIRED";
  readonly actionType: HumanActionType;
  readonly reason: HumanActionReason;
  readonly path: HumanActionPath;
  readonly channelCode: string | null;
  readonly channelNameKo: string | null;
  readonly accountId: string | null;
  readonly dataType: "REVIEW" | "INQUIRY" | "ORDER_SUMMARY" | null;
  readonly to: string | null;
  readonly requestedAt: string;
  readonly resumable: boolean;
  /** Whether this path needs the paired local agent (`ai.sellerops.local-agent`). */
  readonly requiresLocalAgent?: boolean;
  /** The fallback the seller may take when the guided path is unavailable (never the default). */
  readonly fallback?: { readonly path: HumanActionPath; readonly to: string | null; readonly label: string };
  /** The channel's last successful observation (ISO instant) — the 「언제 기준」 the reason names. */
  readonly asOf?: string | null;
  /**
   * An OFFER, not a gate: the rows already answered the question as of `asOf`, and this step only makes
   * them current. The turn is DONE, not WAITING_HUMAN; the card is compact (「최신 상태로 갱신」).
   */
  readonly optional?: boolean;
}

/** What kind of operational object an approval / draft / execution is about. */
export type ObjectKind = "INQUIRY" | "REVIEW";

/**
 * Whether the object can be acted on at the marketplace. Decided by the BACKEND from stored acquisition
 * provenance (trusted marketplace/API run, exact seller-account binding, provider object identity) —
 * never from a channel label, a file shape or an id prefix. `NONE` objects get drafts, never sends.
 */
export type ExecutableIdentity = "MARKETPLACE" | "NONE";

/** The closed capability vocabulary the runtime reasons with (docs/agentic_operating_workspace_v2.md §Capability). */
export type AcquisitionCapability = "AUTOMATIC" | "GUIDED_HUMAN_ACTION" | "UNSUPPORTED";
export type ExecutionCapability = "API_EXECUTION" | "GUIDED_BROWSER_EXECUTION" | "NOT_SUPPORTED";

export interface ApprovalArtifact extends ArtifactBase {
  readonly type: "APPROVAL";
  readonly objectKind: ObjectKind;
  /** INQUIRY: the work item; REVIEW: the review id. */
  readonly targetId: string;
  /** INQUIRY only — kept for existing consumers. */
  readonly workItemId?: string;
  readonly inquiryId?: string;
  /** REVIEW only — the seller account and the reply-work action ref the review approval seam uses. */
  readonly accountId?: string;
  readonly actionRef?: string;
  readonly channelCode: string | null;
  readonly channelNameKo: string | null;
  readonly draftVersion: number | null;
  readonly contentFingerprint: string | null;
  readonly execution: ExecutionCapability;
  readonly executableIdentity: ExecutableIdentity;
  readonly to: string;
}

/**
 * A marketplace action the seller finishes in the platform's own UI, prepared by reviewnary through the
 * local agent: the exact object is located, the approved draft is placed in the composer only after the
 * identity check passes, and the final submit is the seller's click. Never an automatic submit.
 */
export interface GuidedExecutionArtifact extends ArtifactBase {
  readonly type: "GUIDED_EXECUTION";
  readonly actionType: "REVIEW_REPLY";
  readonly objectKind: "REVIEW";
  readonly channelCode: string;
  readonly channelNameKo: string | null;
  readonly accountId: string;
  readonly reviewId: string;
  readonly actionRef: string;
  readonly draftVersion: number | null;
  readonly contentFingerprint: string | null;
  readonly requiresLocalAgent: true;
  readonly to: string;
}

export interface ExecutionResultArtifact extends ArtifactBase {
  readonly type: "EXECUTION_RESULT";
  readonly objectKind: ObjectKind;
  readonly targetId: string;
  /** INQUIRY only — kept for existing consumers. */
  readonly workItemId?: string;
  readonly phase: string;
  readonly executionStatus: string;
  readonly category: string;
  /** Closed: VERIFIED | STATUS_UNRESOLVED | DELIVERY_UNKNOWN | UNVERIFIABLE | COMPOSER_FILLED | SELLER_SUBMISSION_OBSERVED | SUBMISSION_OBSERVED_CONTENT_UNVERIFIED */
  readonly verification: string;
  readonly to: string;
}

export interface WorkspaceLinkArtifact extends ArtifactBase {
  readonly type: "WORKSPACE_LINK";
  readonly link: WorkspaceLink;
}

export type Artifact =
  | SummaryArtifact
  | GuidedExecutionArtifact
  | MetricArtifact
  | ListArtifact
  | TableArtifact
  | ReviewListArtifact
  | InquiryListArtifact
  | ProductListArtifact
  | IssueListArtifact
  | OrderSummaryArtifact
  | ChartArtifact
  | DraftArtifact
  | EvidenceArtifact
  | ChecklistArtifact
  | HumanActionRequiredArtifact
  | ApprovalArtifact
  | ExecutionResultArtifact
  | WorkspaceLinkArtifact;

/* ───────────────────────────────── plan vocabulary ───────────────────────────────── */

/** What the seller asked the operator to DO beyond reading. Planner-decided, closed. */
export type RequestedAction = "NONE" | "PREPARE_INQUIRY_DRAFT" | "REQUEST_SEND_APPROVAL" | "OPEN_WORKSPACE" | "LIST_ACTIONS" | "EXPLAIN_CAPABILITY";

/** A closed tone adjustment for a draft. Style only — the facts section is byte-identical. */
export type ToneHint = "SOFTER" | "MORE_FORMAL" | "SHORTER";

export interface PlanFilters {
  readonly period: PeriodToken | null;
  readonly rating: "ALL" | "LOW" | null;
  readonly channel: "NAVER" | "COUPANG" | "CAFE24" | null;
  /** `WORKING_SET` = a follow-up over what the previous turn showed; `ORG` = start over. */
  readonly scope: "WORKING_SET" | "ORG" | null;
  readonly topic: "SHIPPING" | "EXCHANGE_RETURN" | "PRODUCT_SPEC" | "USAGE" | "OTHER" | null;
  /**
   * What a REVIEW_SIGNAL need is for (Acceptance Closure §9): the rows (`ROWS`) or the repeated problems
   * across them (`ISSUES`). A closed plan token; absent ⇒ the legacy reading (period/rating decide).
   */
  readonly reviewIntent: "ROWS" | "ISSUES" | null;
  /**
   * Query Accuracy v1 (2026-08-28) — the typed QuerySpec the runtime executes VERBATIM. What an
   * INQUIRY_VOLUME need is for: the customer's inquiries as rows (`ROWS`), the seller's work queue
   * (`WORKLOAD`), or one number (`COUNT`). Absent ⇒ derived from the other spec fields, never from words.
   */
  readonly inquiryIntent: "ROWS" | "WORKLOAD" | "COUNT" | null;
  /** How many rows the seller asked for (「1개만」, 「3개」). Clamped by the parser; null = the read's default page. */
  readonly limit: number | null;
  /** Which end of the window comes first. Absent ⇒ NEWEST. */
  readonly order: "NEWEST" | "OLDEST" | null;
  /** Which inquiries: still unanswered, already answered, or all. Absent ⇒ ROWS reads ALL. */
  readonly status: "UNANSWERED" | "ANSWERED" | "ALL" | null;
}

export interface PlanTarget {
  readonly selector: "FIRST" | "NTH" | "ALL" | "THIS" | "NONE";
  readonly index: number | null;
}

/* ───────────────────────────────── conversation state ───────────────────────────────── */

export type WorkingSetKind = "REVIEWS" | "INQUIRIES" | "PRODUCTS" | "ORDERS" | "ISSUES";

/**
 * What the last turn put in front of the seller — ids and closed filters, nothing a customer wrote.
 * Bounded: at most {@link WORKING_SET_MAX_IDS} ids.
 */
export interface WorkingSetView {
  readonly kind: WorkingSetKind;
  readonly label: string;
  readonly count: number;
  readonly ids: readonly string[];
  readonly filters: {
    readonly period?: DateWindow | null;
    readonly channelCode?: string | null;
    readonly rating?: "ALL" | "LOW";
    readonly productIds?: readonly string[];
    readonly topic?: PlanFilters["topic"];
    /** Query Accuracy v1: which inquiry read produced the set, and the status it was read with. */
    readonly inquiryIntent?: "ROWS" | "WORKLOAD";
    readonly status?: "UNANSWERED" | "ANSWERED" | "ALL";
    /** The order the set was read in — a refine re-reads in THIS order so the base set is reproduced before it re-sorts. */
    readonly order?: "NEWEST" | "OLDEST";
  };
  /** Products the set is about, when known — the anchor for a cross-domain follow-up. */
  readonly productIds: readonly string[];
  /** Inquiry work items in the set, in shown order — the anchor for 「첫 번째 거」. */
  readonly workItemIds: readonly string[];
  readonly turnId: string;
}

export const WORKING_SET_MAX_IDS = 50;

export interface PendingHumanAction {
  readonly turnId: string;
  /** Mirrors the artifact: an offered refresh, never a reason to wait or to gate a later read. */
  readonly optional?: boolean;
  readonly actionType: HumanActionType;
  readonly path: HumanActionPath;
  readonly channelCode: string | null;
  readonly accountId: string | null;
  readonly dataType: "REVIEW" | "INQUIRY" | "ORDER_SUMMARY" | null;
  readonly requestedAt: string;
}

export interface PendingPreparedAction {
  readonly turnId: string;
  readonly kind: "INQUIRY_DRAFT" | "REVIEW_DRAFT";
  /** INQUIRY_DRAFT: work item + inquiry ids. REVIEW_DRAFT: `workItemId` = review id, `inquiryId` = actionRef, plus `accountId`. */
  readonly workItemId: string;
  readonly inquiryId: string;
  readonly accountId?: string;
  readonly draftVersion: number | null;
  readonly contentFingerprint: string | null;
}

export interface SuggestedAction {
  readonly label: string;
  readonly kind: "PROMPT" | "LINK" | "RESUME";
  readonly prompt?: string;
  readonly to?: string;
}

export type TurnStatus = "DONE" | "FAILED" | "WAITING_HUMAN";

export interface TurnView {
  readonly turnId: string;
  readonly conversationId: string;
  readonly role: "USER" | "AGENT";
  /** The seller's own sentence (USER turns). */
  readonly text?: string;
  /** The operator's sentence(s) — deterministic prose over the artifacts, never model-written. */
  readonly message: string;
  readonly artifacts: readonly Artifact[];
  readonly suggestedActions: readonly SuggestedAction[];
  readonly continuation: {
    readonly workingSet: WorkingSetView | null;
    /** The first pending action — kept for existing consumers; `pendingHumanActions` is the full list. */
    readonly pendingHumanAction: PendingHumanAction | null;
    readonly pendingHumanActions?: readonly PendingHumanAction[];
    readonly pendingPrepared: PendingPreparedAction | null;
  };
  readonly status: TurnStatus;
  readonly failureCode?: string;
  readonly failureReason?: string;
  readonly budget?: {
    readonly toolCalls: number;
    readonly llmCalls: number;
    readonly elapsedMs: number;
    readonly stopReason: string;
  };
  /** Which turn this one resumed, when it did. */
  readonly resumedFrom?: string;
  readonly createdAt: string;
  /** transient — the full operator answer for the evidence disclosure. Never persisted. */
  readonly answer?: OperatorAnswer;
}

export interface ConversationView {
  readonly conversationId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly turns: readonly TurnView[];
  readonly workingSet: WorkingSetView | null;
  readonly pendingHumanAction: PendingHumanAction | null;
  readonly pendingHumanActions?: readonly PendingHumanAction[];
  readonly pendingPrepared: PendingPreparedAction | null;
}

export interface ConversationSummary {
  readonly conversationId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly turnCount: number;
  /** The first user sentence, trimmed to 80 chars — the seller's own words, their own list. */
  readonly headline: string | null;
}

/* ───────────────────────────────── progress protocol ───────────────────────────────── */

export type ProgressStage =
  | "UNDERSTANDING"
  | "PLANNED"
  | "REFRESHING"
  | "READING"
  | "JUDGING"
  | "COMPOSING"
  | "PREPARING_DRAFT"
  | "WAITING_HUMAN";

/**
 * A stage the runtime actually reached, in order. The UI renders exactly what arrives — there is no
 * client-side timeline to animate ahead of the runtime.
 */
export interface ProgressStageEvent {
  readonly type: "stage";
  readonly stage: ProgressStage;
  /** Seller-facing, closed set — 「관련 리뷰를 확인하고 있습니다」. */
  readonly label: string;
  readonly at: string;
}

export interface ProgressTurnEvent {
  readonly type: "turn";
  readonly turn: TurnView;
}

export interface ProgressErrorEvent {
  readonly type: "error";
  readonly code: string;
  readonly message: string;
}

export type ProgressEvent = ProgressStageEvent | ProgressTurnEvent | ProgressErrorEvent;

export const STAGE_LABEL: Record<ProgressStage, string> = {
  UNDERSTANDING: "요청을 이해하고 있습니다.",
  PLANNED: "무엇을 확인할지 정했습니다.",
  REFRESHING: "최신 자료를 새로 가져오고 있습니다.",
  READING: "관련 자료를 확인하고 있습니다.",
  JUDGING: "확인한 내용을 검토하고 있습니다.",
  COMPOSING: "정리하고 있습니다.",
  PREPARING_DRAFT: "답변 초안을 준비하고 있습니다.",
  WAITING_HUMAN: "판매자님의 한 번의 작업이 필요합니다.",
};

/** Specialist-specific READING labels — a stage says WHAT is being read, not which class runs. */
export const READING_LABEL: Record<string, string> = {
  REVIEW_OPS: "관련 리뷰를 확인하고 있습니다.",
  INQUIRY_OPS: "문의를 확인하고 있습니다.",
  PRODUCT_OPS: "상품 정보를 확인하고 있습니다.",
  ORDER_OPS: "주문·매출 흐름을 확인하고 있습니다.",
  REPORT_OPS: "확인한 내용을 정리하고 있습니다.",
};

/* ───────────────────────────────── requests ───────────────────────────────── */

export const StartTurnRequestSchema = z
  .object({
    text: z.string().min(1).max(2000).optional(),
    productId: z.string().min(1).max(200).optional(),
    workItemId: z.string().min(1).max(200).optional(),
    channelCode: z.enum(["NAVER", "COUPANG", "CAFE24"]).optional(),
    surface: z.string().min(1).max(40).optional(),
    /** Re-run the request of an earlier turn (after a human step). `text` is ignored when present. */
    resumeOfTurnId: z.string().min(1).max(80).optional(),
    /** Whether the seller's local agent is paired, as the frontend last saw it. Closed; absent ⇒ UNKNOWN. */
    localAgent: z.enum(["PAIRED", "ABSENT", "UNKNOWN"]).optional(),
    referenceDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "referenceDate must be YYYY-MM-DD")
      .optional(),
  })
  .strict()
  .refine((r) => Boolean(r.text) || Boolean(r.resumeOfTurnId), {
    message: "a turn carries either text or resumeOfTurnId",
  });
export type StartTurnRequest = z.infer<typeof StartTurnRequestSchema>;

export const CONVERSATION_ID = /^[A-Za-z0-9._-]{1,80}$/;

/* ───────────────────────────────── persistence helper ───────────────────────────────── */

const MAX_TURNS_PERSISTED = 40;
const MAX_ITEMS_PERSISTED = 20;

/** The stored form of a turn: transient text fields stripped, lists bounded, `answer` dropped. */
export function persistableTurn(turn: TurnView): TurnView {
  const { answer: _answer, ...rest } = turn;
  return { ...rest, artifacts: turn.artifacts.map(persistableArtifact) };
}

export function persistableArtifact(artifact: Artifact): Artifact {
  switch (artifact.type) {
    case "REVIEW_LIST":
      return {
        ...artifact,
        items: artifact.items.slice(0, MAX_ITEMS_PERSISTED).map(({ preview: _p, ...item }) => item),
      };
    case "INQUIRY_LIST":
      return {
        ...artifact,
        groups: artifact.groups.map((g) => ({
          ...g,
          items: g.items.slice(0, MAX_ITEMS_PERSISTED).map(({ title: _t, ...item }) => item),
        })),
      };
    case "DRAFT": {
      const { comments: _c, ...rest } = artifact;
      return rest;
    }
    case "LIST":
      return { ...artifact, items: artifact.items.slice(0, MAX_ITEMS_PERSISTED) };
    case "TABLE":
      return { ...artifact, rows: artifact.rows.slice(0, MAX_ITEMS_PERSISTED) };
    default:
      return artifact;
  }
}

export function boundedTurns(turns: readonly TurnView[]): TurnView[] {
  return turns.slice(-MAX_TURNS_PERSISTED).map(persistableTurn);
}
