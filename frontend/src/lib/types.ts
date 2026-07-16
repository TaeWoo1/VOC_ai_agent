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
export interface OperatorVocItem {
  channelCode: string | null;
  channelNameKo: string | null;
  sourceType: string; // REVIEW | INQUIRY
  productName: string | null; // display name, or null when none can be resolved
  rating: number | null;
  replyStatus: string;
  sourceCreatedDate: string | null;
  collectedDate: string | null;
  signalType: string; // the requesting AttentionSignalType
  safePreview: string | null; // sanitized preview, or null when suppressed/empty
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
