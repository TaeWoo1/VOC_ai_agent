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
  /** Resolved catalogue labels and the bound product, when the backend has them (v2 queue row). */
  readonly channelCode?: string | null;
  readonly channelNameKo?: string | null;
  readonly productId?: string | null;
  readonly productName?: string | null;
  readonly phase: string;
  readonly status: string;
  readonly title: string;
  /** transient — the bounded, PII-masked opening of the customer's message the 문의 feed shows. */
  readonly snippet?: string | null;
  readonly receivedAt: string;
  /** NAVER: `NAVER_PRODUCT_QNA` | `NAVER_CUSTOMER_INQUIRY`; null for a channel with one source (Lane A, 2026-08-28). */
  readonly sourceSubtype?: string | null;
  /** Backend-decided from stored acquisition provenance — never from the channel label or an id prefix. */
  readonly executableIdentity?: ExecutableIdentity;
}

/**
 * Whether an object can be acted on at the marketplace (`MARKETPLACE`) or is a record with no
 * trusted provider binding (`NONE` — a manual CSV/xlsx upload, ESM Excel, a user-typed external id).
 * Decided by the backend from provenance; the runtime only reads it. Absent ⇒ read as `NONE`.
 */
export type ExecutableIdentity = "MARKETPLACE" | "NONE";

/** GET /api/inquiries page envelope. */
export interface InquiryQueueResponse {
  readonly content: InquiryQueueItem[];
  readonly page: number;
  readonly size: number;
  readonly totalElements: number;
  readonly totalPages: number;
}

/** GET /api/inquiries/rows (Query Accuracy v1) — the customer's inquiries as rows, not the work queue. */
export interface InquiryRowsParams {
  readonly from?: string;
  readonly to?: string;
  readonly channel?: string;
  readonly status?: "UNANSWERED" | "ANSWERED" | "ALL";
  readonly order?: "NEWEST" | "OLDEST";
  readonly limit?: number;
  /**
   * The seller's own subject word (「현금영수증」), matched by the backend against the subject line and
   * the customer's message. Not a closed token and not a sentence: one bounded word the seller typed,
   * extracted deterministically (`conversation/subjectTerm.ts`) — the axis the closed topic families
   * could never carry.
   */
  readonly q?: string;
}

export interface InquiryRowItem {
  readonly inquiryId: string;
  /** The open/proposed work item, when one exists; null for an answered or otherwise settled inquiry. */
  readonly workItemId: string | null;
  readonly sellerAccountId: string | null;
  readonly channelId: string | null;
  readonly channelCode: string | null;
  readonly channelNameKo: string | null;
  readonly productId: string | null;
  readonly productName: string | null;
  readonly phase: string | null;
  readonly status: string;
  readonly title: string | null;
  /** transient — the same bounded, PII-masked opening of the customer's message the 문의 feed shows. */
  readonly snippet?: string | null;
  readonly receivedAt: string;
  readonly answeredAt: string | null;
  readonly sourceSubtype?: string | null;
  readonly executableIdentity?: ExecutableIdentity;
}

export interface InquiryRowsResponse {
  readonly from: string | null;
  readonly to: string;
  readonly channel: string | null;
  readonly status: string;
  readonly order: string;
  readonly limit: number;
  /** The subject word this read was narrowed by, echoed back; null when none. */
  readonly term?: string | null;
  readonly totalCount: number;
  readonly items: InquiryRowItem[];
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
 *
 * `channelCode`/`channelNameKo` are the resolved catalog labels for `channelId` (null when
 * the catalog row is absent), so a caller can name the target channel (e.g. Cafe24) without
 * dereferencing the raw id. `isSecret` mirrors the backend `Inquiry.secret` flag: `true` for a
 * Cafe24 비밀글 (fail-closed), `false` for a positively-public post, `null` when unclassified
 * (legacy / non-Cafe24). These are scalar flags — safe to surface and log; the customer body is
 * NOT (it stays in `details`, which never leaves the process except as a generated draft).
 */
export interface InquiryDetail {
  readonly workItemId: string;
  readonly inquiryId: string;
  readonly sellerAccountId: string;
  readonly channelId: string;
  readonly channelCode: string | null;
  readonly channelNameKo: string | null;
  readonly isSecret: boolean | null;
  readonly phase: string;
  readonly status: string;
  readonly informStatus: string | null;
  readonly title: string;
  readonly details: string | null;
  readonly receivedAt: string;
  readonly proposal: ProposalView | null;
  readonly draft: ReplyDraftView | null;
  /**
   * The product this inquiry is bound to, when the backend has one — mirrors `InquiryDetail.productId`
   * / `productName` / `productBinding` (`SOURCE_EXACT` | `USER_CONFIRMED`). Absent (`null`/undefined)
   * when unbound. Ids and a catalogue name only: safe to carry into an entity and a locator.
   */
  readonly productId?: string | null;
  readonly productName?: string | null;
  readonly productBinding?: string | null;
  readonly sourceSubtype?: string | null;
  readonly executableIdentity?: ExecutableIdentity;
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
  /** V82 `answer_basis` — GROUNDED / NEEDS_CLARIFICATION, or null for a version older than the column. */
  readonly answerBasis?: string | null;
  readonly answerBasisNote?: string | null;
  readonly answerBasisAction?: string | null;
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

/**
 * All-time evidence count for one product behind an issue (mirror of IssueProductEvidenceView).
 *
 * `firstOccurredOn`/`lastOccurredOn` are THIS product's rows' own dates. The issue's span lives on
 * {@link IssueEvidenceSummary} and is a different fact — see the DTO's javadoc, and
 * `group/ProductGrouping.ts`, which is what stops one being read as the other.
 */
export interface IssueProductEvidence {
  readonly productId: string;
  readonly productName: string | null;
  readonly evidenceCount: number;
  readonly firstOccurredOn: string | null;
  readonly lastOccurredOn: string | null;
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

/**
 * One product's negative-review roll-up on the dashboard (mirror of TopProductIssue).
 *
 * <b>Not review-issue evidence.</b> `count` is negative REVIEWS — whole reviews the ingest marked
 * negative. {@link IssueProductEvidence.evidenceCount} is opinion units an extractor tied to a
 * repeated problem. Two different corpora, two different questions; `group/ReviewEvidenceSense.ts`
 * is where the runtime keeps them from being renamed into each other.
 */
export interface DashboardProductIssue {
  readonly productId: string;
  readonly productName: string | null;
  readonly issueLabel: string;
  readonly count: number;
  readonly firstNegativeOn: string | null;
  readonly lastNegativeOn: string | null;
}

/** GET /api/dashboard/summary — only the parts the Operator reads. */
export interface DashboardSummary {
  readonly topProductIssues?: DashboardProductIssue[];
  /** The org's own negative-review total — the denominator the top-5 roll-up is a slice of. */
  readonly cards?: { readonly negativeReviews?: number };
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

/* ─────────────────────────── Operator Graph v1 (2026-08-21) ─────────────────────────── */

/**
 * Whether one signal source can safely answer for a scope — the mirror of the backend's
 * `AttentionCoverage` (`com.sellerops.attention.AttentionCoverage`).
 *
 * <b>The Operator reads this before it reads any count.</b> `COVERED` is the ONLY value on which an
 * empty result may be reported as "문제 없음"; every other value means the data could not be
 * attributed, and an agent that treated them the same would confidently tell a seller nothing is
 * wrong on the strength of rows it was never able to see.
 */
export type AttentionCoverage =
  | "COVERED"
  | "UNCERTAIN_MULTI_ACCOUNT"
  | "UNCERTAIN_UNSUPPORTED_CHANNEL"
  | "UNCERTAIN_PRODUCT_UNLINKED";

/** Mirror of `SignalCoverageView`: one source's verdict, its linked/unlinked split, its provenance. */
export interface SignalCoverage {
  readonly signal: string;
  readonly coverage: AttentionCoverage;
  readonly linked: number;
  readonly unlinked: number;
  readonly provenance: string;
}

/**
 * Which surface the seller's words matched. Mirror of `ProductMatchSurface`.
 *
 * The three `_EXACT` values are what a whole name matched; `CANONICAL_NAME_PARTIAL` is a fragment.
 * The distinction is load-bearing: two candidates on the same exact surface are equally good and
 * cannot be told apart, while an exact match beside three partial ones is simply resolved.
 */
export type ProductMatchSurface =
  | "SKU_EXACT"
  | "CANONICAL_NAME_EXACT"
  | "CHANNEL_PRODUCT_NAME_EXACT"
  | "CANONICAL_NAME_PARTIAL"
  | "CATALOG_HEAD";

/** Mirror of `ProductSummaryView` — identity only; what is happening to it is a separate read. */
export interface ProductSummary {
  readonly id: string;
  readonly name: string;
  readonly sku: string | null;
  readonly status: string;
  /** How the query reached this row. `null` for a direct id read, where no query ran. */
  readonly matchedOn: ProductMatchSurface | null;
  /**
   * The channel listing title that matched, when it was an alias — the readable name of a product
   * whose `name` is a SKU number. `null` on every other surface.
   */
  readonly matchedName: string | null;
}

/** Mirror of `RecommendedActionCountView` — a tally of a stored verdict, not a new one. */
export interface RecommendedActionCount {
  readonly recommendedAction: string;
  readonly count: number;
}

/** Mirror of `ProductVolumeView`. Weigh these only together with the matching {@link SignalCoverage}. */
export interface ProductVolume {
  readonly reviews: number;
  readonly inquiries: number;
  readonly unansweredInquiries: number;
  readonly issueEvidence: number;
}

/**
 * Mirror of `ProductSignalsView` — everything about one product, and what could not be seen.
 *
 * Every list here must be read with `coverage`: an empty `issues` under
 * `UNCERTAIN_PRODUCT_UNLINKED` says nothing about the product at all.
 */
export interface ProductSignals {
  readonly productId: string;
  readonly productName: string;
  readonly sku: string | null;
  readonly referenceDate: string | null;
  readonly issues: ReviewIssueSummary[];
  readonly recommendedActions: RecommendedActionCount[];
  readonly volume: ProductVolume;
  readonly linkedChannels: string[];
  readonly coverage: SignalCoverage[];
}

/* ─────────────────────── Product Knowledge (Operator Graph v2, 2026-08-21) ─────────────────────── */

/**
 * Whether SellerOps HOLDS a product fact — the AVAILABILITY axis, mirror of the backend's
 * `KnowledgeCoverage`.
 *
 * <b>Read alongside {@link AttentionCoverage}, never instead of it.</b> That enum answers "can this
 * signal be attributed to this product"; this one answers "do we have this fact and how old is it". A
 * product can have perfect attribution and no catalogue at all, or a full catalogue read and
 * unattributable reviews, and one enum could not say both.
 *
 * `UNAVAILABLE` is the load-bearing value: it means "we have never held this", NOT "the product does
 * not have this". The judge refuses a sentence that asserts a fact over an UNAVAILABLE or STALE facet.
 */
export type KnowledgeCoverage = "AVAILABLE" | "PARTIAL" | "UNAVAILABLE" | "STALE";

/** Which facet a coverage verdict is about. Mirror of the backend's `ProductKnowledgeFacet`. */
export type ProductKnowledgeFacet =
  | "IDENTITY" | "LISTING" | "PRICE" | "VARIANT" | "TAXONOMY" | "DESCRIPTION" | "SPEC" | "SIGNALS";

/** Mirror of `KnowledgeCoverageView`. */
export interface KnowledgeCoverageRow {
  readonly facet: ProductKnowledgeFacet;
  readonly coverage: KnowledgeCoverage;
  readonly known: number;
  readonly newestObservedAt: string | null;
  readonly provenance: string;
}

/** Mirror of `ProductListingView` — one channel's listing. Nullable everywhere a channel says nothing. */
export interface ProductListing {
  readonly channelCode: string;
  readonly channelNameKo: string | null;
  readonly channelProductId: string | null;
  readonly listingName: string | null;
  readonly productUrl: string | null;
  readonly price: number | null;
  readonly currency: string | null;
  readonly sellingStatus: string | null;
  readonly source: string | null;
  readonly observedAt: string | null;
}

/** Mirror of `ProductVariantView`. A derived variant carries an id and no name — see the backend doc. */
export interface ProductVariantRow {
  /** SellerOps's own row id — what a 규격-scoped knowledge document binds to (`variantId`). */
  readonly id?: string;
  readonly channelCode: string;
  readonly externalVariantId: string | null;
  readonly optionName: string | null;
  readonly sku: string | null;
  readonly price: number | null;
  readonly sellingStatus: string | null;
  readonly source: string | null;
  readonly observedAt: string | null;
}

/**
 * Mirror of `ProductFactView` — one stated fact and its origin.
 *
 * `source` and `observedAt` are what make a fact citable: Operator Graph v2 treats a product fact as
 * evidence, and the judge refuses a sentence resting on a fact whose origin it cannot name.
 */
export interface ProductFact {
  readonly factKey: string;
  readonly value: string;
  readonly unit: string | null;
  readonly source: string;
  readonly sourceRef: string | null;
  readonly observedAt: string;
  readonly confidence: "SOURCE_STATED" | "DERIVED" | "INFERRED";
}

/** Mirror of `ProductKnowledgeView` — what SellerOps knows about one product, and what it does not. */
export interface ProductKnowledge {
  readonly productId: string;
  readonly name: string;
  readonly sku: string | null;
  readonly status: string;
  readonly listings: ProductListing[];
  readonly variants: ProductVariantRow[];
  readonly facts: ProductFact[];
  readonly signals: ProductSignals;
  readonly knowledgeCoverage: KnowledgeCoverageRow[];
}

/**
 * Mirror of `CustomerMemoryHitView` — one precedent.
 *
 * `answer` is the operator's own approved past reply (masked at the backend), which is why it may be
 * carried; the customer's question is NOT here and is read only on the authorized detail screen.
 */
export interface CustomerMemoryHit {
  readonly kind: string;
  readonly sourceId: string;
  readonly productId: string | null;
  readonly productName: string | null;
  readonly channelCode: string | null;
  readonly topic: string | null;
  readonly signatureKey: string | null;
  readonly severity: string | null;
  readonly occurredOn: string | null;
  readonly answered: boolean;
  readonly answer: string | null;
  readonly retrieverKind: string;
  readonly retrieverVersion: string;
}

/** Mirror of `CustomerMemorySearchView`. An empty `hits` under uncertain coverage is "판단 불가". */
export interface CustomerMemorySearch {
  readonly cueSignatureKey: string | null;
  readonly cueTopic: string | null;
  readonly hits: CustomerMemoryHit[];
  readonly coverage: SignalCoverage;
}

/** Mirror of `RepeatedInquiryView` — a repeat candidate, never a diagnosis. */
export interface RepeatedInquiry {
  readonly axis: string;
  readonly key: string;
  readonly labelKo: string;
  readonly occurrences: number;
  readonly answeredOccurrences: number;
  readonly firstSeenOn: string | null;
  readonly lastSeenOn: string | null;
  readonly windowDays: number;
}

/** Mirror of `InboxResponse`. `unansweredInquiries` is server-side and NEVER capped by `limit`. */
export interface InboxSummary {
  readonly items: unknown[];
  readonly total: number;
  readonly unansweredInquiries: number;
}

/**
 * What `POST /api/agent/plan` answers — the planner seam's server side (Operator Graph v2 schema).
 *
 * <b>`available: false` no longer means "route deterministically instead".</b> There is no deterministic
 * router any more; it means the run FAILS. The two sub-cases are kept apart only so the screen can say
 * which: `providerVersion` present ⇒ the capability is on and the model declined this goal; absent ⇒ the
 * capability is off for this org.
 *
 * <b>Every field beyond `available` is optional on the wire.</b> A model that omits one produces an
 * empty list here and the validator then refuses the plan — which is the correct outcome. Filling a gap
 * with a plausible default on this side would be the client doing the planning.
 */
export interface AgentPlanView {
  readonly available: boolean;
  readonly supported: boolean;
  readonly userGoal?: string | null;
  readonly unresolvedEntities?: Array<{ kind?: string; mention: string }>;
  readonly informationNeeds?: Array<{
    id?: string;
    question?: string;
    kind?: string;
    why?: string;
    required?: boolean;
  }>;
  readonly specialists: string[];
  readonly tools: string[];
  readonly retrievalOrder?: string[];
  readonly retrievalParallel?: string[];
  readonly retrievalStopWhen?: string | null;
  readonly evidenceRequirements?: Array<{
    needId?: string;
    minEvidence?: number;
    acceptableKinds?: string[];
  }>;
  readonly riskClass?: string | null;
  readonly maxIterations?: number;
  readonly maxToolCalls?: number;
  readonly stopWhenEnough?: string | null;
  /** Set only when the org's daily Agent budget is what refused — a different remedy from "off". */
  readonly quotaMessage?: string | null;
  readonly clarificationNeeded?: boolean;
  readonly clarificationReason?: string | null;
  readonly rationale: string | null;
  readonly providerVersion: string | null;
  /* ── Plan schema v3 (Agentic Operating Workspace v2). Every field optional; unknown values ⇒ default. */
  readonly requestedAction?: string | null;
  readonly tone?: string | null;
  readonly filters?: {
    period?: string | null;
    periodDays?: number | null;
    rating?: string | null;
    channel?: string | null;
    scope?: string | null;
    topic?: string | null;
    reviewIntent?: string | null;
    inquiryIntent?: string | null;
    limit?: number | null;
    order?: string | null;
    status?: string | null;
  } | null;
  readonly target?: { selector?: string | null; index?: number | null } | null;
}

/**
 * What `POST /api/agent/judge` answers — the Evidence Judge's server side.
 *
 * `available: false` means the rule judge decides instead. That is the conservative direction: the
 * rule judge can withhold a finding but never approves one the model would have refused.
 */
export interface AgentJudgeView {
  readonly available: boolean;
  readonly hasEvidence: boolean;
  readonly supportingEvidenceIds: string[];
  readonly unsafeAssertion: boolean;
  readonly unsafeReason: string | null;
  readonly needsMore: boolean;
  readonly needsMoreTool: string | null;
  readonly needsMoreReason: string | null;
  readonly providerVersion: string | null;
  /** Set only when the org's daily Agent budget is what refused — a different remedy from "off". */
  readonly quotaMessage?: string | null;
}

/* ─────────────── Cross-Channel Operational Reasoning v1 (2026-08-24) ─────────────── */

/**
 * Whether one channel's data of one type may be spoken about as CURRENT — mirror of the backend's
 * `com.sellerops.coverage.ChannelDataState`.
 *
 * <b>A third axis, and never a merge with the other two.</b> {@link AttentionCoverage} answers "can
 * these rows be attributed to this scope"; {@link KnowledgeCoverage} answers "do we hold this fact".
 * Neither can answer "does this channel still tell us what is happening", and the day that question
 * became unavoidable is on the record: NAVER 문의 was live-proven on two official resources and, hours
 * later, its first routine run was refused at token issuance. A runtime with one word for "no data"
 * would have to call that channel either unsupported (disproven) or current (untrue).
 *
 * <b>`ZERO` is the scarcest value.</b> It is the only one from which an answer may say "없습니다".
 */
export type ChannelDataState =
  | "OBSERVED_FRESH"
  | "OBSERVED_FRESHNESS_UNPROVEN"
  | "ZERO"
  | "NOT_SUPPORTED"
  | "NOT_CONNECTED"
  | "BLOCKED";

/** Mirror of `ChannelCoverageRow` — one channel × one data type, with the facts behind the verdict. */
export interface ChannelCoverageRow {
  readonly channelCode: string;
  readonly channelNameKo: string | null;
  readonly dataType: string;
  readonly state: ChannelDataState;
  /** Whether the CHANNEL offers this type — declared capability, never this deployment's wiring. */
  readonly supported: boolean;
  readonly verificationStatus: string | null;
  readonly connected: boolean;
  readonly connectionStatus: string | null;
  readonly routineEnabled: boolean;
  /** null / "OPERATOR" / "SYSTEM" — who stopped routine collection, when it is stopped. */
  readonly routinePausedBy: string | null;
  readonly lastSuccessfulSyncAt: string | null;
  readonly rows: number;
  /** Unanswered inquiries / negative reviews. `null` where the type has no such subset. */
  readonly openRows: number | null;
  /** The newest SOURCE time among the stored rows — never the read time. */
  readonly newestObservedAt: string | null;
}

/* ─────────────── Product Knowledge Library (Demo Core Experience v1, 2026-08-24) ─────────────── */

/**
 * What kind of document the seller wrote. Mirror of the backend's `KnowledgeSourceType`.
 *
 * <b>The type is part of the citation, not a filing convenience.</b> A POLICY sentence and a USAGE
 * sentence are both true and are not interchangeable in a customer-facing answer, so a passage that
 * arrives without its kind cannot be quoted responsibly.
 */
export type KnowledgeSourceType = "DESCRIPTION" | "FAQ" | "USAGE" | "POLICY" | "LINK";

/** One retrieved passage of the seller's own writing, with everything needed to attribute it. */
export interface KnowledgePassage {
  readonly sourceId: string;
  readonly chunkId: string;
  readonly sourceType: KnowledgeSourceType;
  readonly title: string;
  readonly content: string;
  readonly ordinal: number;
  readonly score: number;
  readonly authorName: string | null;
  readonly sourceUrl: string | null;
  readonly updatedAt: string | null;
}

/**
 * A retrieval attempt over ONE product's library.
 *
 * <b>`documentsSearched` separates the two absences.</b> Zero documents means the seller has written
 * nothing about this product; documents with no matching passage means they wrote about something
 * else. An answer that conflates them reports a gap in the library as a fact about the product.
 */
/**
 * What one retrieval established (Retrieval & Grounding Correctness v1). FOUND · ABSENT (no document to
 * search) · NO_RELEVANT_EVIDENCE (documents, no covering passage) · NOT_APPLICABLE (lexical hits, every
 * one declared about another operating topic). Optional on the wire for an older backend; `outcomeOf`
 * derives the two-valued version from the counts when it is missing.
 */
export type RetrievalOutcome = "FOUND" | "ABSENT" | "NO_RELEVANT_EVIDENCE" | "NOT_APPLICABLE";

export function outcomeOf(r: { readonly outcome?: RetrievalOutcome | null; readonly documentsSearched: number; readonly passages: readonly unknown[] }): RetrievalOutcome {
  if (r.outcome) return r.outcome;
  return r.documentsSearched === 0 ? "ABSENT" : r.passages.length === 0 ? "NO_RELEVANT_EVIDENCE" : "FOUND";
}

export interface KnowledgeSearchResult {
  readonly productId: string;
  /** The form of the question that matched (a bounded candidate), or the whole question when none did. */
  readonly query: string;
  readonly documentsSearched: number;
  readonly passagesSearched: number;
  readonly passages: KnowledgePassage[];
  readonly outcome?: RetrievalOutcome | null;
  readonly rejectedNotApplicable?: number;
  readonly candidatesTried?: number;
}

/** Mirror of `AnswerMemoryPassage` — an answer this company actually sent or approved. */
export interface AnswerMemoryPassage {
  readonly memoryId: string;
  readonly topicSignature: string | null;
  readonly topicCategory: string | null;
  readonly answerTitle: string | null;
  readonly answerBody: string;
  readonly score: number;
  readonly strength: "IMPORTED_SELLER_ANSWER" | "USER_APPROVED" | "EXECUTOR_SENT_VERIFIED" | string;
  readonly strengthLabel: string;
  readonly productId: string | null;
  readonly channelCode: string | null;
  readonly authorName: string | null;
  readonly version: number;
  readonly updatedAt: string | null;
}

/** Mirror of `AnswerMemorySearchResponse` — `GET /api/answer-memory/search`. */
export interface AnswerMemorySearchResult {
  readonly query: string;
  readonly memoriesSearched: number;
  readonly supersededByConflict: number;
  readonly passages: AnswerMemoryPassage[];
  readonly outcome?: RetrievalOutcome | null;
  readonly candidatesTried?: number;
}

export interface AnswerMemorySearchParams {
  readonly query: string;
  readonly productId?: string;
  /** The product's display name — discounted from the question, and what lets a topic-less question list the record. */
  readonly productName?: string;
  readonly excludeInquiryId?: string;
  readonly limit?: number;
}

/* ─────────────── Knowledge Context v1-A (2026-08-29) — the company's operating rules, read on demand ─────────────── */

/** The closed vocabulary of `org_knowledge_sources.knowledge_type` (backend `OrgKnowledgeType`). */
export type OrgKnowledgeType =
  | "SHIPPING_POLICY" | "CANCELLATION_POLICY" | "EXCHANGE_REFUND_POLICY" | "PAYMENT_POLICY"
  | "TAX_INVOICE" | "CASH_RECEIPT" | "GENERAL_CS_FAQ" | "OTHER";

/** One passage of GET /api/org-knowledge/search (mirror of `OrgKnowledgePassage`). */
export interface OrgKnowledgePassage {
  readonly sourceId: string;
  readonly chunkId: string;
  readonly knowledgeType: OrgKnowledgeType | string;
  readonly title: string;
  readonly content: string;
  readonly ordinal: number;
  readonly score: number;
  readonly authorName: string | null;
  readonly sourceUrl: string | null;
  readonly version: number;
  readonly updatedAt: string | null;
}

/**
 * GET /api/seller-profile (mirror of `SellerProfileView`) — Seller Context v1-B. The company as the
 * seller registered it: the org's existing name and one seller-authored summary (≤500 chars), or none.
 * Org-scoped by the bearer. Context about who is speaking, never evidence for an operational claim.
 */
export interface SellerProfileView {
  readonly name: string | null;
  readonly businessSummary: string | null;
  readonly configured: boolean;
  readonly updatedAt: string | null;
}

/** GET /api/org-knowledge/search — org-scoped by the bearer; `documentsSearched: 0` is "nothing registered". */
export interface OrgKnowledgeSearchResult {
  readonly query: string;
  readonly documentsSearched: number;
  readonly passagesSearched: number;
  readonly passages: OrgKnowledgePassage[];
  readonly outcome?: RetrievalOutcome | null;
  readonly rejectedNotApplicable?: number;
  readonly candidatesTried?: number;
  /** Which operating topics the registered rules declare (`KnowledgeTopic` names) — the 「기준 없음」 fact per topic. */
  readonly topicsDeclared?: string[];
}

/** One evidence row of a generated draft (mirror of `DraftEvidenceView`). `snippet` is never forwarded. */
export interface DraftEvidenceRef {
  readonly kind: string;
  readonly scopeLabel: string;
  readonly title: string | null;
  readonly locator: string | null;
  readonly sourceId: string | null;
  readonly chunkId: string | null;
  readonly snippet: string | null;
}

/* ─────────────── Agentic Operating Workspace v2 (2026-08-27) — conversation-lane reads ─────────────── */

/** One row of GET /api/reviews/recent. `preview` is the backend's sanitized preview, or null when textless. */
export interface RecentReviewItem {
  readonly id: string;
  readonly sellerAccountId: string;
  readonly channelCode: string;
  readonly channelNameKo: string | null;
  readonly writtenOn: string | null;
  readonly rating: number | null;
  readonly negative: boolean;
  readonly preview: string | null;
  readonly productId: string | null;
  readonly productName: string | null;
  readonly replyState: string | null;
  readonly executableIdentity?: ExecutableIdentity;
}

/** GET /api/reviews/recent — rows in a window plus the REVIEW coverage rows of the visible channels. */
export interface RecentReviewsResponse {
  readonly from: string;
  readonly to: string;
  readonly negativeOnly: boolean;
  readonly total: number;
  readonly items: RecentReviewItem[];
  readonly coverage: ChannelCoverageRow[];
}

export interface RecentReviewsParams {
  readonly from?: string;
  readonly to?: string;
  readonly negativeOnly?: boolean;
  readonly channel?: string;
  readonly productId?: string;
  readonly size?: number;
  /** Query Accuracy v1: which end of the window comes first. Absent ⇒ NEWEST. */
  readonly order?: "NEWEST" | "OLDEST";
}

/** Mirrors of the dashboard overview DTOs (`com.sellerops.dashboard.metrics.dto`). */
export interface MetricPeriod {
  readonly from: string;
  readonly to: string;
  readonly previousFrom: string;
  readonly previousTo: string;
  readonly days: number;
}
export interface MetricKpi {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  readonly unit: string;
  readonly previousValue: number | null;
  readonly deltaPercent: number | null;
  readonly comparable: boolean;
  readonly excludedChannels: number;
  readonly freshnessUnproven: boolean;
}
export interface MetricPoint { readonly date: string; readonly value: number }
export interface MetricSeries {
  readonly key: string;
  readonly label: string;
  readonly unit: string;
  readonly points: MetricPoint[];
}
export interface ChannelMetricRow {
  readonly channelCode: string;
  readonly channelNameKo: string;
  readonly orderState: ChannelDataState;
  readonly revenue: number;
  readonly orders: number;
  readonly countedInOrders: boolean;
  readonly inquiryState: ChannelDataState;
  readonly inquiries: number;
  readonly unansweredInquiries: number;
  readonly countedInInquiries: boolean;
  readonly reviewState: ChannelDataState;
  readonly reviews: number;
  readonly negativeReviews: number;
  readonly countedInReviews: boolean;
}
export interface MetricExclusion {
  readonly channelCode: string;
  readonly channelNameKo: string;
  readonly dataType: string;
  readonly state: ChannelDataState;
  readonly reasonKo: string;
}
export interface OperationsMetrics {
  readonly period: MetricPeriod;
  readonly revenueBasis: string;
  readonly orderCountBasis: string;
  readonly kpis: MetricKpi[];
  readonly series: MetricSeries[];
  readonly channels: ChannelMetricRow[];
  readonly exclusions: MetricExclusion[];
  readonly exampleDataIncluded: boolean;
}
/** GET /api/dashboard/overview?days=N. Insights are not read by the runtime. */
export interface DashboardOverview {
  readonly metrics: OperationsMetrics;
  readonly insights?: unknown[];
}

/** GET /api/orders/summary?from&to&channelId (mirror of `OrderSummaryResponse`). */
export interface OrderSummaryResponse {
  readonly totalOrders7d: number;
  readonly totalSales7d: number;
  readonly trend: Array<{ date: string; orderCount: number; salesAmount: number }>;
  readonly channelShare: Array<{ channelNameKo: string; salesAmount: number; percent: number }>;
}
export interface OrderSummaryParams {
  readonly from?: string;
  readonly to?: string;
  readonly channelId?: string;
}

/** GET /api/channels — the catalogue row (id ↔ code is the only pair the runtime reads). */
export interface ChannelSummary {
  readonly id: string;
  readonly code: string;
  readonly nameKo: string;
  readonly status?: string | null;
}

/** GET /api/seller-accounts (mirror of `SellerAccountResponse`). No credential travels here. */
export interface SellerAccountSummary {
  readonly id: string;
  readonly channelId: string;
  readonly channelNameKo: string | null;
  readonly alias: string | null;
  readonly connectionStatus: string | null;
  readonly lastSyncedAt: string | null;
  readonly fileUpload: boolean;
}

/** GET /api/sync-runs (mirror of `SyncRunView`, the fields the resume check reads). */
export interface SyncRunSummary {
  readonly id: string;
  readonly sellerAccountId: string | null;
  readonly channelId: string | null;
  readonly dataType: string | null;
  /** File uploads carry the data type here and leave `dataType`/`sellerAccountId` null. */
  readonly uploadType?: string | null;
  readonly trigger: string | null;
  readonly status: string;
  readonly successRows: number;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
}
export interface SyncRunParams {
  readonly sellerAccountId?: string;
  readonly channelId?: string;
  readonly dataType?: string;
  readonly status?: string;
}

/** POST /api/inquiries/{id}/draft/generate (mirror of `GeneratedDraftView`). `draft` null is a real answer. */
export interface GeneratedDraftView {
  readonly draft: ReplyDraftView | null;
  readonly authorKind: string | null;
  readonly knowledgeState: string | null;
  readonly knowledgeNote: string | null;
  readonly answerBasis: string | null;
  readonly answerBasisNote: string | null;
  readonly answerBasisAction: string | null;
  readonly productId: string | null;
  readonly evidence: ReadonlyArray<DraftEvidenceRef>;
  /** Seller Context v1-B: the registered 회사 정보 was shown to the drafter as wording context. Metadata only. */
  readonly companyContextUsed?: boolean;
  readonly unavailableMessage: string | null;
  /**
   * Knowledge Capture v1 — the retrieval's closed verdict per lane (mirror of `KnowledgeGapView`), so a
   * gap is decided from values the composer computed, never from a sentence. Absent on an older backend.
   */
  readonly knowledgeGap?: KnowledgeGapView | null;
}

/** Mirror of `KnowledgeGapView`: what each lane established and which noun/topic the question named. */
export interface KnowledgeGapView {
  readonly productId: string | null;
  /** `KnowledgeTopic` name (SHIPPING · EXCHANGE_RETURN · CANCELLATION · PAYMENT · TAX_INVOICE · CASH_RECEIPT) or null. */
  readonly topic: string | null;
  /** Every operating topic the question's words name (`topic` is the single member); absent on an older backend. */
  readonly topics?: ReadonlyArray<string>;
  /** The customer's own property noun, quoted from the question, or null. */
  readonly missingSubject: string | null;
  readonly productOutcome: RetrievalOutcome | null;
  readonly policyOutcome: RetrievalOutcome | null;
  /** `NOT_VARIANT_SENSITIVE` · `VARIANT_UNRESOLVED` · `VARIANT_NAMED`, or null. */
  readonly applicability: string | null;
  readonly variantId: string | null;
  readonly policyDeclaresTopic: boolean;
}

/* ─────────────── Knowledge Capture v1 (2026-08-30) — the seller-write seams the lane may reach ─────────────── */

/** Mirror of `OrgKnowledgeView` (`GET/POST /api/org-knowledge/sources`). */
export interface OrgKnowledgeSourceView {
  readonly id: string;
  readonly knowledgeType: string;
  readonly typeLabel: string | null;
  readonly title: string;
  readonly body: string;
  readonly version?: number;
  readonly passageCount?: number;
}

export interface OrgKnowledgeCreateRequest {
  readonly knowledgeType: string;
  readonly title: string;
  readonly body: string;
  readonly sourceUrl: null;
}

/** Mirror of `KnowledgeSourceView` (`GET/POST /api/products/{id}/knowledge/sources`). */
export interface ProductKnowledgeSourceView {
  readonly id: string;
  readonly productId: string;
  readonly sourceType: string;
  readonly title: string;
  readonly body: string;
  readonly chunks?: number;
  readonly authoredOrigin?: string | null;
  readonly variantId: string | null;
  readonly variantName?: string | null;
}

export interface ProductKnowledgeCreateRequest {
  readonly sourceType: "DESCRIPTION" | "FAQ" | "USAGE" | "POLICY";
  readonly title: string;
  readonly body: string;
  readonly sourceUrl: null;
  readonly variantId: string | null;
}

/* ─────────────── Channel capability sources (Agentic Operating Workspace v2 — channel-capability completion, 2026-08-28) ─────────────── */

/**
 * Mirror of `ChannelCapabilityOverview` (`GET /api/channels/{code}/capabilities/overview`).
 *
 * `dataTypes[].supported` is the PULL connector's answer; `acquisitionPaths` is the additive axis
 * (`AcquisitionPathRegistry`) for a type that reaches SellerOps some other way. Read together: a type
 * can be `supported=false` and still be collected — the Coupang 상품평 case.
 */
export interface ChannelCapabilityOverview {
  readonly channelCode: string;
  readonly channelNameKo: string | null;
  readonly connectorClass: string | null;
  readonly autoCollectSupported: boolean;
  readonly dataTypes: ReadonlyArray<{
    readonly dataType: string;
    readonly label: string | null;
    readonly supported: boolean;
    readonly verificationStatus: string | null;
    /** `method` ∈ API | ACTION_WINDOW | EXPORT | MANUAL; `recurrence` ∈ SCHEDULED | SELLER_REPEATED | ONE_OFF. */
    readonly acquisitionPaths: ReadonlyArray<{ readonly method: string; readonly verificationStatus: string; readonly recurrence: string }>;
  }>;
  readonly unsupportedScopes: ReadonlyArray<{ readonly code: string; readonly label: string }>;
}

/** Mirror of `InquiryReplyCapabilityView` (`GET /api/inquiry-publish/transports`) — the audited transport per (channel, subtype). */
export interface InquiryReplyTransportRow {
  readonly channelCode: string;
  /** null for a channel with a single source. */
  readonly sourceSubtype: string | null;
  /** DIRECT_API | GUIDED_ACTION | PLATFORM_SUPPORTED_NOT_IMPLEMENTED | UNSUPPORTED | NEEDS_VERIFICATION */
  readonly transport: string;
  readonly reasonKo: string | null;
  readonly evidence: string | null;
}

/**
 * Mirror of `ReviewChannelCapabilityView` — served inside `GET /api/seller-accounts/{accountId}/channel-reviews`
 * as `channel`. `executionKind` (Lane A, 2026-08-28) is the closed execution capability for a review reply
 * on this channel; absent on a backend predating it ⇒ read as NOT_SUPPORTED (fail closed).
 */
export interface ReviewChannelCapabilityView {
  readonly channelCode: string;
  readonly aiTriage: boolean;
  readonly originalLocate: string;
  readonly replySupported: boolean;
  readonly executionKind?: "API_EXECUTION" | "GUIDED_BROWSER_EXECUTION" | "NOT_SUPPORTED";
  /** Closed reason when `executionKind` is NOT_SUPPORTED (e.g. `EXECUTION_DISABLED`). */
  readonly executionReason?: string | null;
}

/** POST /api/seller-accounts/{accountId}/sync request. `dataType` ∈ REVIEW | INQUIRY | ORDER_SUMMARY | PRODUCT. */
export interface ManualSyncRequest {
  readonly dataType: "REVIEW" | "INQUIRY" | "ORDER_SUMMARY" | "PRODUCT";
}
