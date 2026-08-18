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

/**
 * Sanitized result of the read-only Cafe24 connection capability check (first-connection
 * tutorial). Carries no mall id, token, OAuth code/state, board name, or personal data — the
 * mall's identity is reported only as {@link identityConfirmed}. Every string is a closed
 * vocabulary or a fixed backend label.
 */
export interface Cafe24CapabilityFeatureView {
  feature: string; // ORDER_READ | INQUIRY_COLLECT | REVIEW_COLLECT | ISSUE_ANALYSIS | INQUIRY_REPLY | ONE_TO_ONE_EXCLUDED
  state: string; // AVAILABLE | NEEDS_ATTENTION | NOT_ENABLED
  label: string;
  reason: string | null;
}

export interface Cafe24CapabilityView {
  sellerAccountId: string;
  connectionStatus: string | null;
  credentialPresent: boolean;
  credentialDecryptable: boolean;
  identityConfirmed: boolean;
  excludedBoardHidden: boolean;
  connectionVerified: boolean;
  overall: string; // AVAILABLE | NEEDS_ATTENTION
  reason: string | null;
  features: Cafe24CapabilityFeatureView[];
}

/**
 * Sanitized result of the read-only NAVER guided-connection capability check (mirrors the backend
 * ConnectionCapabilityView). Carries no token, client id/secret, order id, or personal data — the
 * seller's identity is reported ONLY as {@link identityConfirmed} (the credential authenticated and
 * a first order sync reached this seller; NAVER exposes no whoami). Every string is a closed
 * vocabulary or a fixed backend code; the wizard maps each code to Korean copy.
 */
export interface ConnectionCapabilityFeatureView {
  feature: string; // ORDER_READ | REVIEW_IMPORT | REVIEW_REPLY | INQUIRY_READ
  state: string; // AVAILABLE | SETUP_REQUIRED | GUIDED_CONFIRMATION | NOT_ENABLED | INTEGRATION_PENDING | NEEDS_ATTENTION
  label: string;
  reason: string | null;
}

export interface ConnectionCapabilityView {
  sellerAccountId: string;
  channelCode: string;
  connectionStatus: string | null;
  credentialPresent: boolean;
  identityConfirmed: boolean;
  firstSyncStatus: string; // NONE | SUCCESS | PARTIAL | FAILED | RUNNING
  overall: string; // AVAILABLE | NEEDS_ATTENTION
  reason: string | null;
  features: ConnectionCapabilityFeatureView[];
}

/**
 * Deployment-global NAVER setup facts (mirrors the backend NaverSetupView), available WITHOUT an
 * account so the issuance tutorial can show them during first-time connection. `advertisedEgressIps`
 * is the fixed public egress IPv4(s) to register in the app's 'API 호출 IP' — sanitized, not a secret,
 * and EMPTY when none is configured (the UI then shows generic guidance, never a fabricated IP).
 */
export interface NaverSetupView {
  advertisedEgressIps: string[];
}

/**
 * Deployment-global Coupang setup facts (mirrors the backend CoupangSetupView), available WITHOUT an
 * account so the connection surface can show them during first-time connection. `advertisedEgressIps`
 * is the fixed public egress IPv4(s) to register in the Coupang app's calling-IP allowlist — sanitized,
 * not a secret, and EMPTY when none is configured (the UI then shows generic guidance, never a
 * fabricated IP).
 */
export interface CoupangSetupView {
  advertisedEgressIps: string[];
}

/**
 * Sanitized identity of a disposable walkthrough runtime (mirrors the backend WalkthroughContextView).
 * Carries a per-bootstrap opaque run id (an environment identifier, NOT a credential/token), git commit,
 * origins, a DB alias (never the full URL), flags, coarse baseline counts, and a start time. Used to prove
 * the operator's tab is bound to THIS backend/DB/runtime.
 */
export interface WalkthroughContextView {
  walkthroughRunId: string;
  gitCommit: string;
  frontendOrigin: string;
  backendOrigin: string;
  dbAlias: string;
  schedulerEnabled: boolean;
  /** The sanitized target channel this disposable run is bootstrapped for (e.g. "NAVER", "COUPANG"). */
  channelCode: string;
  /** Channel-neutral: whether the target channel's connector is enabled in this runtime. */
  connectorEnabled: boolean;
  baseline: { credentials: number; syncJobs: number; channelOrders: number; channelAccounts: number };
  startedAt: string;
}

/** Sanitized operator-tab handshake outcome (mirrors the backend result). */
export interface WalkthroughHandshakeResult {
  runMatched: boolean;
  originMatched: boolean;
  timestamp: string;
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
  /** Catalog channel id, so a row can be resolved to its account (older servers omit it). */
  channelId?: string | null;
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
  /** Rows returned (after the request's cap). */
  total: number;
  /** The org's UNANSWERED inquiries, counted server-side and never capped — the canonical 답변 필요 count. */
  unansweredInquiries: number;
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
  /** Credential-expiry sub-view (Coupang credential-expiry slice). Present only when the backend computes
   *  it for the channel; absent/null for channels without a token-expiry concept. Sanitized primitives
   *  only — no secret, token, or provider body. See {@link CoupangExpiryStatusView}. */
  expiry?: CoupangExpiryStatusView | null;
}

/** The credential-expiry state the backend computes PURELY from token_expires_at vs a reference `now` plus
 *  an auth-failure signal — never stored. `UNKNOWN` = no expiry date on file (offer the operator-confirm
 *  path; never auto-estimate). Buckets escalate by days remaining; a passed date splits DATE_PASSED
 *  (soft — "verify") vs EXPIRED (strong — a date passed AND auth is failing). */
export type CoupangExpiryState =
  | "UNKNOWN"
  | "OK"
  | "WARN_30"
  | "WARN_14"
  | "WARN_7"
  | "WARN_1"
  | "DATE_PASSED"
  | "EXPIRED";

/** Sanitized credential-expiry sub-view (mirrors the backend CoupangExpiryStatus). Primitives only. */
export interface CoupangExpiryStatusView {
  /** ISO instant the credential token expires, or null when unknown (→ UNKNOWN, operator-confirm path). */
  expiresAt: string | null;
  /** Whole days until expiry (ceil), or null when unknown. Negative once the date has passed. */
  daysRemaining: number | null;
  state: CoupangExpiryState;
  /** The connection is currently failing auth (consecutiveFailures>0 or a just-failed test). */
  authFailing: boolean;
  /** The backend recommends renewal now — state in {WARN_14,WARN_7,WARN_1,DATE_PASSED,EXPIRED}. */
  renewRecommended: boolean;
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

// Write payload for the guided-renewal atomic credential REPLACE (POST
// .../credentials/replace), mirroring the backend request. Carries the NEW credential
// secrets (keyed by CredentialFieldView.key) plus the operator-confirmed new token
// expiry. Secrets flow straight from the masked form to this call — never into a
// reducer/event/storage. `tokenExpiresAt` is optional (the operator may not have
// confirmed the new key's expiry date yet; the backend then leaves it UNKNOWN, never
// estimated).
export interface CredentialReplaceRequest {
  connectorClass: string;
  authType: string;
  secrets: Record<string, string>;
  tokenExpiresAt?: string;
}

// Safe result of an atomic credential REPLACE. On FAILURE the backend has already
// rolled back to the OLD credential (the connection is not destroyed). Safe fields
// only — NEVER a token, secret, ciphertext, IV, provider body, or header. `message`
// is a fixed operator-safe backend string; `reasonCode` is a safe machine code (or
// null) and is not rendered raw.
export interface CredentialReplaceResultView {
  status: string; // SUCCESS | FAILED
  reasonCode: string | null;
  message: string;
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
  /** What the resolved PULL CONNECTOR can serve. Not "does SellerOps have this" — see below. */
  supported: boolean;
  verificationStatus: string; // CONFIRMED | NEEDS_VERIFICATION | UNSUPPORTED
  /**
   * How SellerOps acquires this data type when that is NOT through the pull connector. Empty for
   * every type whose only route is the connector.
   *
   * Read it beside `supported`, never folded into it: Coupang 상품평 is `supported: false` — Coupang
   * publishes no seller review API — and is nonetheless collected, through the Action Window. Rendering
   * the boolean alone printed 리뷰 미지원 over a record holding 22 of them.
   *
   * Optional on the type because a backend that predates the field simply omits it; treat a missing
   * array as "no path", which is the same honest default the backend uses.
   */
  acquisitionPaths?: AcquisitionPathView[];
}

/** One non-connector acquisition route, carrying its own evidence. */
export interface AcquisitionPathView {
  method: string; // API | ACTION_WINDOW | EXPORT | MANUAL
  verificationStatus: string; // NEEDS_VERIFICATION | LIVE_PROVEN
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

// Mirrors com.sellerops.sync.ReviewImportView — one review import as the operator's history shows it.
//
// Counts mean exactly what ingest tallied: `successRows` = newly inserted reviews, `skippedRows` =
// duplicates rejected by dedup (an all-duplicate re-import is a SUCCESS with 0 new), `failedRows` =
// mapping plus persistence errors, `totalRows` = the sum of those three — NOT the file's row count.
//
// `status` is RUNNING (opened, never finalized) | SUCCESS | PARTIAL | FAILED.
// `method` is SELLER_CENTER_EXPORT (an Action Window export landed) | MANUAL_UPLOAD (a person picked
// a file) | null (a row older than the provenance column — unknown, never guessed).
//
// Deliberately carries no `errorMessage`: the server's is a raw row-error or exception text that can
// embed parser or filename detail. Copy for a failure is FE-owned. It carries no `channelId` either —
// nothing renders it, and per-row channel attribution arrives (as a readable label) when a second
// channel actually reaches this history.
export interface ReviewImport {
  id: string;
  method: string | null;
  status: string;
  totalRows: number;
  successRows: number;
  skippedRows: number;
  failedRows: number;
  startedAt: string;
  finishedAt: string | null;
}

// --- NAVER Initial Review Import (V1): plan / segment / attempt / coverage / health ---

export interface DateRangeView {
  start: string;
  end: string;
}

/** One segment: both state axes surfaced separately. `executionState` / `coverageState` are enum names. */
export interface ReviewImportSegmentView {
  id: string;
  ordinal: number;
  segmentStart: string;
  segmentEnd: string;
  executionState: "PENDING" | "ACTIVE" | "COMPLETED" | "FAILED";
  coverageState: "UNVERIFIED" | "COVERED" | "MISSING";
  coveredRows: number | null;
  rowsReconciled: boolean;
  superseded: boolean;
  parentSegmentId: string | null;
}

/**
 * How a fact about scope was established. Kept as two distinct values everywhere it surfaces: a guided run
 * reading the selected range off the live page and a seller ticking a box are different strengths of claim,
 * and the UI must never present the second as the first.
 */
export type ScopeEvidence = "MACHINE_MATCHED" | "OPERATOR_CONFIRMED";
export type RangeDiscoveryEvidence = "MACHINE_DISCOVERED" | "OPERATOR_CONFIRMED";

/**
 * A single-use authorization for one guided Action Window import run.
 *
 * The seller never sees the `launchRef` — it is the opaque binding the local agent presents to resolve what
 * this run may touch.
 */
export interface ReviewImportLaunchView {
  launchRef: string;
  kind: "DISCOVERY" | "SEGMENT";
  status: "ISSUED" | "CONSUMED" | "EXPIRED";
  planId: string | null;
  segmentId: string | null;
  /** The dates the guided run will ask the seller to select (segment runs only). */
  requiredStart: string | null;
  requiredEnd: string | null;
  discoveredStart: string | null;
  discoveredEnd: string | null;
  rangeEvidence: RangeDiscoveryEvidence | null;
}

export interface ReviewImportAttemptView {
  attemptNo: number;
  result: "ACTIVE" | "SUCCEEDED" | "FAILED";
  syncJobId: string | null;
  scopeConfirmed: boolean;
  /** Null on attempts recorded before the column existed — genuinely unknown, not assumed. */
  scopeEvidence: ScopeEvidence | null;
  rowsNew: number | null;
  rowsDuplicate: number | null;
  rowsFailed: number | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface ReviewImportPlanView {
  id: string;
  sellerAccountId: string;
  channelId: string;
  requestedStart: string;
  requestedEnd: string;
  status: "DRAFT" | "ACTIVE" | "COMPLETED" | "ABANDONED";
  createdAt: string;
}

export interface ReviewImportCoverageView {
  covered: DateRangeView[];
  missing: DateRangeView[];
  remaining: DateRangeView[];
  lastCoveredDate: string | null;
  coveredRows: number;
  coveredSegments: number;
  remainingSegments: number;
  missingSegments: number;
}

/**
 * What a chosen start month would create, before it is created.
 *
 * `segmentCount` is the number of separate exports the seller will perform by hand — the fact that makes the
 * choice a decision rather than a date entry. Server-computed, including `end` (today): a browser clock an hour
 * off would show one period and create another.
 */
export interface ReviewImportRangeSelectionView {
  start: string;
  end: string;
  segmentCount: number;
}

export interface ReviewImportPlanDetailView {
  plan: ReviewImportPlanView;
  segments: ReviewImportSegmentView[];
  coverage: ReviewImportCoverageView;
  /**
   * The segment the "continue" ticket would authorize next, chosen by the backend's own rule (the same one the
   * mint uses). The card displays THIS rather than re-deriving an order of its own, so the segment shown as next
   * is always the segment the ticket authorizes. Null when nothing remains.
   */
  nextSegmentId: string | null;
}

export interface ReviewImportHealthView {
  lastCoveredDate: string | null;
  missingRanges: DateRangeView[];
  newCount: number;
  duplicateCount: number;
  failedCount: number;
  nextRecommendedImport: string | null;
}

// Mirrors com.sellerops.reviewops.dto.IssueChangeCountsView. Counts of UNVALIDATED candidate
// signals — the issue thresholds are DRAFT and the extractor's accuracy is UNMEASURED. A surface
// renders these as "확인이 필요한 변화 / 이슈 후보", never "문제 N개 발견".
export interface IssueChangeCounts {
  workingTotal: number;
  needsReview: number;
  newlyRaised: number;
  surging: number;
  persistent: number;
  concentrated: number;
  improved: number;
}

// Mirrors com.sellerops.reviewops.dto.ReviewOpsLoopSummaryView. The repeated review-operations
// loop's "완료 결과 + 변화 요약", derived at read from import health + issue-memory change — no
// durable state of its own. `upToDate` is true when coverage reaches the reference date.
export interface ReviewOpsLoopSummary {
  referenceDate: string;
  lastCoveredDate: string | null;
  missingRanges: DateRangeView[];
  nextRecommendedImport: string | null;
  upToDate: boolean;
  // Account-cumulative (each live segment's latest attempt across the account's plans), NOT this run.
  newCount: number;
  duplicateCount: number;
  failedCount: number;
  // false when the account has reviews but issue-memory is still empty — the after-ingest refresh has not
  // run or silently failed; the surface must then say "분석 미갱신", never "no change".
  issueMemoryReady: boolean;
  issueChange: IssueChangeCounts;
}

export interface CreateReviewImportPlanRequest {
  sellerAccountId: string;
  channelId: string;
  requestedStart: string;
  requestedEnd: string;
}

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

// Mirrors com.sellerops.attention.AttentionCoverage. Whether the attention state can be safely
// determined for this scope. An empty `items` list means "nothing needs attention" ONLY when
// COVERED; otherwise SellerOps could not attribute the reviews and the surface must say so.
export type AttentionCoverage =
  | "COVERED"
  | "UNCERTAIN_MULTI_ACCOUNT"
  | "UNCERTAIN_UNSUPPORTED_CHANNEL";

// Mirrors com.sellerops.attention.dto.OperatorAttentionSummary. Reads no server
// clock: the [fromDate, toDate] window is the as-of context (no generatedAt). Items
// arrive pre-sorted by severity; an empty list means nothing needs attention ONLY when
// `coverage === "COVERED"` (see AttentionCoverage).
export interface OperatorAttentionSummary {
  sellerAccountId: string;
  channel: string | null;
  fromDate: string; // ISO yyyy-MM-dd
  toDate: string;
  coverage: AttentionCoverage;
  items: AttentionSignal[];
}

// Mirrors com.sellerops.attention.dto.OperatorReplyWorkView — 내 답변 작업.
// NOT window-scoped, deliberately: a commitment (a 대응 필요 decision, a saved draft) is the
// operator's until they finish or abandon it, so this survives reloads, window changes and sessions.
// Every `recentlyReported` row is UNVERIFIED — present it as 기록함 · 확인 안 함, never as 완료.
// `coverage` carries the same false-calm guard as the attention summary: when uncertain, empty lists
// mean the scope could not be attributed, NOT that there is no work.
// Mirrors com.sellerops.attention.reply.dto.ReviewReplyWorkDismissalResponse — the ack of a
// 작업에서 제외 write. Asserts nothing about the reply: no outcome, no verification, no completion.
export interface ReviewReplyWorkDismissalResponse {
  actionRef: string;
  replayed: boolean;
}

export interface OperatorReplyWorkView {
  sellerAccountId: string;
  channel: string | null;
  coverage: AttentionCoverage;
  todo: OperatorVocItem[];
  recentlyReported: OperatorVocItem[];
}

// Mirrors com.sellerops.attention.reply.dto.ReviewReplyWorkRestoreResponse — the ack of a 복원 write.
// Asserts nothing about the reply: no outcome, no verification, no completion — it only puts the
// review back on the to-do, outranking (never deleting) the dismissal it reverses.
export interface ReviewReplyWorkRestoreResponse {
  actionRef: string;
  replayed: boolean;
}

// Mirrors com.sellerops.attention.dto.OperatorDismissedReplyWorkView — one page of 제외한 작업, the
// reviews the operator has set aside so they can restore one. NOT window-scoped: an aged-out set-aside
// review stays reachable. Paged with `hasMore` ("더 보기") rather than a hard cap. `coverage` carries
// the same false-calm guard — when uncertain, an empty page means the scope could not be attributed,
// NOT that nothing is set aside. Being on this list means "set aside", never "completed".
export interface OperatorDismissedReplyWorkView {
  sellerAccountId: string;
  channel: string | null;
  coverage: AttentionCoverage;
  items: OperatorVocItem[];
  page: number;
  size: number;
  hasMore: boolean;
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
  // The row's stored rule-based analysis category — one of nine fixed Korean labels. It is
  // CONTEXT, not a queue rule: whether a row appears here is still decided by rating and
  // reply state alone.
  //
  // Null means NO analysis row exists, which is a COVERAGE fact rather than a verdict —
  // analysis runs on newly-inserted ids only and swallows its own failures, so an ordinary
  // review can be unanalyzed. Deliberately distinct from the stored 기타 category ("we
  // looked; it fits nothing"). Render the null as no statement at all: no chip, not 기타,
  // and not a placeholder implying something is missing from the review. Always null for a
  // source that cannot classify (every Cafe24 community article).
  category: string | null;
  // SellerOps' own record that the operator REPORTED posting the reply that currently stands — not
  // the channel's statement, which is `replyStatus`. The two must stay visibly different: this can
  // only ever say "기록됨", never "답변 완료", because verification is permanently UNVERIFIED (there
  // is no read-back oracle for a public reply).
  //
  // A row carrying it is excluded from the needs-a-look COUNT but stays LISTED, sorted below every
  // row that still needs doing. Excluded because the work is reported done; listed because the
  // report is unverified and a mistaken one has to remain visible and correctable.
  hasReportedSubmission: boolean;
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
  // v1.6: gates offering the GUIDED Action Window reply-submission flow. Same rule as canCopy —
  // you may guide a post only for an approved reply you may copy. It authorizes no send: SellerOps
  // guides and observes; the operator posts the reply themselves in the seller center.
  canStartSubmissionRun: boolean;
}

// What the operator reports at the guided submit barrier (mirrors OperatorOutcome). Kept separate
// from verification. SUBMISSION_ABORTED is an operator outcome (a deliberate end), not a failure.
export type OperatorOutcomeName = "OPERATOR_REPORTED_SUBMITTED" | "SUBMISSION_ABORTED";

// Mirrors dto.ReviewReplyOutcomeView. The operator-reported outcome for the CURRENT approved reply,
// or null if none. `operatorOutcome` and `verification` are TWO SEPARATE facts — the UI renders the
// pair and NEVER shows `verification` ("UNVERIFIED") alone, and never anything that reads as "완료".
// There is no verification a reply post can earn (no read-back), so `verification` is always
// "UNVERIFIED". Carries no reply body and no channel claim; `awRunRef` is the opaque guided-run id.
export interface ReviewReplyOutcome {
  operatorOutcome: OperatorOutcomeName;
  verification: "UNVERIFIED";
  recordedVersion: number;
  recordedFingerprint: string;
  // The opaque runId a guided post ran under, or NULL when the seller posted manually with no
  // guided run. Null is a FACT, not a gap: production may not mint a run identity for a run that
  // did not happen.
  awRunRef: string | null;
  recordedAt: string;
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
  // v1.6: the operator-reported outcome for the current approved reply (or null). See
  // ReviewReplyOutcome — outcome and verification are separate, always shown as a pair.
  outcome: ReviewReplyOutcome | null;
  capabilities: ReviewReplyCapabilities;
  // What the CHANNEL last said about an existing reply (PENDING | ANSWERED | UNKNOWN, from the
  // import's 답글여부) — never SellerOps' own record of a guided reply, which is `outcome`. Present
  // so the panel can explain WHY the guided step is unavailable instead of showing a dead control:
  // a review the channel already answered must not be guided into a second public reply.
  channelReplyState: string | null;
  // Locating context, so the seller can FIND this review in the seller center. SellerOps neither
  // posts the reply nor (without a runtime) navigates anywhere, so a panel that says "paste it into
  // the reply box" owes them enough to find the row. Both are already on the attention row they
  // clicked through; productName is a DISPLAY name, never a SKU. Null when unresolvable.
  productName: string | null;
  /** KST calendar date (date only) — the granularity a seller scans a review list by. */
  reviewDate: string | null;
  /** The review's coarse 1..5 rating, already on the wire and on the attention row. */
  rating: number | null;
}

// Mirrors dto.ReviewReplySubmissionRunResponse. `submissionRef` is an opaque, single-use binding the
// client passes into the guided run; it carries no review identity or reply text. Single-use: once an
// outcome is recorded against it, it is spent, and a retry needs a fresh call here.
export interface ReviewReplySubmissionRunResponse {
  actionRef: string;
  submissionRef: string;
  approvedVersion: number;
}

// Mirrors dto.ReviewReplyOutcomeResponse. Deliberately carries no body and no channel claim.
// `replayed` distinguishes an idempotent retry from a fresh record; both are successes.
export interface ReviewReplyOutcomeResponse {
  actionRef: string;
  recorded: boolean;
  replayed: boolean;
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
  // Rows matching everything the caller asked for, INCLUDING an active category facet —
  // this is what the pager pages through.
  total: number;
  // The same window IGNORING the category facet — the denominator categoryCounts and
  // unclassifiedCount are comparable to. Equal to `total` only when no facet is applied,
  // which is exactly why the two must not be used interchangeably: the mistake is invisible
  // until an operator picks a facet.
  unfilteredTotal: number;
  // The window's category breakdown, always computed unfiltered so choosing a facet cannot
  // collapse the facet list to the chosen option. Empty for a lens that offers no facet
  // (arrivals) and for a source that cannot classify at all (Cafe24 community articles).
  categoryCounts: CategoryCount[];
  // Rows with NO analysis at all — a coverage fact, not the 기타 category (which is a stored
  // verdict and appears in categoryCounts like any other).
  unclassifiedCount: number;
  items: OperatorVocItem[];
}

// Mirrors com.sellerops.attention.dto.CategoryCount. Derived metadata only: the category is
// one of the analyzer's nine fixed labels and never echoes customer text.
export interface CategoryCount {
  category: string;
  count: number;
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

// ---------------------------------------------------------------------------
// Review Issue Memory — mirrors com.sellerops.reviewissue.dto.*
//
// These are 이슈 후보 / 운영 신호, never a diagnosis, and they carry no cause. The
// extractor behind them is rule-based and its accuracy is UNMEASURED (the
// contracts/review-eval/naver/v1 label seed is empty), so no surface built on
// these types may assert why something is happening.
// ---------------------------------------------------------------------------

/** NEW | SURGING | PERSISTENT | CONCENTRATED | IMPROVED. */
export type IssueChangeKind =
  | "NEW"
  | "SURGING"
  | "PERSISTENT"
  | "CONCENTRATED"
  | "IMPROVED";

export type IssueLifecycleState =
  | "OBSERVING"
  | "NEEDS_REVIEW"
  | "ACTING"
  | "VERIFYING"
  | "RESOLVED";

export type IssueSeverity = "HIGH" | "NORMAL" | "LOW";

/**
 * The judgements for one issue plus the numbers a quantified surge line needs.
 * `labelsKo` comes from the server alongside `kinds` so a client cannot invent a
 * fifth category by mistranslating an enum — but the sentence around them is the
 * frontend's to write.
 */
export interface IssueChangeView {
  kinds: IssueChangeKind[];
  labelsKo: string[];
  highSurge: boolean;
  surgeWindowCount: number;
  surgeBaselineWeekly: number;
}

export interface ReviewIssueView {
  id: string;
  title: string;
  aspect: string;
  problem: string;
  severity: IssueSeverity;
  lifecycleState: IssueLifecycleState;
  lifecycleLabelKo: string;
  evidenceCount: number;
  firstEvidenceOn: string | null;
  lastEvidenceOn: string | null;
  dominantProductId: string | null;
  /** Null when nothing is attributable — render as absent, never as "기타". */
  dominantProductName: string | null;
  dismissed: boolean;
  extractorKind: string;
  change: IssueChangeView;
}

/**
 * One 근거 리뷰. `quote` is the masked opinion unit and is null when the
 * sanitizer suppressed it; a null must render as nothing, never as an empty
 * quote, which would imply the customer said nothing.
 */
export interface IssueEvidenceView {
  reviewId: string;
  unitOrdinal: number;
  occurredOn: string;
  productId: string | null;
  productName: string | null;
  rating: number | null;
  quote: string | null;
}

export interface IssueStateEventView {
  fromState: IssueLifecycleState | null;
  toState: IssueLifecycleState;
  toStateLabelKo: string;
  /** SYSTEM or OPERATOR — "SellerOps raised this" and "you decided this" differ. */
  actor: "SYSTEM" | "OPERATOR";
  reason: string;
  note: string | null;
  at: string;
}

export interface ReviewIssueDetailView {
  issue: ReviewIssueView;
  evidence: IssueEvidenceView[];
  history: IssueStateEventView[];
}

/* ─────────────────────── channel review record (Coupang WING 상품평) ─────────────────────── */

/**
 * One row of a connected channel's review record. `preview` is the redacted one-line snippet the
 * backend produced, never the review body — and it is null when too little survived redaction to be
 * worth showing, which must render as nothing rather than as an empty quote.
 *
 * There is no author field. Coupang prints the buyer's name beside every review on the seller's own
 * screen; it is not read, not stored, and has no field here to arrive in.
 */
export interface ChannelReviewItemView {
  id: string;
  writtenOn: string | null;
  rating: number | null;
  negative: boolean;
  preview: string | null;
  productName: string | null;
  productId: string | null;
  vendorItemId: string | null;
  mediaCount: number;
  /**
   * The buyer rated and wrote nothing. Render it as what it is — 별점만 남긴 상품평 — never as "본문을
   * 표시할 수 없습니다", which would blame SellerOps for something the buyer chose.
   */
  textless: boolean;
  /** Arrived in the most recent import — derived from that import's start, never a read flag. */
  isNew: boolean;
  triage: ReviewTriageNote;
  /**
   * The pilot's additive `AI 확인 필요` mark, or null. Null on every row when the pilot is off for this
   * org, and null on every row the rule already calls 확인 필요 — see `AiTriageMarkView`. When present
   * the row sorts with 확인 필요; `triage.tier` still says what the RULE decided, and the surface shows
   * both rather than merging them.
   */
  aiMark: AiTriageMarkView | null;
}

/**
 * The pilot's additive mark on one review — RUBRIC v2 §13.7.
 *
 * Present only where the pilot ADDED something: never "the AI agrees", always "the AI raised this
 * one, and the rule alone would not have". Rendered as a candidate's suggestion, marked as such,
 * beside the rules tier and never in place of it. No confidence figure exists and none is invented.
 */
export interface AiTriageMarkView {
  classifierVersion: string;
  /** The §3.1 reason the candidate gave, or null. Descriptive; it did not decide the tier. */
  reasonCode: string | null;
  predictedAt: string;
}

/**
 * Which triage tier a review is in. Computed by the backend from the rating and whether there is
 * anything to read — never from what the review says.
 */
export type ReviewTriageTier = "NEEDS_ATTENTION" | "WATCH" | "FYI";

/**
 * What SellerOps suggests about one review: the tier, the short reason it landed there, the issue
 * tags worth carrying, and one thing the seller might do.
 *
 * `reason` and `tags` EXPLAIN the tier; they never decided it. Body-derived material appears here
 * only as a citation, because `contracts/review-eval/naver/v1/RUBRIC.md` §5 forbids surfacing an
 * unmeasured text detector and the label seed behind it is empty. Do not add UI that re-ranks,
 * re-orders or re-colours a row from `tags` — that would be the gated thing, arriving through the
 * frontend.
 *
 * `recommendedAction` is null when there is genuinely nothing to do, and must render as nothing
 * rather than as a reassuring sentence. None of these strings ever suggests replying: Coupang gives
 * sellers no way to answer a 상품평.
 */
export interface ReviewTriageNote {
  tier: ReviewTriageTier;
  reason: string;
  tags: string[];
  recommendedAction: string | null;
}

/**
 * How the channel's WHOLE record divides, and what repeats in it.
 *
 * Always the unfiltered picture, even when the list is filtered to one tier — a summary recomputed
 * under its own filter would collapse to the option already chosen and leave the operator no way
 * back.
 *
 * `repeatedCategories` is unwindowed: it says how many of the reviews the seller HAS share a
 * category, and claims nothing about when. 기타 never appears — it is the analyzer's "fitted
 * nothing", not an issue.
 */
export interface ChannelReviewTriageSummaryView {
  /** 확인 필요 as the seller sees it: the rule's rows PLUS the pilot's additive marks. */
  needsAttention: number;
  watch: number;
  fyi: number;
  /** How many of `needsAttention` are the pilot's marks — a subset, never an addition. 0 when the pilot is off. */
  aiAttention: number;
  repeatedCategories: { category: string; count: number }[];
}

/**
 * One page of the record, plus what the last import claimed. `lastImportComplete` is load-bearing:
 * a list of reviews cannot say whether it is all of them, and an acquisition that stopped early
 * looks exactly like a channel with fewer reviews.
 */
export interface ChannelReviewPageView {
  page: number;
  size: number;
  total: number;
  newCount: number;
  lastImportAt: string | null;
  lastImportComplete: boolean;
  /**
   * RUBRIC v2 §13.7's pilot is ON for this org. When false the page renders no mark, no feedback
   * controls and records no behaviour — the screen is what it was before the pilot existed. Sent by
   * the backend, never inferred from whether marks happen to be present.
   */
  aiPilotEnabled: boolean;
  /**
   * The channel's row of `contracts/review-triage-events/v1` §1. The page renders `[쿠팡에서 보기]`
   * only for `originalLocate === "LOCATE_RUN"`, feedback controls only for `aiTriage` (and the pilot
   * on), and never a reply control it would have to invent. Sent by the backend; the UI asserts
   * nothing about a channel the server did not say.
   */
  channel: ReviewChannelCapabilityView;
  triageSummary: ChannelReviewTriageSummaryView;
  items: ChannelReviewItemView[];
}

/** One row of the contract's capability table, closed vocabularies only. */
export interface ReviewChannelCapabilityView {
  channelCode: string;
  aiTriage: boolean;
  originalLocate: "NONE" | "LOCATE_RUN";
  replySupported: boolean;
}

/**
 * The channel-side identifiers the 상세 panel prints. Nothing here names a person.
 *
 * It is deliberately NOT what `[쿠팡에서 보기]` matches a live row on. That comparison also uses a one-way
 * fingerprint of the review body, and it happens in the Local Agent — which resolves it from an opaque
 * `locateRef` against the backend, so no description of a buyer's review passes through this browser.
 */
export interface ChannelReviewLocateTarget {
  productId: string | null;
  vendorItemId: string | null;
  writtenOn: string | null;
  rating: number | null;
}

/**
 * What pressing `[쿠팡에서 보기]` returns: a single-use opaque binding to put in the Action Window
 * `START_RUN`, and the channel whose screen the run will read. No target, by design — see above.
 */
export interface ChannelReviewLocateRun {
  locateRef: string;
  channelCode: string;
}

/**
 * One review read in full. `body` is redacted (`bodyRedacted` says whether anything was replaced),
 * and there is no reply field anywhere — Coupang gives sellers no way to answer a 상품평.
 */
export interface ChannelReviewDetailView {
  id: string;
  writtenOn: string | null;
  rating: number | null;
  negative: boolean;
  body: string | null;
  bodyRedacted: boolean;
  productName: string | null;
  mediaCount: number;
  /** The buyer rated and wrote nothing — see `ChannelReviewItemView.textless`. */
  textless: boolean;
  isNew: boolean;
  /** The same note the list row carried — opening a review never changes what it said. */
  triage: ReviewTriageNote;
  /** The same pilot mark the list row carried, or null. */
  aiMark: AiTriageMarkView | null;
  locateTarget: ChannelReviewLocateTarget;
  /**
   * The reply work this review can carry, or null when the channel has no reply flow (capability
   * `replySupported = false`: Coupang, Cafe24). Server-minted (product assembly A6): `actionRef` is the
   * client-opaque address the reply endpoints take, `triageDisposition` the operator's current decision,
   * `hasReplyPreparation` whether a draft or approval already exists — the same three facts a worklist row
   * carries, so the 리뷰 detail can mount the one reply panel the product has.
   */
  replyWork: ChannelReviewReplyWork | null;
}

export interface ChannelReviewReplyWork {
  actionRef: string;
  triageDisposition: TriageDisposition | null;
  hasReplyPreparation: boolean;
}

// ── Review triage feedback — RUBRIC v2 §13.7's spine ─────────────────────────────────────────
//
// Three shapes of decreasing evidential weight. None carries free text, and none asserts what the
// seller was SHOWN — the backend computes that from its own store.

/** The seller's binary answer to the product question — 확인 필요, or not. */
export interface TriageCorrectionRequest {
  needsAttention: boolean;
  /** An optional closed-vocabulary reason, or null. */
  reasonCode: string | null;
}

export interface TriageCorrectionView {
  reviewId: string;
  needsAttention: boolean;
  reasonCode: string | null;
  /** RULES or AI — which mechanism produced the tier the seller corrected. */
  shownSource: "RULES" | "AI" | null;
}

/**
 * One explicit act — `contracts/review-triage-events/v1` §2.1–§2.2. Append-only on the backend. The
 * `REPLY_*` kinds are channel-gated server-side (NAVER's guided flow only; never Coupang) and this
 * page renders no control for them.
 */
export type TriageActionKind =
  | "ACTION_STARTED"
  | "ACTION_COMPLETED"
  | "ACTION_NOT_NEEDED"
  | "REPLY_DRAFTED"
  | "REPLY_SUBMITTED";

/**
 * Silver: what the seller did on the way (contract §2.1). Weighted at snapshot time, never a label.
 * There is deliberately no IGNORED kind — being passed over is not reported as if it were a signal.
 * `AI_ATTENTION_SHOWN` is only ever a claim here; the server writes it only where IT resolves the
 * display to AI. `ORIGINAL_OPENED` / `MARKETPLACE_LOCATED` are dropped server-side on a channel with
 * no locate surface.
 */
export type TriageBehaviorKind = "AI_ATTENTION_SHOWN" | "REVIEW_OPENED" | "ORIGINAL_OPENED" | "MARKETPLACE_LOCATED";

/** One recorded event of the review, in the contract's vocabulary. No content. */
export type TriageEventKind =
  | TriageBehaviorKind
  | TriageActionKind
  | "AI_AGREE"
  | "AI_DISAGREE"
  | "RULE_AGREE"
  | "RULE_DISAGREE";

export interface TriageEventView {
  kind: TriageEventKind;
  shownSource: "RULES" | "AI" | null;
  shownTier: ReviewTriageTier | null;
  at: string | null;
}

export interface TriageBehaviorEvent {
  reviewId: string;
  kind: TriageBehaviorKind;
}
