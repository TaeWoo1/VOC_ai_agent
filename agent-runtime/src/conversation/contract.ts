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
  /**
   * The sentence above this card already said what the title says — so the header is not drawn.
   *
   * <b>Declared by the producer, not matched from prose</b> (Agent Object + First-use Closure v1 §3).
   * The renderer used to decide this by testing whether the headline CONTAINED the title, which is a
   * string search standing in for a fact only the writer of both sentences knows: 「가장 오래 기다린
   * 것부터 보여드릴게요」 over a card titled 「가장 오래 기다린 문의」 is a repeat that no containment
   * test can see, and a title that happens to be a substring of an unrelated sentence is a header
   * dropped for no reason. The title itself stays — it is the section's accessible name; what this
   * suppresses is the second RENDERING.
   */
  readonly titleSaid?: boolean;
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
  | "LAST_WEEK"
  /**
   * The calendar month, this one or the last (Chat-first Completion & Continuity v1).
   *
   * <b>An axis that cannot hold what the seller said drops it silently.</b> The token list held weeks and
   * trailing day counts and no months, so 「이번 달 리뷰 어때?」 had nothing to be planned as — and what came
   * back was 「이번 주」, a different question answered under the seller's own words. That is the LAST_N_DAYS
   * defect in a second axis: the repair is the value the calendar already has, not a better prompt.
   */
  | "THIS_MONTH"
  | "LAST_MONTH"
  /**
   * A trailing window the seller named by its LENGTH — 「최근 3일」, 「최근 열흘」 (Conversation Contract
   * Correctness v2). Carries its day count in {@link PlanFilters.periodDays} and in
   * {@link DateWindow.days}.
   *
   * <b>Why the enum grew a shape instead of a value.</b> The closed list held seven windows and the
   * seller may name any number of days. 「최근 3일 안에 들어온 문의만 보여줘」 had no token, so the axis
   * was silently empty and the read returned all fifteen inquiries under the headline 「문의는 15건」 —
   * a condition the seller stated, dropped without a word. Adding LAST_3_DAYS would have left the same
   * hole at 「최근 5일」. Every other axis stays closed; this one is a bounded integer because the thing
   * it represents is one.
   */
  | "LAST_N_DAYS";

export interface DateWindow {
  readonly from: string;
  readonly to: string;
  readonly token: PeriodToken | null;
  /** Set only for `LAST_N_DAYS`: the trailing day count the seller named. */
  readonly days?: number;
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
  /**
   * The customer's subject line — the seller's own operational content, as the inquiry screen shows it.
   * Persisted with the row (bounded list) so a reloaded thread names the same inquiry the seller chose
   * (Conversation Object Integrity v1); the body never travels here.
   */
  readonly title?: string | null;
  /**
   * transient — the same bounded, PII-masked opening of the customer's message the 문의 feed shows.
   * Present on a ROWS list so the seller reads what the customer actually wrote without opening
   * anything, and so a row with no work item (an answered inquiry) can still show its body. Stripped
   * before persistence like every other customer text.
   */
  readonly snippet?: string | null;
  /** PRIORITIZE: whole days this inquiry has been waiting, as of the run's reference date. */
  readonly waitingDays?: number | null;
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
    /** Conversation Core v1: the closed topic family the read was narrowed by, when one was. */
    readonly topic?: PlanFilters["topic"];
    /** The seller's own subject word the read was narrowed by (`subjectTerm.ts`), when one was. */
    readonly term?: string | null;
    /** PRIORITIZE: the rows are in urgency order, and the answer says by what. */
    readonly rank?: "URGENCY" | null;
  };
}

/**
 * One inquiry, inspected (Agent Interaction Model v2 §4). The answer to 「배송 문의 봐줘」 / 「이 문의
 * 자세히」 / a click on a shown row: the row's own closed facts, plus a bounded excerpt of the
 * customer's sentence — transient, stripped before persistence like every other customer text.
 * INSPECT never re-reads the org queue and never converts the question into a workload.
 */
export interface InquiryDetailArtifact extends ArtifactBase {
  readonly type: "INQUIRY_DETAIL";
  readonly inquiryId: string;
  readonly workItemId: string | null;
  readonly channelCode: string | null;
  readonly channelNameKo: string | null;
  readonly status: string;
  readonly receivedAt: string | null;
  readonly productId: string | null;
  readonly productName: string | null;
  /** The seller's word for the row's state — the same closed sentence set the lists use. */
  readonly stateLabel: string;
  /** transient — a bounded excerpt of the customer's message, re-read from the inquiry screen on reload. */
  readonly excerpt?: string | null;
  /** Whether a reply draft can attach right now — the same gate the PREPARE lane uses. */
  readonly actionability: "DRAFTABLE" | "ALREADY_ANSWERED" | "AWAITING_SEND" | "NOT_WORKABLE";
  readonly to: string;
}

/**
 * ONE review, inspected (Agent Object + First-use Closure v1 §1) — the answer to 「이 리뷰 자세히 봐줘」
 * and the card a click on a review row produces.
 *
 * <b>Identity is kept; the customer's words are not.</b> `reviewId` is what the conversation stores, and
 * `body` — the seller-visible sentence — is transient like every other customer text here: stripped
 * before persistence and re-read from the same exact endpoint when a later turn needs it. So a reload
 * still knows WHICH review is anchored, and never keeps a second copy of what a buyer wrote.
 *
 * <b>`issues` is what this review is already evidence FOR</b>, from the extractor's own links. It is the
 * only honest answer to 「왜 이런 리뷰가 나왔을까」 that stays on this review — a count over the product
 * would be a different claim about different rows.
 */
export interface ReviewDetailArtifact extends ArtifactBase {
  readonly type: "REVIEW_DETAIL";
  readonly reviewId: string;
  readonly channelCode: string | null;
  readonly channelNameKo: string | null;
  readonly writtenOn: string | null;
  readonly rating: number | null;
  readonly negative: boolean;
  readonly productId: string | null;
  readonly productName: string | null;
  /** transient — the redacted sentence the customer wrote, bounded. Never persisted. */
  readonly body?: string | null;
  /** True when a span of the body was tokenized, so the reader knows they are reading a redaction. */
  readonly bodyRedacted?: boolean;
  /** The repeated problems this review is recorded as evidence for. Titles and ranks — never quotes. */
  readonly issues: ReadonlyArray<{
    readonly issueId: string;
    readonly title: string;
    readonly severity: string | null;
    readonly to: string;
  }>;
  /** What can be done with this review at its channel today — the seller's sentence, decided by capability. */
  readonly replyCapability: "DRAFTABLE" | "NOT_SUPPORTED" | "UNKNOWN";
  readonly to: string;
}

export interface ProductListArtifact extends ArtifactBase {
  readonly type: "PRODUCT_LIST";
  readonly items: ReadonlyArray<{
    readonly productId: string;
    readonly productName: string;
    readonly facts: ReadonlyArray<{ readonly label: string; readonly count: number }>;
    readonly to: string;
  }>;
  /** Where the rest is, when these rows are the head of a longer list rather than the whole of it. */
  readonly more?: { readonly label: string; readonly to: string };
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

/**
 * Improvement opportunities (Opportunity Engine v1) — the same derived objects the product and issue
 * screens show, as rows into the issue's evidence surface. The conversation decides nothing about them:
 * accept/dismiss and the prepared draft live where the evidence is. Every sentence is the backend's.
 */
export interface OpportunityListArtifact extends ArtifactBase {
  readonly type: "OPPORTUNITY_LIST";
  /** Null for the org; the resolved product the rows were read for otherwise. */
  readonly productId: string | null;
  readonly items: ReadonlyArray<{
    readonly issueId: string;
    readonly kind: string;
    readonly kindLabelKo: string;
    readonly status: string;
    readonly statusLabelKo: string;
    readonly issueTitle: string;
    readonly recommendationKo: string;
    readonly evidenceCount: number;
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
  /** The backend's one next-step sentence for a NO_ANSWER_BASIS (what to register) — null otherwise. */
  readonly answerBasisAction?: string | null;
  readonly knowledgeState: string | null;
  readonly evidenceCount: number;
  /**
   * Passages per lane, by the backend's own lane word (상품 정보 · 운영 정책 · 과거 답변 · 주문 상태) —
   * metadata only, kept on reload. The passage text lives on the inquiry screen (Knowledge Context v1-A).
   */
  readonly evidenceSummary?: ReadonlyArray<DraftEvidenceSummary>;
  /**
   * Seller Context v1-B: the registered 회사 정보 was put in front of the drafter as wording context.
   * A flag, never the text — and never a lane: it is not evidence and is not counted with the lanes above.
   */
  readonly companyContextUsed?: boolean;
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
  /**
   * <b>The seller already said "do it".</b> Set when the sentence that produced this card was an explicit
   * instruction to collect (`conversation/acquisitionRequest.ts`) — the card then starts its guided run on
   * arrival instead of rendering a button that asks for the instruction a second time.
   *
   * READ acquisition only, and it widens nothing: the run is the same guided run, the seller still performs
   * every confirmation the marketplace asks for in their own window, and no write path reads this field.
   */
  readonly autoStart?: boolean;
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

/**
 * <b>The seller's own approval of an exact draft version, asked for in the conversation.</b>
 *
 * Guided Reply UX Smoothing v1 §1. Before this card the guided lane assumed an approval was already
 * standing and offered a run that the backend refuses without one — so the only way to approve was to
 * leave the conversation for the reply-work screen and come back. That is not a smaller inconvenience
 * than it looks: the seller who lands on the work screen has left the thread that knows which review
 * they were on.
 *
 * <b>The card carries identity, not text.</b> The draft body, the customer's sentence, the rating and
 * the date are NOT on this artifact: the renderer re-reads them from the review's own reply-prep view
 * when it mounts, which is what makes the card structurally unable to approve something it did not just
 * read. `draftVersion` / `contentFingerprint` are the head as the runtime saw it at compose time — a
 * card whose numbers no longer match what the renderer reads says so and binds to what is on screen.
 *
 * <b>Nothing here approves.</b> The runtime composes the card; the approval is one HTTP call made by the
 * seller's own press, through the existing review-reply approval seam, with its existing version binding.
 * The conversation lane has no path to that call — asserted on the source by `conversationWriteFence`.
 */
export interface ApprovalRequiredArtifact extends ArtifactBase {
  readonly type: "APPROVAL_REQUIRED";
  readonly objectKind: "REVIEW";
  readonly reviewId: string;
  readonly accountId: string;
  readonly actionRef: string;
  readonly channelCode: string;
  readonly channelNameKo: string | null;
  readonly productName: string | null;
  /** The head version this card offers for approval, as read at compose time. */
  readonly draftVersion: number;
  readonly contentFingerprint: string;
  /** How an approved reply would reach the channel — what the primary AFTER approval is. */
  readonly execution: ExecutionCapability;
  readonly executableIdentity: ExecutableIdentity;
  /** The precision surface (edit / recover) for this one reply. Never the normal path. */
  readonly to: string;
}

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

/* ───────────── Knowledge Capture v1 (2026-08-30) ───────────── */

/** Where a captured fact would live — the two seller-authored corpora the settings screens already own. */
export type KnowledgeCaptureScope = "ORG" | "PRODUCT";

/**
 * The state of one capture as the seller sees it. `ASKED`: the agent asked a specific question and is
 * listening for the next sentence. `CANDIDATE`: the seller's own sentence is shown back, verbatim, with
 * [저장하고 계속] / [취소] — nothing is written yet. `SAVED`: written through the seller's own knowledge
 * seam and the original work resumed (or not — `resume` says which). `DUPLICATE` / `CONFLICT`: a fence
 * refused before any write; the settings screen is the path. `CANCELLED` / `STALE`: nothing written.
 */
export type KnowledgeCaptureState = "ASKED" | "CANDIDATE" | "SAVED" | "DUPLICATE" | "CONFLICT" | "CANCELLED" | "STALE";

export interface KnowledgeCaptureArtifact extends ArtifactBase {
  readonly type: "KNOWLEDGE_CAPTURE";
  readonly captureId: string;
  readonly state: KnowledgeCaptureState;
  readonly scope: KnowledgeCaptureScope;
  /** The seller's word for the topic (배송 · 교환·반품·환불 · 규격 …) — the card's noun. */
  readonly topicLabel: string;
  readonly productId: string | null;
  readonly productName: string | null;
  readonly variantName: string | null;
  /** The inquiry this capture was opened for, when one was. */
  readonly inquiryId: string | null;
  /** The specific question asked (ASKED), kept on later states for the reader. */
  readonly question: string;
  /** CANDIDATE/SAVED: the seller's own sentence, mechanically normalized and nothing else. */
  readonly content: string | null;
  /** CANDIDATE: what [저장하고 계속] must echo back. A changed candidate is a new fingerprint. */
  readonly fingerprint: string | null;
  /** CONFLICT: the title and a bounded excerpt of the rule/document that already says something else. */
  readonly existing: { readonly title: string; readonly excerpt: string } | null;
  /** SAVED: what happened to the original work after the write. */
  readonly resume: "DRAFT_GROUNDED" | "DRAFT_STILL_GAP" | "INQUIRY_NOT_ACTIONABLE" | "PENDING_RESUME" | null;
  /** The settings screen where this fact is edited by hand (「설정에서 직접 편집」). */
  readonly settingsTo: string;
}

/**
 * <b>What one finished guided acquisition actually did.</b>
 *
 * The seller ran an export and is owed the result of the export: which channel, which days were covered,
 * how many reviews were new, how many were already held, how many could not be read. Those five facts
 * live on the backend's attempt row, and until this artifact existed the runtime flattened them into one
 * Korean sentence — five numbers inside a paragraph, which the frontend could only lay out by parsing the
 * prose back apart. So the numbers travel as numbers and the prose says what it means.
 *
 * <b>Closed and complete.</b> No run id, no plan, no segment, no provenance: a record of the machinery is
 * not the result of the work. A tally the record does not hold stays `null` — a run that never counted is
 * not a run that brought in nothing, and only the renderer may decide how to say so.
 */
export interface AcquisitionResultArtifact extends ArtifactBase {
  readonly type: "ACQUISITION_RESULT";
  readonly channelCode: string;
  readonly channelNameKo: string;
  /** ISO date-only, both ends together or neither. Never a sentinel: an unknown window is `null`. */
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
  readonly rowsNew: number | null;
  readonly rowsDuplicate: number | null;
  readonly rowsFailed: number | null;
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

/* ───────────────────────────────── plan vocabulary ───────────────────────────────── */

/** What the seller asked the operator to DO beyond reading. Planner-decided, closed. */
export type RequestedAction = "NONE" | "PREPARE_INQUIRY_DRAFT" | "REQUEST_SEND_APPROVAL" | "OPEN_WORKSPACE" | "LIST_ACTIONS" | "EXPLAIN_CAPABILITY";

/** A closed tone adjustment for a draft. Style only — the facts section is byte-identical. */
export type ToneHint = "SOFTER" | "MORE_FORMAL" | "SHORTER";

export interface PlanFilters {
  readonly period: PeriodToken | null;
  /**
   * The day count behind `period: "LAST_N_DAYS"`, and meaningful only with it — 「최근 3일」 ⇒ 3.
   * Clamped by the parser to a bounded range; null on every other token.
   */
  readonly periodDays: number | null;
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
  readonly inquiryIntent: "ROWS" | "WORKLOAD" | "COUNT" | "PRIORITY" | null;
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
    /** The seller's own subject word the set was narrowed by, when one was (`subjectTerm.ts`). */
    readonly term?: string | null;
    /** Query Accuracy v1: which inquiry read produced the set, and the status it was read with. */
    readonly inquiryIntent?: "ROWS" | "WORKLOAD";
    readonly status?: "UNANSWERED" | "ANSWERED" | "ALL";
    /** The order the set was read in — a refine re-reads in THIS order so the base set is reproduced before it re-sorts. */
    readonly order?: "NEWEST" | "OLDEST";
  };
  /** Products the set is about, when known — the anchor for a cross-domain follow-up. */
  readonly productIds: readonly string[];
  /** Inquiry work items in the set, in shown order — secondary identity: which rows can take a draft. */
  readonly workItemIds: readonly string[];
  /**
   * The ONE inquiry the seller selected (an ordinal, 「이 문의」, a screen launch) — the conversation's
   * anchor until a new list is drawn. Products may be added to `productIds` beside it; nothing replaces
   * it silently (Conversation Object Integrity v1). Keyed by inquiry id; the work item is secondary.
   */
  readonly selectedInquiry?: SelectedInquiry | null;
  /**
   * The ONE product or review the seller selected — the same anchor, for the other two objects a
   * conversation can stand on (Frontend-first Agent Workspace Redesign v1).
   *
   * <b>One anchor at a time.</b> A conversation cannot be standing on an inquiry AND a product: setting
   * this clears {@link selectedInquiry} and setting that clears this. The invariant is here rather than
   * in a caller because everything downstream — the context bar, 「이 상품」, 「이 리뷰」 — reads it as
   * "the object", and two of them would make that word ambiguous exactly where it must not be.
   *
   * <b>Ids only, like the inquiry anchor.</b> The seller-visible name is resolved from the artifact the
   * thread already drew, so a stored conversation never accumulates a second copy of a product label or
   * a customer's review sentence.
   */
  readonly selectedObject?: SelectedObject | null;
  readonly turnId: string;
}

export interface SelectedInquiry {
  readonly inquiryId: string;
  readonly workItemId: string | null;
  readonly productId: string | null;
  readonly channelCode: string | null;
}

export interface SelectedObject {
  readonly kind: "PRODUCT" | "REVIEW";
  /** The product id or the review id — whichever `kind` says. */
  readonly id: string;
  /** The product this object IS, or the one the review is about. Null when the review has no binding. */
  readonly productId: string | null;
  readonly channelCode: string | null;
}

/**
 * What the conversation is DOING with the selected object right now (Agent Interaction Model v2 §1-C)
 * — explicit state, never inferred from which tool ran last. Set by the lane that performed the step:
 * a selection/inspection sets INSPECT, the draft path PREPARE_REPLY, the tone lane REVISE_DRAFT, an
 * open knowledge gap CAPTURE_KNOWLEDGE, a routed approval APPROVE_REPLY. Null = no task in flight.
 */
export type ActiveTask = "INSPECT" | "PREPARE_REPLY" | "REVISE_DRAFT" | "CAPTURE_KNOWLEDGE" | "APPROVE_REPLY";

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

/**
 * A Knowledge Gap the agent is holding open across turns (Knowledge Capture v1). Every identity here is
 * one the runtime VERIFIED — the inquiry/work item the draft path read, the product the composer scoped
 * to, the 규격 the customer or seller named from the listing's own rows — never one a model produced.
 */
export interface PendingKnowledgeCapture {
  readonly captureId: string;
  /** The AGENT turn that asked. */
  readonly turnId: string;
  readonly state: "ASKED" | "CANDIDATE";
  readonly scope: KnowledgeCaptureScope;
  /** `KnowledgeTopic` name for an ORG capture; null for a product-specific fact. */
  readonly topic: string | null;
  /** ORG: `OrgKnowledgeType`; PRODUCT: `KnowledgeSourceType` (DESCRIPTION for a spec fact, POLICY for a topic). */
  readonly knowledgeType: string;
  readonly topicLabel: string;
  /** The customer's own noun the question named, or null. */
  readonly missingSubject: string | null;
  readonly inquiryId: string | null;
  readonly workItemId: string | null;
  readonly productId: string | null;
  readonly productName: string | null;
  /** True when the answer depends on a 규격 the customer did not name: the seller must name one (or say 공통). */
  readonly variantRequired: boolean;
  readonly variantId: string | null;
  readonly variantName: string | null;
  readonly question: string;
  /** What to do again after a save: the draft path for this inquiry, or the turn whose goal to re-run. */
  readonly resume:
    | { readonly kind: "INQUIRY_DRAFT"; readonly workItemId: string; readonly inquiryId: string; readonly tone: ToneHint | null }
    | { readonly kind: "GOAL"; readonly turnId: string };
  /** CANDIDATE: the seller's sentence and the fingerprint the confirmation must echo. */
  readonly candidate: { readonly content: string; readonly title: string; readonly fingerprint: string } | null;
  readonly askedAt: string;
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
  /**
   * What the answer could NOT see — the run's own limits, kept out of the answer (Agentic Experience v2).
   *
   * <b>Why they are a separate field.</b> "① the answer, ② its limits" has been the ordering rule for
   * several packages, but both halves were joined into one paragraph, so 「지금까지 확인한 낮은 평점
   * 리뷰는 8건입니다」 arrived welded to 「카페24 리뷰를 최신 상태로 갱신하지 못했습니다」 and a seller read
   * one four-line block with no shape. These are the same sentences, deterministic and closed as before;
   * only their place changed. Absent on older turns and on turns with nothing to qualify.
   */
  readonly notes?: readonly string[];
  readonly artifacts: readonly Artifact[];
  readonly suggestedActions: readonly SuggestedAction[];
  readonly continuation: {
    readonly workingSet: WorkingSetView | null;
    /** The first pending action — kept for existing consumers; `pendingHumanActions` is the full list. */
    readonly pendingHumanAction: PendingHumanAction | null;
    readonly pendingHumanActions?: readonly PendingHumanAction[];
    readonly pendingPrepared: PendingPreparedAction | null;
    /** Knowledge Capture v1: the gap being held open, if any. Absent on older turns. */
    readonly pendingCapture?: PendingKnowledgeCapture | null;
    /** Agent Interaction Model v2 §1-C: the task this turn leaves in flight. Absent on older turns. */
    readonly activeTask?: ActiveTask | null;
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
  /**
   * The tenant this conversation belongs to (Agent Interaction Model v2 §0) — defense in depth on top
   * of the per-org store scoping: a load whose caller's org differs is a 404, never a render. Absent
   * on records written before this field existed; those rely on the store scoping alone.
   */
  readonly orgId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly turns: readonly TurnView[];
  readonly workingSet: WorkingSetView | null;
  readonly pendingHumanAction: PendingHumanAction | null;
  readonly pendingHumanActions?: readonly PendingHumanAction[];
  readonly pendingPrepared: PendingPreparedAction | null;
  /** Knowledge Capture v1: survives reload with the thread; absent on files written before it. */
  readonly pendingCapture?: PendingKnowledgeCapture | null;
  /** Agent Interaction Model v2 §1-C: the task in flight for the selected object. Absent on older records. */
  readonly activeTask?: ActiveTask | null;
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
    /**
     * Knowledge Capture v1: the seller's decision on the candidate shown, BOUND to it — the capture id
     * and the fingerprint of the exact sentence the card displayed. A stale card (changed candidate,
     * cancelled capture, another conversation) cannot save anything: the runtime compares both.
     */
    captureDecision: z
      .object({
        captureId: z.string().min(1).max(80),
        fingerprint: z.string().min(1).max(80),
        decision: z.enum(["SAVE", "CANCEL"]),
      })
      .strict()
      .optional(),
    /**
     * Agent Interaction Model v2 §3/§9: a CLICK on a shown object is the same state transition as
     * saying its name — the selection is applied through the same focus contract, persisted with the
     * conversation, and appended to the transcript as nothing (the row's own highlight is the
     * feedback). Ids are hints, not facts: a row this conversation never showed is verified by one
     * org-scoped READ before it may become the anchor, exactly like a screen-launch `workItemId`.
     *
     * <b>CLEAR is the same transition backwards</b> (Working Context v1 §1). The seller can now SEE
     * which object the conversation is anchored on, and a state that can be seen must be one the
     * seller can leave — otherwise the bar reports a fact and offers no way to change it. Clearing
     * drops the anchor and the task in flight and touches nothing else: the set stays on screen, the
     * transcript is not appended to, no read is made and no model is called. It carries no id because
     * there is only ever one anchor to drop.
     */
    select: z
      .union([
        z
          .object({
            kind: z.literal("INQUIRY"),
            inquiryId: z.string().min(1).max(200),
            workItemId: z.string().min(1).max(200).nullable().optional(),
          })
          .strict(),
        /**
         * The same transition for the other two objects a conversation can stand on (Frontend-first
         * Agent Workspace Redesign v1). A product is verified the way a screen hint is — one org-scoped
         * READ — and a review by the thread's own record of having drawn it, which is the only proof
         * available: there is no single-review endpoint, and inventing one to check a click would be a
         * read the seller did not ask for.
         */
        z.object({ kind: z.literal("PRODUCT"), productId: z.string().min(1).max(200) }).strict(),
        z
          .object({
            kind: z.literal("REVIEW"),
            reviewId: z.string().min(1).max(200),
          })
          .strict(),
        z.object({ kind: z.literal("CLEAR") }).strict(),
      ])
      .optional(),
  })
  .strict()
  .refine((r) => Boolean(r.text) || Boolean(r.resumeOfTurnId) || Boolean(r.captureDecision) || Boolean(r.select), {
    message: "a turn carries either text, resumeOfTurnId, captureDecision or select",
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
          items: g.items.slice(0, MAX_ITEMS_PERSISTED).map(({ snippet: _s, ...item }) => item),
        })),
      };
    case "DRAFT": {
      const { comments: _c, ...rest } = artifact;
      return rest;
    }
    case "INQUIRY_DETAIL": {
      const { excerpt: _e, ...rest } = artifact;
      return rest;
    }
    case "REVIEW_DETAIL": {
      // The identity and the closed facts persist; the customer's sentence does not. A later turn that
      // needs the words re-reads them from `get_review_detail` — one exact read, never a second copy.
      const { body: _b, ...rest } = artifact;
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
