// Mirrors the backend DTOs (com.sellerops.*). Keep in sync with the API.

export type ChannelStatus =
  | "CONNECTED"
  | "AVAILABLE"
  | "FILE_UPLOAD_SUPPORTED"
  | "PREPARING"
  | "REQUEST_AVAILABLE";

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
