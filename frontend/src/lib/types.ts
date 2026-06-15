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

export interface ChannelResponse {
  id: string;
  code: string;
  nameKo: string;
  status: ChannelStatus;
  dataBadges: string[];
  lastSyncedAt: string | null;
  actionLabel: string;
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
