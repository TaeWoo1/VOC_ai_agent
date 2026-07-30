/**
 * TypeScript mirrors of the Spring backend's inquiry DTOs (the JSON shapes the REST
 * endpoints return / accept). These are the wire contract only — the backend remains
 * the system of record; the runtime never re-implements any domain rule, it only
 * shuttles these shapes across the boundary.
 *
 * Kept deliberately narrow to the fields the vertical slice uses. `Instant` serializes
 * as an ISO-8601 string over HTTP, so it is typed `string` here.
 */

/** One row of GET /api/inquiries (sanitized: no buyer identity, no raw body). */
export interface InquiryQueueItem {
  readonly workItemId: string;
  readonly inquiryId: string;
  readonly sellerAccountId: string;
  readonly channelId: string;
  readonly phase: string;
  readonly status: string;
  readonly title: string;
  readonly receivedAt: string;
}

/** GET /api/inquiries page envelope. */
export interface InquiryQueueResponse {
  readonly content: InquiryQueueItem[];
  readonly page: number;
  readonly size: number;
  readonly totalElements: number;
  readonly totalPages: number;
}

/** Sanitized proposal view (coarse category + provider provenance; no body). */
export interface ProposalView {
  readonly proposalId: string;
  readonly workItemId: string;
  readonly inquiryId: string;
  readonly actionKind: string;
  readonly summaryCategory: string;
  readonly requiresApproval: boolean;
  readonly proposedBy: string;
  readonly providerKind: string;
  readonly providerName: string;
  readonly providerVersion: string;
}

/** Result of POST /api/inquiries/{id}/proposal (OPEN -> PROPOSED, idempotent). */
export interface ProposalResult {
  readonly workItemId: string;
  readonly phase: string;
  readonly proposal: ProposalView;
}

/**
 * GET /api/inquiries/{id} — seller-owned operational detail. `title`/`details` ARE the
 * seller's own content (not buyer identity), so they are present here; the runtime must
 * keep them in memory and out of every log line (see {@link ../log}).
 */
export interface InquiryDetail {
  readonly workItemId: string;
  readonly inquiryId: string;
  readonly sellerAccountId: string;
  readonly channelId: string;
  readonly phase: string;
  readonly status: string;
  readonly informStatus: string | null;
  readonly title: string;
  readonly details: string | null;
  readonly receivedAt: string;
  readonly proposal: ProposalView | null;
  readonly draft: ReplyDraftView | null;
}

/** PUT /api/inquiries/{id}/draft request. */
export interface ReplyDraftRequest {
  readonly title: string;
  readonly comments: string;
  readonly baseVersion: number;
}

/** Current reply-draft view; `contentFingerprint` later binds the approval. */
export interface ReplyDraftView {
  readonly version: number;
  readonly answerStatus: number;
  readonly title: string;
  readonly comments: string;
  readonly contentFingerprint: string;
  readonly fingerprintAlgorithm: string;
  readonly createdAt: string;
}

/** POST /api/inquiries/{id}/confirm-publish request. */
export interface ConfirmPublishRequest {
  readonly commandId: string;
  readonly expectedFingerprint: string;
}

/**
 * GET /api/inquiry-publish/capability — read-only fail-closed status. `executionEnabled`
 * false + empty `replyAdapterChannelCodes` is the guarantee that confirm-publish
 * dispatches nothing (no external reply is sent). No secret.
 */
export interface PublishCapabilityView {
  readonly executionEnabled: boolean;
  readonly replyAdapterChannelCodes: string[];
}

/**
 * POST /api/inquiries/{id}/confirm-publish result. With live execution disabled and no
 * channel reply adapter registered (the fail-closed default), the backend records the
 * approval and creates the ACTION_PENDING intent but dispatches nothing — so
 * `executionStatus` stays `ACTION_PENDING` and no external reply is ever sent.
 */
export interface PublishStatusView {
  readonly workItemId: string;
  readonly phase: string;
  readonly executionStatus: string | null;
  readonly category: string;
  readonly approvedDraftVersion: number | null;
  readonly approvedFingerprint: string | null;
  readonly providerMessageNo: string | null;
  readonly resultCode: number | null;
}

/* ------------------------------------------------------------------------- *
 * Review-reply domain (attention/reply/*). Mirrors of the backend DTOs the
 * review subgraph shuttles across the boundary. As with the inquiry mirrors,
 * these are the wire contract only — the backend owns every review-reply rule,
 * version binding, and audit. The review-reply surface has NO send endpoint,
 * so no-send is structural here (there is nothing to type a send call to).
 * ------------------------------------------------------------------------- */

/**
 * One row of GET /api/seller-accounts/{accountId}/reply-work `todo` — a review the
 * operator has triaged RESPONSE_NEEDED. METADATA ONLY: no raw review body/title, no
 * customer/order/product identifier. `actionRef` is the client-opaque `review:<uuid>`
 * address; `sourceCreatedDate` is a KST date (date-only) or null; `rating` is 1..5 or null.
 */
export interface ReviewWorkItem {
  readonly actionRef: string;
  readonly channelCode: string | null;
  readonly channelNameKo: string | null;
  readonly sourceType: string;
  readonly productName: string | null;
  readonly rating: number | null;
  readonly replyStatus: string | null;
  readonly sourceCreatedDate: string | null;
  readonly triageDisposition: string | null;
  readonly hasReplyPreparation: boolean;
}

/** GET /reply-work envelope. `todo` is the reply worklist; `recentlyReported` is unused here. */
export interface ReviewReplyWorkResponse {
  readonly sellerAccountId: string;
  readonly channel: string | null;
  readonly coverage: string;
  readonly todo: ReviewWorkItem[];
  readonly recentlyReported: ReviewWorkItem[];
}

/**
 * The read-time rule-based suggestion embedded in the prep view. `body` IS the suggested
 * reply text (the review provider emits a body, unlike the inquiry provider) — content, so
 * it stays out of every log line and never enters the persisted graph state.
 */
export interface ReviewReplySuggestionView {
  readonly body: string;
  readonly category: string;
  readonly providerKind: string;
  readonly providerName: string;
  readonly providerVersion: string;
}

/** Current reply draft for a review; `contentFingerprint` binds the approval. */
export interface ReviewReplyDraftView {
  readonly version: number;
  readonly body: string;
  readonly contentFingerprint: string;
  readonly fingerprintAlgorithm: string;
  readonly createdAt: string;
}

/** The standing approval, if any. `body` is present only when the server allows a copy. */
export interface ReviewReplyApprovalView {
  readonly state: string;
  readonly approvedVersion: number | null;
  readonly approvedFingerprint: string | null;
  readonly body: string | null;
  readonly decidedAt: string;
}

/** What the operator may do with this review's reply right now (server-computed). */
export interface ReviewReplyCapabilities {
  readonly canSave: boolean;
  readonly canApprove: boolean;
  readonly canWithdraw: boolean;
  readonly canCopy: boolean;
  readonly canStartSubmissionRun: boolean;
}

/**
 * GET /reply — everything the preparation surface needs for one review, in one read.
 * `redactedBody` and `suggestion.body` ARE review content and must be kept in memory and
 * off every log line; the review subgraph reads them only transiently (to derive a draft)
 * and never places them in the persisted graph state or the durable snapshot.
 */
export interface ReviewReplyPrepView {
  readonly actionRef: string;
  readonly redactedBody: string | null;
  readonly bodyRedacted: boolean;
  readonly triageDisposition: string | null;
  readonly suggestion: ReviewReplySuggestionView;
  readonly draft: ReviewReplyDraftView | null;
  readonly approval: ReviewReplyApprovalView | null;
  readonly capabilities: ReviewReplyCapabilities;
  /** One-way `review-id-fingerprint/v1` digest, or null when ingested without a channel id. */
  readonly channelReviewIdFingerprint: string | null;
  readonly rating: number | null;
  readonly channelReplyState: string;
  readonly productName: string | null;
  readonly reviewDate: string | null;
}

/** PUT /reply/draft request. */
export interface ReviewReplyDraftRequest {
  readonly body: string;
  readonly baseVersion: number;
}

/** POST /reply/approval request. `state` is APPROVED here; baseVersion binds the version. */
export interface ReviewReplyApprovalRequest {
  readonly commandId: string;
  readonly state: string;
  readonly baseVersion: number | null;
}

/** POST /reply/approval result. `replayed` marks an idempotent no-op replay. */
export interface ReviewReplyApprovalResponse {
  readonly actionRef: string;
  readonly state: string;
  readonly replayed: boolean;
}

/** POST /reply/submission-run request. Guided prep sets `requireTargetHint`. */
export interface ReviewReplySubmissionRunRequest {
  readonly requireTargetHint: boolean;
}

/**
 * The privacy-safe review target hint returned for guided preparation: coarse rating,
 * a KST date-only recency bucket, and a one-way review-body fingerprint. No raw body,
 * no raw timestamp, no channel-side id.
 */
export interface ReviewReplyTargetHintView {
  readonly rating: number;
  readonly recencyBucket: string;
  readonly bodyFingerprint: string;
}

/**
 * POST /reply/submission-run result = the prepared guided reply session. `submissionRef`
 * is an opaque 16-hex token, single-use, never reversible to a review id. NO send happens:
 * this authorizes a human-performed guided post; SellerOps only guides and observes.
 */
export interface ReviewReplySubmissionRunResponse {
  readonly actionRef: string;
  readonly submissionRef: string;
  readonly approvedVersion: number | null;
  readonly targetHint: ReviewReplyTargetHintView | null;
  readonly asOfDate: string | null;
}

/* ------------------------------------------------------------------------- *
 * Review-issue memory domain (/api/review-issues/*). Mirrors of the backend
 * DTOs the issue-memory subgraph shuttles across the boundary. Every shape
 * here is QUOTE-FREE and PII-FREE by construction: issue title/aspect/problem
 * are closed-vocabulary labels (never a review body), and the drill-downs the
 * subgraph uses (/context, /evidence-summary, /trend) never carry a masked
 * quote or an operator note. The backend owns every extraction, aggregation,
 * and lifecycle rule; the runtime only reads these summaries.
 * ------------------------------------------------------------------------- */

/**
 * The change/trend judgement for one issue (mirror of IssueChangeView). `kinds` are the fired
 * judgement enum names (NEW/SURGING/PERSISTENT/CONCENTRATED/IMPROVED); `labelsKo` the operator
 * labels. The two surge numbers let a brief say "최근 N일 X건 · 이전 평균 주 Y건" without prose.
 */
export interface IssueChangeInfo {
  readonly kinds: string[];
  readonly labelsKo: string[];
  readonly highSurge: boolean;
  readonly surgeWindowCount: number;
  readonly surgeBaselineWeekly: number;
}

/**
 * One issue as an operational signal (mirror of ReviewIssueView) — the row of GET
 * /api/review-issues and the body of GET /{id}/trend. All fields are vocabulary labels or
 * aggregate counts; there is NO customer text. Dates are ISO date strings (LocalDate) or null.
 */
export interface ReviewIssueSummary {
  readonly id: string;
  readonly title: string;
  readonly aspect: string;
  readonly problem: string;
  readonly severity: string;
  readonly lifecycleState: string;
  readonly lifecycleLabelKo: string;
  readonly evidenceCount: number;
  readonly firstEvidenceOn: string | null;
  readonly lastEvidenceOn: string | null;
  readonly dominantProductId: string | null;
  readonly dominantProductName: string | null;
  readonly dismissed: boolean;
  readonly extractorKind: string;
  readonly change: IssueChangeInfo;
}

/** One lifecycle transition, note-free (mirror of IssueTransitionView). No operator free-text. */
export interface IssueTransition {
  readonly fromState: string | null;
  readonly toState: string;
  readonly toStateLabelKo: string;
  readonly actor: string;
  readonly reason: string;
  readonly at: string;
}

/** GET /{id}/context — issue identity + lifecycle history, quote-free and note-free. */
export interface IssueContext {
  readonly issue: ReviewIssueSummary;
  readonly history: IssueTransition[];
}

/** All-time evidence count for one product behind an issue (mirror of IssueProductEvidenceView). */
export interface IssueProductEvidence {
  readonly productId: string;
  readonly productName: string | null;
  readonly evidenceCount: number;
}

/** Per-star evidence counts plus an unrated bucket; sums to totalEvidence. */
export interface IssueRatingDistribution {
  readonly rating1: number;
  readonly rating2: number;
  readonly rating3: number;
  readonly rating4: number;
  readonly rating5: number;
  readonly unrated: number;
}

/**
 * GET /{id}/evidence-summary — the sanitized evidence roll-up (mirror of IssueEvidenceSummaryView).
 * No review id, no quote, no buyer identity: counts, a per-product split, a rating distribution,
 * and the all-time span only.
 */
export interface IssueEvidenceSummary {
  readonly totalEvidence: number;
  readonly byProduct: IssueProductEvidence[];
  readonly unattributedEvidence: number;
  readonly ratingDistribution: IssueRatingDistribution;
  readonly firstEvidenceOn: string | null;
  readonly lastEvidenceOn: string | null;
}

/** GET /{id}/trend returns a bare {@link ReviewIssueSummary} (severity + change + concentration). */
export type IssueTrend = ReviewIssueSummary;

/**
 * GET /api/users/me — the caller's identity as the backend derives it from the JWT. Only the two
 * scoping ids are mirrored here; no email/name/role is carried (not needed to tenant-scope a run).
 */
export interface UserIdentity {
  readonly userId: string;
  readonly orgId: string;
}
