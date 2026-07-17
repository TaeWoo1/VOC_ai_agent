// Mirrors the backend DTOs (com.sellerops.*). Keep in sync with the API.

export type ChannelStatus =
  | "CONNECTED"
  | "AVAILABLE"
  | "FILE_UPLOAD_SUPPORTED"
  | "PREPARING"
  | "REQUEST_AVAILABLE"
  // Account-connection states from the OAuth onboarding flow (SellerAccount.connectionStatus).
  | "PENDING"
  | "RECONNECT_REQUIRED";

export interface UserView {
  id: string;
  email: string;
  name: string;
  role: string;
  orgId: string;
  orgName: string;
}

export interface AuthResponse {
  token: string;
  user: UserView;
}

/** Honest, flag-aware support facts for a channel (mirrors backend ChannelSupport).
 *  These are FACTS; the operator-facing Korean wording lives in lib/channelSupport.ts. */
export interface ChannelSupport {
  fileUploadSupported: boolean;
  fileUploadDataTypes: string[];
  autoCollectSupported: boolean;
  autoCollectDataTypes: string[];
  connectionCheckSupported: boolean;
  credentialSetupSupported: boolean;
}

export interface ChannelResponse {
  id: string;
  code: string;
  nameKo: string;
  status: ChannelStatus;
  dataBadges: string[];
  lastSyncedAt: string | null;
  actionLabel: string;
  support: ChannelSupport;
}

/**
 * Sanitized result of POST /api/connect/cafe24/start. Carries only the pending
 * account, its status, and the Cafe24 consent URL the browser is redirected to —
 * never a code, state, token, or secret.
 */
export interface Cafe24ConnectStartView {
  sellerAccountId: string;
  connectionStatus: ChannelStatus;
  authorizationUrl: string;
}

export interface SellerAccountResponse {
  id: string;
  channelId: string;
  channelNameKo: string;
  alias: string | null;
  connectionStatus: ChannelStatus;
  lastSyncedAt: string | null;
  fileUpload: boolean;
}

export interface DashboardCards {
  todayOrders: number;
  todaySales: number;
  newInquiries: number;
  unansweredInquiries: number;
  newReviews: number;
  negativeReviews: number;
  urgentCount: number;
  unhandledCount: number;
}

export interface TopProductIssue {
  productName: string;
  issueLabel: string;
  count: number;
}

export interface FeedItem {
  id: string; // source row UUID (inquiry/review); join key for item-analysis
  type: "INQUIRY" | "REVIEW";
  channelNameKo: string;
  productName: string;
  snippet: string;
  rating: number | null;
  status: string;
  receivedAt: string;
}

// Mirrors com.sellerops.itemanalysis.dto.ItemAnalysisView. Derived metadata only
// (no raw inquiry/review body). The current analyzer is rule-based, so
// analyzerKind is "RULE_BASED" and there is no model_name/prompt_version field.
export interface ItemAnalysis {
  sourceType: "INQUIRY" | "REVIEW";
  sourceId: string;
  summary: string;
  category: string;
  sentiment: "POSITIVE" | "NEUTRAL" | "NEGATIVE";
  urgency: "LOW" | "NORMAL" | "HIGH";
  recommendedAction: string;
  analyzerKind: string; // RULE_BASED
  analyzerName: string; // rule-based
  analyzerVersion: string; // rules-v1
  createdAt: string;
}

export interface SalesTrendPoint {
  date: string;
  orderCount: number;
  salesAmount: number;
}

export interface ChannelSalesShare {
  channelNameKo: string;
  salesAmount: number;
  percent: number;
}

export interface DashboardSummaryResponse {
  cards: DashboardCards;
  todoItems: string[];
  topProductIssues: TopProductIssue[];
  recentFeed: FeedItem[];
  salesTrend: SalesTrendPoint[];
  channelSalesShare: ChannelSalesShare[];
}

export interface InboxResponse {
  items: FeedItem[];
  total: number;
}

export interface OrderSummaryResponse {
  totalOrders7d: number;
  totalSales7d: number;
  trend: SalesTrendPoint[];
  channelShare: ChannelSalesShare[];
}

export type UploadType = "REVIEW" | "INQUIRY" | "ORDER_SUMMARY";

export interface RowError {
  rowNumber: number;
  message: string;
}

export interface IngestResult {
  syncJobId: string;
  uploadType: UploadType;
  status: string; // SUCCESS | PARTIAL | FAILED
  totalRows: number;
  successRows: number;
  skippedRows: number;
  failedRows: number;
  errorMessage: string | null;
  sampleErrors: RowError[];
}

export interface SyncJobView {
  id: string;
  channelId: string | null;
  jobType: string;
  uploadType: string | null;
  status: string;
  totalRows: number;
  successRows: number;
  skippedRows: number;
  failedRows: number;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

// --- Scheduled collection (Phase 3B Slice 7) ---

export type DataType = "REVIEW" | "INQUIRY" | "ORDER_SUMMARY" | "PRODUCT" | "SALES";

export interface ScheduleView {
  id: string;
  dataType: string;
  cadenceKind: string;
  intervalMinutes: number | null;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  pausedReason: string | null;
}

export interface ConnectionStatusView {
  sellerAccountId: string;
  state: string; // CONNECTED | DEGRADED | ... | NOT_COLLECTED
  lastSuccessAt: string | null;
  consecutiveFailures: number;
  lastError: string | null;
  lastSyncedAt: string | null;
  nextScheduledAt: string | null;
}

// Masked, read-only view of a stored connection credential. Mirrors the backend
// CredentialMetadata (com.sellerops.credential.CredentialMetadata) — operator
// subset only. NEVER carries a secret/ciphertext/IV: the GET /credentials
// endpoint cannot return one. `null` from the API means no credential on file.
export interface ConnectionInfoView {
  connectorClass: string;
  authType: string;
  tokenExpiresAt: string | null;
  lastRotatedAt: string | null;
  hasRefreshToken: boolean;
}

// CredentialTemplateView (com.sellerops.collect.dto.CredentialTemplateView) —
// the backend-owned credential FIELD SHAPE a channel requires. Metadata only:
// NEVER carries a value/ciphertext/IV/encryptionKeyId. `secret` marks fields the
// UI must treat as a secret (mask) versus showable identifiers. The endpoint
// 404s for channels with no API template (manual / file-upload) → null here.
export interface CredentialFieldView {
  key: string;
  label: string;
  required: boolean;
  secret: boolean;
  helpText: string;
}

export interface CredentialTemplateView {
  channelCode: string;
  connectorClass: string;
  authType: string;
  fields: CredentialFieldView[];
  notes: string;
}

// Write payload for POST /api/seller-accounts/{accountId}/credentials, mirroring
// the backend CredentialIntakeRequest (com.sellerops.collect.dto). The backend
// validates this against the channel's CredentialTemplate, server-derives the
// stored connectorClass/authType, and returns masked metadata only. `secrets` is
// keyed by CredentialFieldView.key. refreshToken/tokenExpiresAt are unused by the
// secret-entry form (CAFE24's refresh_token rides in `secrets` as a template
// field); kept optional to match the backend record.
export interface CredentialIntakeRequest {
  connectorClass: string;
  authType: string;
  secrets: Record<string, string>;
  refreshToken?: string;
  tokenExpiresAt?: string;
}

// Result of a manual, explicit test-connection (POST .../test-connection),
// mirroring the backend ConnectionTestResultView. Auth/connectivity only — it
// never implies collection. Safe fields only: NEVER a token, secret, ciphertext,
// IV, provider response body, header, or signed URL. `message` is a fixed,
// operator-safe backend string; `reasonCode` is a safe machine code (or null)
// and is not rendered raw.
export type ConnectionTestStatus = "SUCCESS" | "FAILED" | "UNSUPPORTED" | "NOT_CONFIGURED";

export interface ConnectionTestResultView {
  sellerAccountId: string;
  status: ConnectionTestStatus;
  checkedAt: string;
  message: string;
  reasonCode: string | null;
}

export interface ConnectorAlertView {
  id: string;
  sellerAccountId: string;
  channelId: string | null;
  channelNameKo: string | null;
  accountAlias: string | null;
  type: string; // AUTH_EXPIRED | REPEATED_FAILURE | RATE_LIMITED
  severity: string; // INFO | WARNING | CRITICAL
  message: string;
  createdAt: string;
  acknowledgedAt: string | null;
}

export interface SyncRunView {
  id: string;
  sellerAccountId: string | null;
  channelId: string | null;
  dataType: string | null;
  trigger: string; // SCHEDULED | MANUAL | RETRY | UPLOAD
  attempt: number;
  rateLimited: boolean;
  nextRetryAt: string | null;
  jobType: string;
  uploadType: string | null;
  status: string;
  totalRows: number;
  successRows: number;
  skippedRows: number;
  failedRows: number;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface SyncRunFilters {
  sellerAccountId?: string;
  channelId?: string;
  dataType?: string;
  trigger?: string;
  status?: string;
}

export interface CapabilityView {
  channelCode: string;
  connectorClass: string;
  dataType: string;
  supported: boolean;
  verificationStatus: string; // CONFIRMED | NEEDS_VERIFICATION | UNSUPPORTED
  notes: string | null;
}

// --- Operator dashboard + backfill (channel-generic) ---

// Mirrors com.sellerops.collect.dto.ChannelCapabilityOverview — the in-code
// connector capabilities plus honest unsupported-scope boundaries. Channel-generic:
// every API channel answers the same shape.
export interface DataTypeCapability {
  dataType: string;
  label: string;
  supported: boolean;
  verificationStatus: string; // CONFIRMED | NEEDS_VERIFICATION | UNSUPPORTED
}

export interface ScopeNote {
  code: string;
  label: string;
}

export interface ChannelCapabilityOverview {
  channelCode: string;
  channelNameKo: string | null;
  connectorClass: string | null;
  autoCollectSupported: boolean;
  dataTypes: DataTypeCapability[];
  unsupportedScopes: ScopeNote[];
}

// Mirrors com.sellerops.collect.dto.AccountDashboardSummary. Window-scoped totals
// for one connected account; counts cover only known-date articles, and
// unansweredInquiries is the conservative PENDING-only count.
export interface AccountDashboardSummary {
  sellerAccountId: string;
  channelId: string;
  channelNameKo: string | null;
  fromDate: string; // ISO yyyy-MM-dd
  toDate: string;
  salesAmount: number;
  orderCount: number;
  newReviews: number;
  newInquiries: number;
  unansweredInquiries: number;
  lastSyncState: string;
  lastSuccessAt: string | null;
}

// Mirrors com.sellerops.collect.dto.CommunityArticleView — METADATA ONLY. No
// title/content/source identifiers: the drill-down never carries free-text body or
// customer PII. Dates are KST calendar dates (no time); sourceCreatedDate is null
// when the source value was timezone-less.
export interface CommunityArticleView {
  type: string; // REVIEW | INQUIRY
  channelNameKo: string | null;
  rating: number | null;
  replyStatus: string;
  sourceCreatedDate: string | null;
  collectedDate: string | null;
}

export interface ArticleListResponse {
  type: string;
  page: number;
  size: number;
  total: number;
  items: CommunityArticleView[];
}

// Write payload for POST /api/seller-accounts/{id}/backfill, mirroring the backend
// BackfillRequest. Dates are KST calendar dates (yyyy-MM-dd).
export interface BackfillRequest {
  dataType: string;
  startDate: string;
  endDate: string;
}

// --- Operator attention signals (channel-generic VOC) ---

// Mirrors com.sellerops.attention.dto.AttentionSignal — METADATA ONLY. A typed,
// severity-ranked count of collected review/inquiry rows that need a look. Carries
// no raw article title/content, source identifiers, or customer PII; label and
// description are fixed operator-safe strings.
// Mirrors com.sellerops.attention.dto.SpikeComparison — aggregate counts only (the
// same numbers as the signal description), present only on RECENT_*_SPIKE_CANDIDATE.
export interface SpikeComparison {
  previousCount: number;
  deltaCount: number;
  ratio: number;
}

export interface AttentionSignal {
  // UNANSWERED_INQUIRY | LOW_RATING_REVIEW | NEW_INQUIRY | NEW_REVIEW | UNKNOWN_REPLY_STATUS
  //   | RECENT_REVIEW_SPIKE_CANDIDATE | RECENT_INQUIRY_SPIKE_CANDIDATE
  type: string;
  severity: string; // HIGH | MEDIUM | LOW
  count: number;
  label: string;
  description: string;
  sourceType: string; // REVIEW | INQUIRY
  channel: string | null;
  // Optional, additive: structured spike comparison; null/absent for routine signals.
  spike?: SpikeComparison | null;
}

// Mirrors com.sellerops.attention.dto.OperatorAttentionSummary. Reads no server
// clock: the [fromDate, toDate] window is the as-of context (no generatedAt). Items
// arrive pre-sorted by severity; an empty list means nothing needs attention.
export interface OperatorAttentionSummary {
  sellerAccountId: string;
  channel: string | null;
  fromDate: string; // ISO yyyy-MM-dd
  toDate: string;
  items: AttentionSignal[];
}

// Mirrors com.sellerops.attention.dto.OperatorVocItem — the channel-generic
// drill-down unit behind one attention signal. No raw article title/content,
// articleNo, or source/customer/order/product identifiers. `safePreview` is the one
// free-text field: a sanitized, length-limited preview produced read-time by the
// backend VocPreviewSanitizer — never the raw body. It is null when the source was
// empty or the sanitizer suppressed it. Dates are KST calendar dates;
// sourceCreatedDate is null when the source value was timezone-less.
//
// `productName` is the one product field and is a DISPLAY NAME ONLY — never an
// identifier. The backend deliberately exposes no productId/sku/productNo/productRef
// on this surface, and withholds any name that is really its own SKU, so there is no
// product identity here to render or route on.
//
// Its null means "no name is available" — NOT "this row has no product" (a Cafe24
// community article has a product the store simply cannot name). Rendering it as an
// absence of product would misread the contract; see productLabel in ./vocItems.
// `actionRef` is the row's ADDRESS — a client-opaque handle to round-trip when
// recording a decision, never to parse. It is not a permission: holding one grants
// nothing, and the backend re-derives org + account/channel scope on every call.
// Null when the row cannot be decided at all (every Cafe24 community article, which
// has no triage anchor). That null is a CAPABILITY LIMIT, like productName's — render
// it as the absence of an affordance, never as an absence of the row.
//
// `triageDisposition` is the operator's own recorded judgement, or null when none has
// been recorded. Null ("not yet triaged") is NOT the same as NO_ACTION ("looked at,
// nothing to do") — collapsing the two would erase the work of having decided. A row
// can have a ref and no disposition (the common case); a row with no ref necessarily
// has no disposition.
export interface OperatorVocItem {
  channelCode: string | null;
  channelNameKo: string | null;
  sourceType: string; // REVIEW | INQUIRY
  productName: string | null; // display name, or null when none can be resolved
  rating: number | null;
  // Null for every ingested-review (NAVER) row: a seller-center export carries no reply
  // state, so the source sends null rather than guessing one. Only the Cafe24 community
  // store has a real status to report. Nullable because the field spans BOTH sources and
  // one of them genuinely has nothing to say — typing it `string` forced every NAVER
  // fixture to invent a value, which is how "미답변" ended up asserted on rows the product
  // cannot emit. Renders as 상태 미상 either way; see replyStatusLabel.
  replyStatus: string | null;
  sourceCreatedDate: string | null;
  collectedDate: string | null;
  signalType: string; // the requesting AttentionSignalType
  safePreview: string | null; // sanitized preview, or null when suppressed/empty
  actionRef: string | null; // opaque address, or null when the row is not decidable
  triageDisposition: TriageDisposition | null; // null = not yet triaged
  // Whether an operator has already written or approved a reply for this review — batch
  // computed server-side, one query per page rather than a request per row.
  //
  // It exists so work cannot be stranded. The reply panel mounts on
  // `RESPONSE_NEEDED || hasReplyPreparation`, because a draft written while the review was
  // 대응 필요 must stay readable — and any approval withdrawable — after the operator moves
  // it to 지켜보기. The disposition alone cannot say whether work exists, and this row is
  // the only thing the drill-down has.
  //
  // A boolean and nothing more: this surface is metadata-only, so the draft's text, its
  // version, and the approval's state all come from the reply read. `false` for a row that
  // cannot be prepped at all (null actionRef) — a capability limit, not a claim.
  hasReplyPreparation: boolean;
}

// Mirrors com.sellerops.attention.triage.TriageDisposition. A decision, not a workflow
// phase: these say what the operator concluded, and nothing happens next — recording
// RESPONSE_NEEDED does not draft, queue, or send a reply. Deliberately NOT the inquiry
// pipeline's phase vocabulary; borrowing it would imply a machine-driven lifecycle that
// does not exist for reviews.
export type TriageDisposition = "RESPONSE_NEEDED" | "MONITOR" | "NO_ACTION";

// Mirrors com.sellerops.attention.triage.dto.TriageDecisionResponse.
// `disposition` is the review's CURRENT decision after the call — not necessarily the
// one this request asked for: replaying a command a later one superseded reports where
// things actually stand. `replayed` distinguishes "already applied, nothing written"
// from a fresh write; both are successes.
export interface TriageDecisionResponse {
  actionRef: string;
  disposition: TriageDisposition;
  replayed: boolean;
}

// --- Review response preparation -------------------------------------------------
//
// Mirrors com.sellerops.attention.reply.*. The surface goes: redacted body → rule-based
// suggestion → operator edits → approve (freeze) → copy. It stops at the clipboard —
// there is no publish route behind any of it, and approving freezes text rather than
// sending it. RESPONSE_NEEDED still promises nothing: it gates whether preparation is
// OFFERED, never causes it.

// Mirrors com.sellerops.attention.reply.ReviewReplyApprovalState.
export type ReviewReplyApprovalStateName = "APPROVED" | "WITHDRAWN";

// Mirrors dto.ReviewReplySuggestionView. Computed read-time and never persisted — a pure
// function of the (write-once) review body, so the same review always yields the same
// suggestion. `providerKind` is RULE_BASED today; the UI owns the label and must not
// overstate it as AI (Frontend Spec §10.3).
export interface ReviewReplySuggestion {
  body: string;
  category: string;
  providerKind: string;
  providerName: string;
  providerVersion: string;
}

// Mirrors dto.ReviewReplyDraftView. `contentFingerprint` is what a later approval binds
// to; `version` is what the next save passes as its baseVersion.
export interface ReviewReplyDraft {
  version: number;
  body: string;
  contentFingerprint: string;
  fingerprintAlgorithm: string;
  createdAt: string;
}

// Mirrors dto.ReviewReplyApprovalView. Absent entirely until the operator has approved
// once — never-approved is the absence of the object, not a state on it.
//
// `approvedBody` is the ONLY copyable text on the wire, and the server sends it only when
// `capabilities.canCopy` is true. Copy must use it and nothing else: the editor buffer can
// hold an unsaved keystroke nobody approved, and the clipboard's next stop is a public
// marketplace reply.
export interface ReviewReplyApproval {
  state: ReviewReplyApprovalStateName;
  approvedVersion: number | null;
  approvedFingerprint: string | null;
  approvedBody: string | null;
  decidedAt: string;
}

// Mirrors dto.ReviewReplyCapabilities — computed server-side, so the gate is stated once
// rather than re-derived here. The rule depends on the disposition AND whether a draft
// exists AND whether an approval stands; re-deriving it in the client is how the two
// surfaces drift apart. Render affordances from this; the server enforces independently.
//
// The asymmetry is deliberate: leaving RESPONSE_NEEDED closes canSave/canApprove/canCopy
// but never canWithdraw — withdrawal is the one operation that reduces commitment, and
// blocking it would strand a review in APPROVED with no exit.
export interface ReviewReplyCapabilities {
  canSave: boolean;
  canApprove: boolean;
  canWithdraw: boolean;
  canCopy: boolean;
}

// Mirrors dto.ReviewReplyPrepView — everything the panel needs, in one read.
//
// `redactedBody` is the review's WHOLE body with sensitive spans tokenized, not the list's
// 60-char `safePreview`: the operator has to read the complaint to answer it. Null only
// when the source was blank. `bodyRedacted` says whether anything was hidden, so the panel
// can tell the operator rather than leave them puzzling over a [번호] in text they are
// about to send a customer.
//
// `draft` is null until they save one; `approval` is null until they approve one. Both
// nulls mean "not yet", never "not allowed" — `capabilities` is where permission lives.
export interface ReviewReplyPrep {
  actionRef: string;
  redactedBody: string | null;
  bodyRedacted: boolean;
  triageDisposition: TriageDisposition | null;
  suggestion: ReviewReplySuggestion;
  draft: ReviewReplyDraft | null;
  approval: ReviewReplyApproval | null;
  capabilities: ReviewReplyCapabilities;
}

// Mirrors dto.ReviewReplyApprovalResponse. `state` is the CURRENT state after the call —
// not necessarily the one asked for. `replayed` distinguishes "already applied, nothing
// written" from a fresh write; both are successes.
export interface ReviewReplyApprovalResponse {
  actionRef: string;
  state: ReviewReplyApprovalStateName;
  replayed: boolean;
}

// Mirrors com.sellerops.attention.dto.OperatorVocItemPage. Reads no server clock;
// the [fromDate, toDate] window is the as-of context (no generatedAt).
export interface OperatorVocItemPage {
  signalType: string;
  fromDate: string; // ISO yyyy-MM-dd
  toDate: string;
  page: number;
  size: number;
  total: number;
  items: OperatorVocItem[];
}

// --- Seller inquiry workflow (OPEN queue → detail → proposal → PROPOSED) ---

// Mirrors com.sellerops.inquiry.queue.dto.InquiryQueueItem. Sanitized queue row:
// carries the seller-visible title but deliberately NO details/body and NO author.
export interface InquiryQueueItem {
  workItemId: string;
  inquiryId: string;
  sellerAccountId: string;
  channelId: string;
  phase: string; // OPEN | PROPOSED | ... (server lifecycle)
  status: string; // UNANSWERED | ANSWERED
  title: string | null;
  receivedAt: string; // ISO instant
}

// Mirrors com.sellerops.inquiry.queue.dto.InquiryQueueResponse.
export interface InquiryQueueResponse {
  content: InquiryQueueItem[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

// Mirrors com.sellerops.inquiry.proposal.dto.ProposalView. Coarse decision
// metadata + provider provenance only — never a reply body, buyer identity, or
// audit internals.
export interface ProposalView {
  proposalId: string;
  workItemId: string;
  inquiryId: string;
  actionKind: string;
  summaryCategory: string;
  requiresApproval: boolean;
  proposedBy: string;
  providerKind: string;
  providerName: string;
  providerVersion: string;
}

// Mirrors com.sellerops.inquiry.proposal.dto.InquiryDetail. Seller-only: exposes
// the raw title/details (the seller owns them) but never the author.
export interface InquiryDetail {
  workItemId: string;
  inquiryId: string;
  sellerAccountId: string;
  channelId: string;
  phase: string;
  status: string;
  informStatus: string | null;
  title: string | null;
  details: string | null;
  receivedAt: string;
  proposal: ProposalView | null;
}

// Mirrors com.sellerops.inquiry.proposal.dto.ProposalResult (POST response).
export interface ProposalResult {
  workItemId: string;
  phase: string;
  proposal: ProposalView;
}
