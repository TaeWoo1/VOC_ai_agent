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
  type: "INQUIRY" | "REVIEW";
  channelNameKo: string;
  productName: string;
  snippet: string;
  rating: number | null;
  status: string;
  receivedAt: string;
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
