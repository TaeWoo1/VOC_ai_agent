/**
 * Wire types for the Agent Runtime's CONVERSATION surface — a hand-kept mirror of
 * `agent-runtime/src/conversation/contract.ts`. The runtime is the source of truth; this file only
 * repeats the shapes so the UI can type them. Nothing here is a Spring DTO.
 *
 * Privacy: fields marked transient (a review preview, an inquiry title, a draft body) arrive on a live
 * turn and are absent on a reloaded conversation — the runtime strips them before it persists.
 */
import type { OperatorAnswer } from "../agentRuntime/types";
import type { ChannelDataState } from "../types";

export type ArtifactType =
  | "SUMMARY"
  | "METRIC"
  | "LIST"
  | "TABLE"
  | "REVIEW_LIST"
  | "INQUIRY_LIST"
  | "INQUIRY_DETAIL"
  | "REVIEW_DETAIL"
  | "PRODUCT_LIST"
  | "ISSUE_LIST"
  | "OPPORTUNITY_LIST"
  | "ORDER_SUMMARY"
  | "CHART"
  | "DRAFT"
  | "EVIDENCE"
  | "CHECKLIST"
  | "HUMAN_ACTION_REQUIRED"
  | "APPROVAL_REQUIRED"
  | "APPROVAL"
  | "GUIDED_EXECUTION"
  | "EXECUTION_RESULT"
  | "ACQUISITION_RESULT"
  | "WORKSPACE_LINK"
  | "KNOWLEDGE_CAPTURE";

export type StatusTone = "good" | "warn" | "bad" | "info" | "neutral";

export interface WorkspaceLink {
  label: string;
  to: string;
  count?: number;
}

interface ArtifactBase {
  artifactId: string;
  type: ArtifactType;
  title: string;
  note?: string;
  /**
   * The sentence above this card already said what the title says — declared by whoever wrote both
   * (Agent Object + First-use Closure v1 §3). The renderer used to decide this by testing whether the
   * headline CONTAINED the title, a string search standing in for a fact only the producer knows.
   */
  titleSaid?: boolean;
}

export interface SummaryArtifact extends ArtifactBase {
  type: "SUMMARY";
  lines: string[];
}

export interface MetricArtifact extends ArtifactBase {
  type: "METRIC";
  metrics: Array<{
    label: string;
    value: number;
    unit: "건" | "원" | "%" | "";
    previous?: number | null;
    deltaPercent?: number | null;
    to?: string;
  }>;
}

export interface ListArtifact extends ArtifactBase {
  type: "LIST";
  items: Array<{
    id: string;
    primary: string;
    secondary?: string;
    status?: { label: string; tone: StatusTone };
    to?: string;
  }>;
  totalCount?: number;
  more?: WorkspaceLink;
}

export interface TableArtifact extends ArtifactBase {
  type: "TABLE";
  columns: Array<{ key: string; label: string; align?: "left" | "right" }>;
  rows: Array<Record<string, string | number | null>>;
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
  from: string;
  to: string;
  token: PeriodToken | null;
}

export type FreshnessVerdict = "FRESH" | "UNPROVEN" | "NOT_COLLECTED" | "NOT_SUPPORTED" | "NOT_CONNECTED";

export interface FreshnessRow {
  channelCode: string;
  channelNameKo: string | null;
  state: ChannelDataState;
  verdict: FreshnessVerdict;
  lastSuccessfulSyncAt: string | null;
  newestObservedAt: string | null;
}

export interface ReviewItem {
  reviewId: string;
  accountId: string;
  channelCode: string;
  channelNameKo: string | null;
  writtenOn: string | null;
  rating: number | null;
  negative: boolean;
  preview?: string | null;
  productId: string | null;
  productName: string | null;
  executableIdentity?: ExecutableIdentity;
  to: string;
}

export interface ReviewListArtifact extends ArtifactBase {
  type: "REVIEW_LIST";
  scope: { channelCode: string | null; period: DateWindow | null; rating: "ALL" | "LOW"; productId?: string | null };
  totalCount: number;
  items: ReviewItem[];
  freshness: FreshnessRow[];
  /** Whether THIS question needed current rows (「오늘 / 어제 / 이번 주」). Absent = false. */
  freshnessRequired?: boolean;
  /** The seller-time observation date (`YYYY-MM-DD`) the runtime rendered its as-of phrases against. */
  referenceDate?: string;
  more?: WorkspaceLink;
}

export type InquiryGroupKey = "DRAFT_READY" | "NEEDS_CLARIFICATION" | "KNOWLEDGE_MISSING" | "UNANSWERED" | "ANSWERED";

export interface InquiryItem {
  /** The open/proposed work item, when one exists; a ROWS list shows answered inquiries too, and those have none. */
  workItemId: string | null;
  inquiryId: string;
  channelCode: string | null;
  channelNameKo: string | null;
  receivedAt: string;
  /** Null for the same reason `workItemId` is: a record row that carries no work item carries no phase. */
  phase: string | null;
  status: string;
  title?: string | null;
  /** transient — the bounded, PII-masked opening of the customer's message. Absent on a reloaded thread. */
  snippet?: string | null;
  /** PRIORITIZE: whole days this inquiry has been waiting, as of the run's reference date. */
  waitingDays?: number | null;
  productId: string | null;
  productName: string | null;
  answerBasis: string | null;
  sourceSubtype?: string | null;
  executableIdentity?: ExecutableIdentity;
  to: string;
}

export interface InquiryListArtifact extends ArtifactBase {
  type: "INQUIRY_LIST";
  groups: Array<{ key: InquiryGroupKey; label: string; items: InquiryItem[] }>;
  totalCount: number;
  more?: WorkspaceLink;
  /** Query Accuracy v1: the QuerySpec a ROWS read executed; absent on a work-queue list. */
  scope?: {
    period: DateWindow | null;
    channelCode: string | null;
    status: "UNANSWERED" | "ANSWERED" | "ALL";
    order: "NEWEST" | "OLDEST";
    limit: number | null;
    /** Conversation Core v1: the closed topic family the read was narrowed by, when one was. */
    topic?: "SHIPPING" | "EXCHANGE_RETURN" | "PRODUCT_SPEC" | "USAGE" | "OTHER" | null;
    /** The seller's own subject word the read was narrowed by, when one was. */
    term?: string | null;
    /** PRIORITIZE: the rows are in urgency order, and the answer says by what. */
    rank?: "URGENCY" | null;
  };
}

/**
 * One inquiry, inspected (Agent Interaction Model v2 §4): the row's own closed facts plus a bounded,
 * transient excerpt of the customer's message. The answer to 「배송 문의 봐줘」 / 「이 문의 자세히」 /
 * a click on a shown row — never a re-list, never a workload conversion.
 */
export interface InquiryDetailArtifact extends ArtifactBase {
  type: "INQUIRY_DETAIL";
  inquiryId: string;
  workItemId: string | null;
  channelCode: string | null;
  channelNameKo: string | null;
  status: string;
  receivedAt: string | null;
  productId: string | null;
  productName: string | null;
  stateLabel: string;
  /** transient — a bounded excerpt of the customer's message; absent on a reloaded thread. */
  excerpt?: string | null;
  actionability: "DRAFTABLE" | "ALREADY_ANSWERED" | "AWAITING_SEND" | "NOT_WORKABLE";
  to: string;
}

/**
 * ONE review, inspected (Agent Object v1): the review's own closed facts, the customer's redacted
 * sentence (transient — absent on a reloaded thread), and the repeated problems it is evidence for.
 */
export interface ReviewDetailArtifact extends ArtifactBase {
  type: "REVIEW_DETAIL";
  reviewId: string;
  channelCode: string | null;
  channelNameKo: string | null;
  writtenOn: string | null;
  rating: number | null;
  negative: boolean;
  productId: string | null;
  productName: string | null;
  /** transient — the customer's redacted sentence; absent on a reloaded thread. */
  body?: string | null;
  bodyRedacted?: boolean;
  issues: Array<{ issueId: string; title: string; severity: string | null; to: string }>;
  replyCapability: "DRAFTABLE" | "NOT_SUPPORTED" | "UNKNOWN";
  to: string;
}

export interface ProductListArtifact extends ArtifactBase {
  type: "PRODUCT_LIST";
  items: Array<{ productId: string; productName: string; facts: Array<{ label: string; count: number }>; to: string }>;
  /** Where the rest is, when these rows are the head of a longer list rather than the whole of it. */
  more?: { label: string; to: string };
}

export interface IssueListArtifact extends ArtifactBase {
  type: "ISSUE_LIST";
  items: Array<{
    issueId: string;
    title: string;
    severity: string;
    evidenceCount: number;
    firstOn: string | null;
    lastOn: string | null;
    productId: string | null;
    productName: string | null;
    to: string;
  }>;
}

/** Mirrors the runtime's OpportunityListArtifact — derived improvement opportunities (Opportunity Engine v1). */
export interface OpportunityListArtifact extends ArtifactBase {
  type: "OPPORTUNITY_LIST";
  /** Null for the org; the product the rows were read for otherwise. */
  productId: string | null;
  items: Array<{
    issueId: string;
    kind: string;
    kindLabelKo: string;
    status: string;
    statusLabelKo: string;
    issueTitle: string;
    recommendationKo: string;
    evidenceCount: number;
    productId: string | null;
    productName: string | null;
    to: string;
  }>;
}

export interface OrderSummaryArtifact extends ArtifactBase {
  type: "ORDER_SUMMARY";
  period: DateWindow & { days: number };
  channelCode: string | null;
  totals: {
    orders: number;
    sales: number;
    previousOrders: number | null;
    previousSales: number | null;
    ordersDeltaPercent: number | null;
    salesDeltaPercent: number | null;
  };
  channels: Array<{ channelCode: string; channelNameKo: string; orders: number; sales: number; state: ChannelDataState }>;
  exampleDataIncluded: boolean;
  exclusions: string[];
  to: string;
}

export interface ChartArtifact extends ArtifactBase {
  type: "CHART";
  unit: "원" | "건";
  series: Array<{ key: string; label: string; points: Array<{ date: string; value: number }> }>;
  period: DateWindow;
  caption?: string;
  to?: string;
}

export type ToneHint = "SOFTER" | "MORE_FORMAL" | "SHORTER";

export interface DraftArtifact extends ArtifactBase {
  type: "DRAFT";
  objectKind?: ObjectKind;
  accountId?: string;
  actionRef?: string;
  workItemId: string;
  inquiryId: string;
  channelCode: string | null;
  channelNameKo: string | null;
  version: number | null;
  contentFingerprint: string | null;
  comments?: string | null;
  authorKind: string | null;
  answerBasis: string | null;
  answerBasisNote: string | null;
  /** The backend's one next-step sentence for a NO_ANSWER_BASIS — null otherwise. */
  answerBasisAction?: string | null;
  knowledgeState: string | null;
  evidenceCount: number;
  /** Passages per lane (상품 정보 · 운영 정책 · 과거 답변 · 주문 상태) — counts only, never text. */
  evidenceSummary?: ReadonlyArray<{ scopeLabel: string; count: number }>;
  /** Seller Context v1-B: the registered 회사 정보 was read as wording context. A flag, never the text, never a lane. */
  companyContextUsed?: boolean;
  productId: string | null;
  productName: string | null;
  unavailableMessage: string | null;
  tone: ToneHint | null;
  to: string;
}

export interface EvidenceArtifact extends ArtifactBase {
  type: "EVIDENCE";
  items: Array<{ label: string; count: number | null; from: string | null; to: string | null; asOf: string | null; covered: boolean; link?: string }>;
}

export interface ChecklistArtifact extends ArtifactBase {
  type: "CHECKLIST";
  items: Array<{ label: string; detail?: string; to?: string }>;
}

export type HumanActionType = "REVIEW_IMPORT" | "CHANNEL_CONNECT" | "KNOWLEDGE_ENTRY" | "VARIANT_CLARIFICATION";
export type HumanActionPath = "MANUAL_SYNC" | "ACTION_WINDOW" | "EXPORT_ACTION_WINDOW" | "WING_READ_ACTION_WINDOW" | "FILE_UPLOAD" | "WORKSPACE";
export type ObjectKind = "INQUIRY" | "REVIEW";
export type ExecutableIdentity = "MARKETPLACE" | "NONE";
export type AcquisitionCapability = "AUTOMATIC" | "GUIDED_HUMAN_ACTION" | "UNSUPPORTED";
export type ExecutionCapability = "API_EXECUTION" | "GUIDED_BROWSER_EXECUTION" | "NOT_SUPPORTED";
export type HumanActionReason = "FRESHNESS_UNPROVEN" | "NOT_COLLECTED" | "NOT_CONNECTED" | "NO_ANSWER_BASIS";

export interface HumanActionRequiredArtifact extends ArtifactBase {
  type: "HUMAN_ACTION_REQUIRED";
  actionType: HumanActionType;
  reason: HumanActionReason;
  path: HumanActionPath;
  channelCode: string | null;
  channelNameKo: string | null;
  accountId: string | null;
  dataType: "REVIEW" | "INQUIRY" | "ORDER_SUMMARY" | null;
  to: string | null;
  requestedAt: string;
  resumable: boolean;
  requiresLocalAgent?: boolean;
  fallback?: { path: HumanActionPath; to: string | null; label: string };
  /** The channel's last successful observation (ISO instant) — the 「언제 기준」 the card names. */
  asOf?: string | null;
  /** An OFFER under rows that already answered the question: compact card, no waiting. */
  optional?: boolean;
  /**
   * The seller's sentence WAS the instruction to collect, so the card starts its guided READ run on
   * arrival rather than rendering a button that asks for it again. Decided by the runtime, never here.
   */
  autoStart?: boolean;
}

/**
 * The seller's own approval of an exact draft version, asked for IN the conversation (Guided Reply UX
 * Smoothing v1 §1). Carries identity and the head the runtime saw — never the draft body, the customer's
 * sentence, the rating or the date: the card re-reads all of those from the review's own reply-prep view,
 * which is what makes it unable to approve something it did not just read.
 */
export interface ApprovalRequiredArtifact extends ArtifactBase {
  type: "APPROVAL_REQUIRED";
  objectKind: "REVIEW";
  reviewId: string;
  accountId: string;
  actionRef: string;
  channelCode: string;
  channelNameKo: string | null;
  productName: string | null;
  draftVersion: number;
  contentFingerprint: string;
  execution: ExecutionCapability;
  executableIdentity: ExecutableIdentity;
  to: string;
}

export interface ApprovalArtifact extends ArtifactBase {
  type: "APPROVAL";
  objectKind: ObjectKind;
  targetId: string;
  workItemId?: string;
  inquiryId?: string;
  accountId?: string;
  actionRef?: string;
  channelCode: string | null;
  channelNameKo: string | null;
  draftVersion: number | null;
  contentFingerprint: string | null;
  execution: ExecutionCapability;
  executableIdentity: ExecutableIdentity;
  to: string;
}

export interface GuidedExecutionArtifact extends ArtifactBase {
  type: "GUIDED_EXECUTION";
  actionType: "REVIEW_REPLY";
  objectKind: "REVIEW";
  channelCode: string;
  channelNameKo: string | null;
  accountId: string;
  reviewId: string;
  actionRef: string;
  draftVersion: number | null;
  contentFingerprint: string | null;
  requiresLocalAgent: true;
  to: string;
}

export interface ExecutionResultArtifact extends ArtifactBase {
  type: "EXECUTION_RESULT";
  objectKind: ObjectKind;
  targetId: string;
  workItemId?: string;
  phase: string;
  executionStatus: string;
  category: string;
  verification: string;
  to: string;
}

/**
 * What one finished guided acquisition did — the mirror of the runtime's closed contract.
 *
 * Five facts as values: which channel, the window it covered, and the three tallies. A tally the
 * backend's record does not hold is `null` and is not rendered as a zero; a window it does not hold is
 * `null` and the card says no period rather than a placeholder one.
 */
export interface AcquisitionResultArtifact extends ArtifactBase {
  type: "ACQUISITION_RESULT";
  channelCode: string;
  channelNameKo: string;
  periodStart: string | null;
  periodEnd: string | null;
  rowsNew: number | null;
  rowsDuplicate: number | null;
  rowsFailed: number | null;
}

/** Knowledge Capture v1 — one capture as the seller sees it (mirror of the runtime's contract). */
export type KnowledgeCaptureState = "ASKED" | "CANDIDATE" | "SAVED" | "DUPLICATE" | "CONFLICT" | "CANCELLED" | "STALE";

export interface KnowledgeCaptureArtifact extends ArtifactBase {
  type: "KNOWLEDGE_CAPTURE";
  captureId: string;
  state: KnowledgeCaptureState;
  scope: "ORG" | "PRODUCT";
  topicLabel: string;
  productId: string | null;
  productName: string | null;
  variantName: string | null;
  inquiryId: string | null;
  question: string;
  /** CANDIDATE/SAVED: the seller's own sentence, verbatim (whitespace only). */
  content: string | null;
  /** CANDIDATE: what 「저장하고 계속」 must echo back — a changed sentence is a new fingerprint. */
  fingerprint: string | null;
  existing: { title: string; excerpt: string } | null;
  resume: "DRAFT_GROUNDED" | "DRAFT_STILL_GAP" | "INQUIRY_NOT_ACTIONABLE" | "PENDING_RESUME" | null;
  settingsTo: string;
}

export interface WorkspaceLinkArtifact extends ArtifactBase {
  type: "WORKSPACE_LINK";
  link: WorkspaceLink;
}

export type Artifact =
  | SummaryArtifact
  | GuidedExecutionArtifact
  | MetricArtifact
  | ListArtifact
  | TableArtifact
  | ReviewListArtifact
  | InquiryListArtifact
  | InquiryDetailArtifact
  | ReviewDetailArtifact
  | ProductListArtifact
  | IssueListArtifact
  | OpportunityListArtifact
  | OrderSummaryArtifact
  | ChartArtifact
  | DraftArtifact
  | EvidenceArtifact
  | ChecklistArtifact
  | HumanActionRequiredArtifact
  | ApprovalRequiredArtifact
  | ApprovalArtifact
  | ExecutionResultArtifact
  | AcquisitionResultArtifact
  | WorkspaceLinkArtifact
  | KnowledgeCaptureArtifact;

export type WorkingSetKind = "REVIEWS" | "INQUIRIES" | "PRODUCTS" | "ORDERS" | "ISSUES";

export interface WorkingSetView {
  kind: WorkingSetKind;
  label: string;
  count: number;
  ids: string[];
  filters: {
    period?: DateWindow | null;
    channelCode?: string | null;
    rating?: "ALL" | "LOW";
    productIds?: string[];
    topic?: "SHIPPING" | "EXCHANGE_RETURN" | "PRODUCT_SPEC" | "USAGE" | "OTHER" | null;
    /** The seller's own subject word the set was narrowed by, when one was (`subjectTerm.ts`). */
    term?: string | null;
    reviewIntent?: "ROWS" | "ISSUES" | null;
    inquiryIntent?: "ROWS" | "WORKLOAD";
    status?: "UNANSWERED" | "ANSWERED" | "ALL";
    order?: "NEWEST" | "OLDEST";
  };
  productIds: string[];
  workItemIds: string[];
  /** The one inquiry the seller selected — the anchor a follow-up acts on (Conversation Object Integrity v1). */
  selectedInquiry?: { inquiryId: string; workItemId: string | null; productId: string | null; channelCode: string | null } | null;
  /** The one product or review the seller selected — the same anchor, the other two object kinds. */
  selectedObject?: { kind: "PRODUCT" | "REVIEW"; id: string; productId: string | null; channelCode: string | null } | null;
  turnId: string;
}

/** Agent Interaction Model v2 §1-C: what the conversation is doing with the selected object right now. */
export type ActiveTask = "INSPECT" | "PREPARE_REPLY" | "REVISE_DRAFT" | "CAPTURE_KNOWLEDGE" | "APPROVE_REPLY";

export interface PendingHumanAction {
  turnId: string;
  optional?: boolean;
  actionType: HumanActionType;
  path: HumanActionPath;
  channelCode: string | null;
  accountId: string | null;
  dataType: "REVIEW" | "INQUIRY" | "ORDER_SUMMARY" | null;
  requestedAt: string;
}

export interface PendingPreparedAction {
  turnId: string;
  kind: "INQUIRY_DRAFT" | "REVIEW_DRAFT";
  workItemId: string;
  inquiryId: string;
  accountId?: string;
  draftVersion: number | null;
  contentFingerprint: string | null;
}

export interface SuggestedAction {
  label: string;
  kind: "PROMPT" | "LINK" | "RESUME";
  prompt?: string;
  to?: string;
}

export type TurnStatus = "DONE" | "FAILED" | "WAITING_HUMAN";

export interface TurnView {
  turnId: string;
  conversationId: string;
  role: "USER" | "AGENT";
  text?: string;
  message: string;
  /**
   * What the answer could NOT see — the run's own limits, said apart from the answer. Rendered as a
   * quiet line under the objects, never welded to the sentence that answered the question.
   */
  notes?: string[];
  artifacts: Artifact[];
  suggestedActions: SuggestedAction[];
  continuation: {
    workingSet: WorkingSetView | null;
    pendingHumanAction: PendingHumanAction | null;
    pendingHumanActions?: PendingHumanAction[];
    pendingPrepared: PendingPreparedAction | null;
    /** Knowledge Capture v1: the gap the agent is holding open after this turn, if any. */
    pendingCapture?: { captureId: string; state: "ASKED" | "CANDIDATE"; inquiryId: string | null } | null;
    /** Agent Interaction Model v2 §1-C: the task this turn leaves in flight. Absent on older turns. */
    activeTask?: ActiveTask | null;
  };
  status: TurnStatus;
  failureCode?: string;
  failureReason?: string;
  budget?: { toolCalls: number; llmCalls: number; elapsedMs: number; stopReason: string };
  resumedFrom?: string;
  createdAt: string;
  answer?: OperatorAnswer;
}

export interface ConversationView {
  conversationId: string;
  createdAt: string;
  updatedAt: string;
  turns: TurnView[];
  workingSet: WorkingSetView | null;
  pendingHumanAction: PendingHumanAction | null;
  pendingHumanActions?: PendingHumanAction[];
  pendingPrepared: PendingPreparedAction | null;
}

export interface ConversationSummary {
  conversationId: string;
  createdAt: string;
  updatedAt: string;
  turnCount: number;
  headline: string | null;
}

export type ProgressStage =
  | "UNDERSTANDING"
  | "PLANNED"
  | "REFRESHING"
  | "READING"
  | "JUDGING"
  | "COMPOSING"
  | "PREPARING_DRAFT"
  | "WAITING_HUMAN";

export interface ProgressStageEvent {
  type: "stage";
  stage: ProgressStage;
  label: string;
  at: string;
}
export interface ProgressTurnEvent {
  type: "turn";
  turn: TurnView;
}
export interface ProgressErrorEvent {
  type: "error";
  code: string;
  message: string;
}
export type ProgressEvent = ProgressStageEvent | ProgressTurnEvent | ProgressErrorEvent;

export interface StartTurnRequest {
  text?: string;
  productId?: string;
  workItemId?: string;
  channelCode?: "NAVER" | "COUPANG" | "CAFE24";
  surface?: string;
  resumeOfTurnId?: string;
  /**
   * Knowledge Capture v1: the seller's decision on the candidate card, bound to it by capture id AND
   * the fingerprint of the exact sentence shown. Sent alone (no text); the runtime writes only on SAVE.
   */
  captureDecision?: { captureId: string; fingerprint: string; decision: "SAVE" | "CANCEL" };
  referenceDate?: string;
  /**
   * Whether this browser is paired with a local helper right now — a HINT from the bridge health probe
   * (`lib/bridge/localAgentHint.ts`), so the runtime can choose a guided Action Window path over the
   * file-upload fallback honestly. `UNKNOWN` when the probe did not run or did not answer in time.
   */
  localAgent?: LocalAgentHint;
  /**
   * Agent Interaction Model v2 §3/§9: a CLICK on a shown row, sent as the same focus transition a typed
   * selection makes. The runtime verifies the id (history row, or one org-scoped READ) and persists the
   * anchor; nothing is appended to the transcript.
   */
  select?:
    | { kind: "INQUIRY"; inquiryId: string; workItemId?: string | null }
    /** The same transition for the other two objects a conversation can stand on. */
    | { kind: "PRODUCT"; productId: string }
    | { kind: "REVIEW"; reviewId: string }
    /** Working Context v1 §1: leave the anchored object. The same focus contract, backwards. */
    | { kind: "CLEAR" };
}

/** Closed: the runtime's zod accepts exactly these three. */
export type LocalAgentHint = "PAIRED" | "ABSENT" | "UNKNOWN";

/** Closed review-execution verification vocabulary (mirrors the runtime contract; never widened here). */
export type ReviewExecutionVerification =
  | "VERIFIED"
  | "STATUS_UNRESOLVED"
  | "DELIVERY_UNKNOWN"
  | "UNVERIFIABLE"
  | "COMPOSER_FILLED"
  | "SELLER_SUBMISSION_OBSERVED"
  | "SUBMISSION_OBSERVED_CONTENT_UNVERIFIED";
