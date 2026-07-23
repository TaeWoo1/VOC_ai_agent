// Seeded mock responses. Used when VITE_USE_MOCKS=true, and as a fallback when
// the backend is unreachable — so the UI is never blank during a demo.
import { sortBySeverity } from "./attention";
import type {
  AccountDashboardSummary,
  ArticleListResponse,
  AuthResponse,
  CapabilityView,
  ChannelCapabilityOverview,
  ChannelResponse,
  ChannelStatus,
  ChannelSupport,
  ConnectionInfoView,
  ConnectionStatusView,
  ConnectionTestResultView,
  ConnectorAlertView,
  CredentialIntakeRequest,
  CredentialTemplateView,
  DashboardSummaryResponse,
  InboxResponse,
  ItemAnalysis,
  OperatorAttentionSummary,
  OperatorVocItem,
  OperatorVocItemPage,
  OrderSummaryResponse,
  OperatorOutcomeName,
  ReviewReplyApproval,
  ReviewReplyApprovalResponse,
  ReviewReplyApprovalStateName,
  ReviewReplyDraft,
  ReviewReplyOutcome,
  ReviewReplyOutcomeResponse,
  ReviewReplyPrep,
  ReviewReplySubmissionRunResponse,
  ReviewReplySuggestion,
  SalesTrendPoint,
  ScheduleView,
  SellerAccountResponse,
  ReviewImport,
  SyncJobView,
  SyncRunView,
  TriageDecisionResponse,
  TriageDisposition,
  UserView,
} from "./types";

const MOCK_USER: UserView = {
  id: "mock-user",
  email: "demo@sellerops.ai",
  name: "데모 운영자",
  role: "OWNER",
  orgId: "mock-org",
  orgName: "데모 제조사",
};

export function mockAuth(): AuthResponse {
  return { token: "mock-token", user: MOCK_USER };
}

export function mockMe(): UserView {
  return MOCK_USER;
}

function daysAgoISO(d: number): string {
  const date = new Date();
  date.setDate(date.getDate() - d);
  return date.toISOString().slice(0, 10);
}

function hoursAgoISO(h: number): string {
  const date = new Date();
  date.setHours(date.getHours() - h);
  return date.toISOString();
}

function hoursAheadISO(h: number): string {
  const date = new Date();
  date.setHours(date.getHours() + h);
  return date.toISOString();
}

function trend(): SalesTrendPoint[] {
  const out: SalesTrendPoint[] = [];
  for (let d = 6; d >= 0; d--) {
    const orderCount = 28 + ((6 - d) * 4 + 5) % 22;
    out.push({ date: daysAgoISO(d), orderCount, salesAmount: orderCount * 13500 });
  }
  return out;
}

const CHANNELS: Array<{
  code: string;
  nameKo: string;
  status: ChannelStatus;
  dataBadges: string[];
}> = [
  { code: "COUPANG", nameKo: "쿠팡", status: "CONNECTED", dataBadges: ["문의", "리뷰", "주문", "매출", "상품"] },
  { code: "NAVER", nameKo: "네이버 스마트스토어", status: "CONNECTED", dataBadges: ["문의", "리뷰", "주문", "매출", "상품"] },
  { code: "GMARKET", nameKo: "G마켓/옥션", status: "AVAILABLE", dataBadges: ["리뷰", "주문", "매출", "상품"] },
  { code: "ELEVENST", nameKo: "11번가", status: "AVAILABLE", dataBadges: ["리뷰", "주문", "매출", "상품"] },
  { code: "LOTTEON", nameKo: "롯데온", status: "PREPARING", dataBadges: ["리뷰", "주문", "매출", "상품"] },
  { code: "SSG", nameKo: "SSG닷컴", status: "PREPARING", dataBadges: ["리뷰", "주문", "매출", "상품"] },
  { code: "OHOUSE", nameKo: "오늘의집", status: "REQUEST_AVAILABLE", dataBadges: ["리뷰", "상품"] },
  { code: "KAKAO", nameKo: "카카오톡스토어", status: "REQUEST_AVAILABLE", dataBadges: ["문의", "리뷰", "주문", "상품"] },
  { code: "CAFE24", nameKo: "카페24 자사몰", status: "AVAILABLE", dataBadges: ["주문", "매출", "상품"] },
  { code: "MAKESHOP", nameKo: "메이크샵", status: "REQUEST_AVAILABLE", dataBadges: ["주문", "매출", "상품"] },
  { code: "IMWEB", nameKo: "아임웹", status: "REQUEST_AVAILABLE", dataBadges: ["주문", "매출", "상품"] },
  { code: "CUSTOM", nameKo: "자사몰/기타", status: "FILE_UPLOAD_SUPPORTED", dataBadges: ["문의", "리뷰", "주문", "매출", "상품"] },
  { code: "FILE_UPLOAD", nameKo: "파일 업로드 채널", status: "FILE_UPLOAD_SUPPORTED", dataBadges: ["문의", "리뷰"] },
];

function actionLabel(status: ChannelStatus): string {
  switch (status) {
    case "CONNECTED":
      return "관리";
    case "AVAILABLE":
      return "연결하기";
    case "FILE_UPLOAD_SUPPORTED":
      return "파일 업로드";
    case "PREPARING":
      return "준비 중";
    case "REQUEST_AVAILABLE":
      return "요청하기";
    case "PENDING":
      return "연결 중";
    case "RECONNECT_REQUIRED":
      return "재연결 필요";
  }
}

// Channels with a backend credential template (→ "연결 정보 저장 가능").
const TEMPLATED_CHANNELS = new Set(["NAVER", "COUPANG", "CAFE24", "ELEVENST", "GMARKET", "SSG"]);

// Honest, internally-consistent support facts mirroring the backend's flag-aware contract.
// NAVER is the only channel shown as auto-collecting (order) + connection-checkable, matching
// the existing NAVER-connected demo (mockTestConnection returns SUCCESS only for NAVER).
function mockSupport(code: string): ChannelSupport {
  const fileUploadSupported = code !== "FILE_UPLOAD";
  const autoCollect = code === "NAVER";
  return {
    fileUploadSupported,
    fileUploadDataTypes: fileUploadSupported ? ["리뷰", "문의", "주문"] : [],
    autoCollectSupported: autoCollect,
    autoCollectDataTypes: autoCollect ? ["주문"] : [],
    connectionCheckSupported: autoCollect,
    credentialSetupSupported: TEMPLATED_CHANNELS.has(code),
  };
}

export function mockChannels(): ChannelResponse[] {
  return CHANNELS.map((c, i) => ({
    id: `mock-channel-${i}`,
    code: c.code,
    nameKo: c.nameKo,
    status: c.status,
    dataBadges: c.dataBadges,
    lastSyncedAt: c.status === "CONNECTED" ? hoursAgoISO(i + 1) : null,
    actionLabel: actionLabel(c.status),
    support: mockSupport(c.code),
  }));
}

export function mockSellerAccounts(): SellerAccountResponse[] {
  return mockChannels()
    .filter((c) => c.status === "CONNECTED")
    .map((c) => ({
      id: `mock-acct-${c.id}`,
      channelId: c.id,
      channelNameKo: c.nameKo,
      alias: c.nameKo,
      connectionStatus: "CONNECTED",
      lastSyncedAt: c.lastSyncedAt,
      fileUpload: false,
    }));
}

export function mockDashboard(): DashboardSummaryResponse {
  const t = trend();
  const todayOrders = t[t.length - 1].orderCount;
  return {
    cards: {
      todayOrders,
      todaySales: todayOrders * 13500,
      newInquiries: 4,
      unansweredInquiries: 6,
      newReviews: 7,
      negativeReviews: 11,
      urgentCount: 17,
      unhandledCount: 6,
    },
    todoItems: ["미답변 문의 6건을 확인하세요.", "부정 리뷰 11건을 확인하세요."],
    topProductIssues: [
      { productName: "선바로 광폭 케이블 몰딩", issueLabel: "부정 리뷰", count: 5 },
      { productName: "전선몰딩 1호 (백색)", issueLabel: "부정 리뷰", count: 3 },
      { productName: "코너 마감 몰딩 세트", issueLabel: "부정 리뷰", count: 2 },
    ],
    recentFeed: mockInbox().items.slice(0, 8),
    salesTrend: t,
    channelSalesShare: [
      { channelNameKo: "쿠팡", salesAmount: 2_400_000, percent: 58 },
      { channelNameKo: "네이버 스마트스토어", salesAmount: 1_300_000, percent: 31 },
      { channelNameKo: "G마켓/옥션", salesAmount: 450_000, percent: 11 },
    ],
  };
}

export function mockInbox(): InboxResponse {
  const items: InboxResponse["items"] = [
    { id: "mock-inq-1", type: "INQUIRY", channelNameKo: "쿠팡", productName: "선바로 광폭 케이블 몰딩", snippet: "이 제품 폭이 몇 mm인가요? 굵은 전선도 들어가나요?", rating: null, status: "UNANSWERED", receivedAt: hoursAgoISO(2) },
    { id: "mock-rev-1", type: "REVIEW", channelNameKo: "네이버 스마트스토어", productName: "전선몰딩 1호 (백색)", snippet: "부착 후 며칠 지나니 접착력이 약해서 떨어졌어요.", rating: 1, status: "NEGATIVE", receivedAt: hoursAgoISO(5) },
    { id: "mock-inq-2", type: "INQUIRY", channelNameKo: "쿠팡", productName: "코너 마감 몰딩 세트", snippet: "곡면 벽에도 시공 가능한가요?", rating: null, status: "UNANSWERED", receivedAt: hoursAgoISO(9) },
    { id: "mock-rev-2", type: "REVIEW", channelNameKo: "쿠팡", productName: "선바로 광폭 케이블 몰딩", snippet: "설치가 생각보다 쉬웠어요. 깔끔하게 정리됩니다.", rating: 5, status: "NORMAL", receivedAt: hoursAgoISO(14) },
    { id: "mock-rev-3", type: "REVIEW", channelNameKo: "네이버 스마트스토어", productName: "바닥용 평면 몰딩", snippet: "재단하다가 모서리가 깨졌습니다. 잘 부서지네요.", rating: 2, status: "NEGATIVE", receivedAt: hoursAgoISO(20) },
    { id: "mock-inq-3", type: "INQUIRY", channelNameKo: "네이버 스마트스토어", productName: "양면테이프 보강 몰딩", snippet: "추가 양면테이프는 따로 사야 하나요?", rating: null, status: "ANSWERED", receivedAt: hoursAgoISO(26) },
    { id: "mock-rev-4", type: "REVIEW", channelNameKo: "쿠팡", productName: "전선몰딩 2호 (아이보리)", snippet: "색상이 벽지랑 잘 어울려서 만족합니다.", rating: 4, status: "NORMAL", receivedAt: hoursAgoISO(32) },
    { id: "mock-rev-5", type: "REVIEW", channelNameKo: "네이버 스마트스토어", productName: "선바로 광폭 케이블 몰딩", snippet: "사진이랑 색이 조금 달라요. 실물이 더 누런 느낌입니다.", rating: 2, status: "NEGATIVE", receivedAt: hoursAgoISO(40) },
  ];
  return { items, total: items.length };
}

// Stored rule-based analyses for a SUBSET of the inbox mocks — so demo mode shows
// both cards with an analysis area and cards without one. Provenance is honest:
// RULE_BASED / rule-based / rules-v1, no model/prompt fields. Summaries are the
// PII-safe templated phrases the backend analyzer produces.
export function mockItemAnalysis(): ItemAnalysis[] {
  const analyzer = { analyzerKind: "RULE_BASED", analyzerName: "rule-based", analyzerVersion: "rules-v1" };
  return [
    { sourceType: "INQUIRY", sourceId: "mock-inq-1", summary: "제품정보 관련 문의", category: "제품정보", sentiment: "NEUTRAL", urgency: "NORMAL", recommendedAction: "답변 필요", createdAt: hoursAgoISO(1), ...analyzer },
    { sourceType: "REVIEW", sourceId: "mock-rev-1", summary: "품질 관련 부정 리뷰", category: "품질", sentiment: "NEGATIVE", urgency: "HIGH", recommendedAction: "상세페이지 개선 후보", createdAt: hoursAgoISO(4), ...analyzer },
    { sourceType: "REVIEW", sourceId: "mock-rev-2", summary: "설치 관련 긍정 리뷰", category: "설치", sentiment: "POSITIVE", urgency: "LOW", recommendedAction: "확인 필요", createdAt: hoursAgoISO(13), ...analyzer },
    { sourceType: "REVIEW", sourceId: "mock-rev-3", summary: "품질 관련 부정 리뷰", category: "품질", sentiment: "NEGATIVE", urgency: "HIGH", recommendedAction: "상세페이지 개선 후보", createdAt: hoursAgoISO(19), ...analyzer },
    { sourceType: "REVIEW", sourceId: "mock-rev-5", summary: "색상 관련 부정 리뷰", category: "색상", sentiment: "NEGATIVE", urgency: "HIGH", recommendedAction: "확인 필요", createdAt: hoursAgoISO(39), ...analyzer },
  ];
}

export function mockOrders(): OrderSummaryResponse {
  const t = trend();
  return {
    totalOrders7d: t.reduce((s, p) => s + p.orderCount, 0),
    totalSales7d: t.reduce((s, p) => s + p.salesAmount, 0),
    trend: t,
    channelShare: mockDashboard().channelSalesShare,
  };
}

export function mockSchedules(): ScheduleView[] {
  return [
    {
      id: "mock-schedule-1",
      dataType: "INQUIRY",
      cadenceKind: "INTERVAL",
      intervalMinutes: 360,
      enabled: true,
      nextRunAt: hoursAheadISO(2),
      lastRunAt: hoursAgoISO(4),
      pausedReason: null,
    },
  ];
}

export function mockConnectionStatus(accountId?: string): ConnectionStatusView {
  // Account-aware demo (mock mode only): the first connected account
  // (mock-channel-0 = 쿠팡) shows a failing/expired connection so the /channels
  // overview demonstrates both a healthy and a degraded row; everything else is
  // healthy. Real mode never uses this — it hits the live connection-status API.
  const failing = accountId != null && accountId.endsWith("channel-0");
  if (failing) {
    return {
      sellerAccountId: accountId,
      state: "EXPIRED",
      lastSuccessAt: hoursAgoISO(30),
      consecutiveFailures: 3,
      lastError: "인증 토큰이 만료되었습니다. 재연결이 필요합니다.",
      lastSyncedAt: hoursAgoISO(30),
      nextScheduledAt: null,
    };
  }
  return {
    sellerAccountId: accountId ?? "mock-acct",
    state: "CONNECTED",
    lastSuccessAt: hoursAgoISO(4),
    consecutiveFailures: 0,
    lastError: null,
    lastSyncedAt: hoursAgoISO(4),
    nextScheduledAt: hoursAheadISO(2),
  };
}

// Mock-mode optimistic store: when the secret-entry form saves in demo mode there
// is no backend, so we record a MASKED ConnectionInfoView (never the typed
// secrets) keyed by accountId. mockConnectionInfo consults this first, so a save →
// reload reflects the entered connection instead of falling back to the static
// seed (and a re-entry overwrites it). Module-level on purpose: it must survive
// across the form's save and the subsequent strict re-read.
const savedCredentials = new Map<string, ConnectionInfoView>();

export function mockStoreCredential(accountId: string, request: CredentialIntakeRequest): void {
  // Mirror the real masked response: derived connectorClass/authType, freshly
  // rotated, no expiry. The typed secret values in `request.secrets` are never
  // persisted here.
  savedCredentials.set(accountId, {
    connectorClass: request.connectorClass,
    authType: request.authType,
    tokenExpiresAt: null,
    lastRotatedAt: new Date().toISOString(),
    hasRefreshToken: false,
  });
}

/**
 * The demo channel behind an account id (`mock-acct-mock-channel-{i}`), or null if it
 * cannot be derived.
 *
 * ONE place decides what channel an account is on. Every account-keyed mock reads this, so
 * they cannot disagree — which they did: the attention pane resolved the account while the
 * dashboard beside it hardcoded NAVER, so the 쿠팡 account rendered a NAVER dashboard next
 * to a 쿠팡 attention pane. A SellerAccount is bound to one channelId; anything that
 * answers per-account has to answer from the same mapping.
 */
function mockChannelForAccount(
  accountId?: string,
): { id: string; code: string; nameKo: string } | null {
  if (accountId == null) {
    return null;
  }
  const match = accountId.match(/mock-channel-(\d+)$/);
  if (match == null) {
    return null;
  }
  const channel = CHANNELS[Number(match[1])];
  return channel == null
    ? null
    : { id: `mock-channel-${match[1]}`, code: channel.code, nameKo: channel.nameKo };
}

// The channel code behind a demo account id, or null if it can't be derived — used to keep
// the demo test-connection honest.
function mockChannelCodeForAccount(accountId?: string): string | null {
  return mockChannelForAccount(accountId)?.code ?? null;
}

// Demo test-connection. Mirrors the real backend's truth per channel so the demo
// never teaches that an unsupported channel is verified: only NAVER has a real
// auth verifier, so only the NAVER demo account returns SUCCESS; every other
// channel returns UNSUPPORTED. Safe DTO shape only — no token/secret/provider
// body ever appears here or in the real response.
export function mockTestConnection(accountId: string): ConnectionTestResultView {
  const checkedAt = new Date().toISOString();
  if (mockChannelCodeForAccount(accountId) === "NAVER") {
    return {
      sellerAccountId: accountId,
      status: "SUCCESS",
      checkedAt,
      message: "연결 정보가 확인되었습니다.",
      reasonCode: null,
    };
  }
  return {
    sellerAccountId: accountId,
    status: "UNSUPPORTED",
    checkedAt,
    message: "이 채널의 연결 확인은 아직 제공되지 않습니다.",
    reasonCode: "VERIFY_NOT_IMPLEMENTED",
  };
}

export function mockConnectionInfo(accountId?: string): ConnectionInfoView {
  // A demo-mode save wins over the seeded view, so the masked detail reflects it.
  if (accountId != null) {
    const saved = savedCredentials.get(accountId);
    if (saved) {
      return saved;
    }
  }
  // Account-aware demo (mock mode only), consistent with mockConnectionStatus:
  // the failing 쿠팡 account (mock-channel-0) has connection info on file but an
  // expired token (재등록 필요); every other account has valid, non-expiring info.
  // Masked metadata only — no secret is ever present here or in the real response.
  const expired = accountId != null && accountId.endsWith("channel-0");
  if (expired) {
    return {
      connectorClass: "API",
      authType: "API_KEY",
      tokenExpiresAt: hoursAgoISO(30),
      lastRotatedAt: hoursAgoISO(72),
      hasRefreshToken: false,
    };
  }
  return {
    connectorClass: "API",
    authType: "API_KEY",
    tokenExpiresAt: null,
    lastRotatedAt: hoursAgoISO(72),
    hasRefreshToken: false,
  };
}

// Credential-field shape per channel, copied verbatim from the backend source of
// truth (com.sellerops.credential.CredentialTemplates). Metadata only — never a
// value. null mirrors the endpoint's 404 for channels with no API template
// (file-upload / not-yet-integrated), so mock mode reproduces the real contract.
const MOCK_CREDENTIAL_TEMPLATES: Record<string, CredentialTemplateView> = {
  NAVER: {
    channelCode: "NAVER",
    connectorClass: "API",
    authType: "API_KEY",
    fields: [
      {
        key: "client_id",
        label: "애플리케이션 ID",
        required: true,
        secret: false,
        helpText: "네이버 커머스 API 센터에서 발급한 애플리케이션 ID입니다.",
      },
      {
        key: "client_secret",
        label: "애플리케이션 시크릿",
        required: true,
        secret: true,
        helpText: "애플리케이션 ID와 함께 발급되는 시크릿 키입니다.",
      },
    ],
    notes: "네이버 커머스 API 센터에서 발급한 애플리케이션 키로 연결합니다.",
  },
  COUPANG: {
    channelCode: "COUPANG",
    connectorClass: "API",
    authType: "HMAC",
    fields: [
      {
        key: "access_key",
        label: "액세스 키",
        required: true,
        secret: true,
        helpText: "쿠팡 윙 OPEN API에서 발급한 액세스 키입니다.",
      },
      {
        key: "secret_key",
        label: "시크릿 키",
        required: true,
        secret: true,
        helpText: "액세스 키와 함께 발급되는 시크릿 키입니다.",
      },
      {
        key: "vendor_id",
        label: "판매자(벤더) ID",
        required: true,
        secret: false,
        helpText: "쿠팡 윙에서 확인할 수 있는 판매자 코드입니다.",
      },
    ],
    notes: "쿠팡 윙(판매자센터) OPEN API에서 발급한 API 인증 키로 연결합니다.",
  },
  CAFE24: {
    channelCode: "CAFE24",
    connectorClass: "API",
    authType: "OAUTH2",
    fields: [
      {
        key: "mall_id",
        label: "몰 ID",
        required: true,
        secret: false,
        helpText: "카페24 자사몰의 상점 아이디입니다.",
      },
      {
        key: "client_id",
        label: "앱 클라이언트 ID",
        required: true,
        secret: false,
        helpText: "카페24 개발자센터 앱의 클라이언트 ID입니다.",
      },
      {
        key: "client_secret",
        label: "앱 클라이언트 시크릿",
        required: true,
        secret: true,
        helpText: "앱 클라이언트 ID와 함께 발급되는 시크릿 키입니다.",
      },
      {
        key: "refresh_token",
        label: "리프레시 토큰",
        required: true,
        secret: true,
        helpText: "앱 연동(OAuth) 과정에서 발급된 리프레시 토큰입니다.",
      },
    ],
    notes: "카페24 자사몰 관리자에서 앱 연동(OAuth)으로 연결합니다.",
  },
  ELEVENST: {
    channelCode: "ELEVENST",
    connectorClass: "API",
    authType: "API_KEY",
    fields: [
      {
        key: "openapikey",
        label: "오픈 API 키",
        required: true,
        secret: true,
        helpText: "11번가 셀러오피스에서 발급한 오픈 API 키입니다.",
      },
    ],
    notes: "11번가 셀러오피스에서 발급한 오픈 API 키로 연결합니다.",
  },
  GMARKET: {
    channelCode: "GMARKET",
    connectorClass: "API",
    authType: "JWT_HS256",
    fields: [
      {
        key: "master_id",
        label: "마스터 ID",
        required: true,
        secret: false,
        helpText: "ESM 판매자센터의 마스터 계정 ID입니다.",
      },
      {
        key: "secret_key",
        label: "시크릿 키",
        required: true,
        secret: true,
        helpText: "ESM에서 발급한 API 시크릿 키입니다.",
      },
      {
        key: "issuer",
        label: "발급 도메인(issuer)",
        required: true,
        secret: false,
        helpText: "API 키 발급 시 등록한 서비스 도메인입니다.",
      },
      {
        key: "gmarket_seller_id",
        label: "G마켓 판매자 ID",
        required: true,
        secret: false,
        helpText: "G마켓 판매자 계정 ID입니다.",
      },
      {
        key: "auction_seller_id",
        label: "옥션 판매자 ID",
        required: false,
        secret: false,
        helpText: "옥션도 함께 수집할 때만 입력합니다.",
      },
    ],
    notes: "ESM 판매자센터에서 발급한 API 인증 정보로 연결합니다. (G마켓·옥션 공통)",
  },
  SSG: {
    channelCode: "SSG",
    connectorClass: "API",
    authType: "API_KEY",
    fields: [
      {
        key: "auth_key",
        label: "업체 인증키",
        required: true,
        secret: true,
        helpText: "SSG 파트너에서 발급한 업체 인증키입니다.",
      },
    ],
    notes: "SSG 파트너에서 발급한 API 인증키로 연결합니다.",
  },
};

export function mockCredentialTemplate(channelCode?: string): CredentialTemplateView | null {
  if (!channelCode) {
    return null;
  }
  return MOCK_CREDENTIAL_TEMPLATES[channelCode] ?? null;
}

export function mockConnectorAlerts(): ConnectorAlertView[] {
  // Mock mode only: tie alerts to the failing 쿠팡 account (mock-acct-mock-channel-0)
  // so the /alerts page demonstrates a realistic 재연결 필요 + 수집 지연 state,
  // consistent with the failing row in mockConnectionStatus. Real mode never uses
  // this — it reads the recorded connector_alerts via the live API. All open
  // (acknowledgedAt: null); acknowledgement is a future slice.
  return [
    {
      id: "mock-alert-1",
      sellerAccountId: "mock-acct-mock-channel-0",
      channelId: "mock-channel-0",
      channelNameKo: "쿠팡",
      accountAlias: "쿠팡 본계정",
      type: "AUTH_EXPIRED",
      severity: "WARNING",
      message: "인증 토큰이 만료되어 자동 수집이 중단되었습니다. 채널에서 재연결해 주세요.",
      createdAt: hoursAgoISO(30),
      acknowledgedAt: null,
    },
    {
      id: "mock-alert-2",
      sellerAccountId: "mock-acct-mock-channel-0",
      channelId: "mock-channel-0",
      channelNameKo: "쿠팡",
      accountAlias: "쿠팡 본계정",
      type: "RATE_LIMITED",
      severity: "WARNING",
      message: "채널 속도 제한으로 수집이 지연되고 있습니다. 잠시 후 예약된 시각에 자동으로 다시 시도합니다.",
      createdAt: hoursAgoISO(6),
      acknowledgedAt: null,
    },
  ];
}

export function mockCapabilities(): CapabilityView[] {
  return [];
}

// Demo capability overview: a confirmed Cafe24-style channel. Other codes get a
// generic "auto-collect supported, no documented exclusions" shape.
export function mockCapabilityOverview(channelCode: string): ChannelCapabilityOverview {
  const confirmed = (dataType: string, label: string) => ({
    dataType,
    label,
    supported: true,
    verificationStatus: "CONFIRMED",
  });
  if (channelCode === "CAFE24") {
    return {
      channelCode,
      channelNameKo: "카페24",
      connectorClass: "API",
      autoCollectSupported: true,
      dataTypes: [
        confirmed("ORDER_SUMMARY", "주문·매출"),
        confirmed("REVIEW", "리뷰"),
        confirmed("INQUIRY", "문의"),
      ],
      unsupportedScopes: [
        { code: "BOARD_9", label: "1:1 맞춤상담(게시판 9) 미수집" },
        { code: "COMMENTS", label: "게시글 댓글 미수집" },
        { code: "COMMUNITY_WRITE", label: "게시판 글쓰기 미지원" },
        { code: "AUTO_REPLY", label: "자동 답변 등록 미지원" },
      ],
    };
  }
  return {
    channelCode,
    channelNameKo: null,
    connectorClass: "API",
    autoCollectSupported: true,
    dataTypes: [
      confirmed("ORDER_SUMMARY", "주문·매출"),
      confirmed("REVIEW", "리뷰"),
      confirmed("INQUIRY", "문의"),
    ],
    unsupportedScopes: [],
  };
}

export function mockAccountDashboard(
  accountId: string,
  range: { from: string; to: string },
): AccountDashboardSummary {
  // The channel comes from the ACCOUNT, via the same helper the attention pane uses.
  // ChannelDetail renders this card and that pane side by side for one accountId, and a
  // SellerAccount is bound to a single channelId — so the two cannot answer with different
  // channels. This used to hardcode NAVER for every account, which put a NAVER dashboard
  // beside the 쿠팡 account's (correct) 쿠팡 attention pane. Invisible, because neither
  // component renders the channel — which is exactly why it drifted.
  const channel = mockChannelForAccount(accountId);
  //
  // ALL THREE VOC COUNTS ARE ZERO, and that is the honest number, not a placeholder.
  // ChannelOperationsService computes them from the Cafe24 community-article store, which
  // only Cafe24ApiConnector writes; NAVER reviews arrive by file upload into `reviews` and
  // never land there. So for a real NAVER account this card genuinely has nothing to show —
  // and for 쿠팡, which has no VOC store at all, likewise.
  //
  // Do NOT be tempted to mirror the attention pane's 12 here to make the page look
  // coherent: the two numbers come from different stores, and matching them would fake a
  // relationship the backend does not have. Order/sales stay populated — they come from
  // order summaries, which these channels do fill.
  return {
    sellerAccountId: accountId,
    // channelId is non-nullable on this DTO, so an account this mock cannot resolve gets
    // the id echoed back rather than a fabricated channel — wrong-shaped input in, honest
    // "I don't know" out, never a default that silently claims a channel.
    channelId: channel?.id ?? accountId,
    channelNameKo: channel?.nameKo ?? null,
    fromDate: range.from,
    toDate: range.to,
    salesAmount: 1_284_000,
    orderCount: 37,
    newReviews: 0,
    newInquiries: 0,
    unansweredInquiries: 0,
    lastSyncState: "CONNECTED",
    lastSuccessAt: hoursAgoISO(2),
  };
}

/**
 * The collected-article list for the demo account — EMPTY, for both types.
 *
 * Same reason as the dashboard's zero VOC counts: this list pages the Cafe24
 * community-article store, which only Cafe24ApiConnector writes. The demo account is NAVER,
 * whose reviews arrive by file upload into `reviews` and never appear here. So an empty
 * list is what a real NAVER account returns.
 *
 * This used to serve 12 reviews and 8 inquiries — 4 of them 미답변 — and re-labelling them
 * 네이버 스마트스토어 made it worse, not better: the page then showed NAVER inquiries beside
 * a dashboard reporting zero of them and an attention pane that can never raise one. The
 * cost of the truth is two empty panes; the cost of the lie was a demo contradicting itself
 * on one screen.
 */
export function mockAccountArticles(
  type: string,
  page: number,
  size: number,
): ArticleListResponse {
  return { type, page, size, total: 0, items: [] };
}

// ── The demo account's reviews ────────────────────────────────────────────────
//
// ONE population, filtered per lens. Every attention count and every drill-down row below
// is derived from this array, so they cannot disagree: a card claiming 2건 and a drill-down
// showing 4 rows is not a number to fix, it is an arithmetic impossibility.
//
// That was not true before. The counts were hand-written and the rows were generated by a
// per-lens formula (`1 + (n % 3)`), so the 1~2점 card said 2건 while its drill-down showed
// 4 low-rating rows, and NEW_REVIEW's rows implied 8 reviews at 1~3점 where LOW_RATING's
// implied 6 — two lenses disagreeing about the same window of the same store. Three
// separate patches would have made those three numbers agree by coincidence; deriving them
// makes them agree by construction.

/** One review in the demo account's window. `id` is its identity across every lens. */
interface MockNaverReview {
  id: number;
  rating: number;
  productName: string | null;
  safePreview: string | null;
  sourceCreatedDate: string;
  /**
   * What the reply surface's `redactedBody` would be — the WHOLE body, tokenized, not the
   * 60-char `safePreview` beside it.
   *
   * Stated as a fixture value rather than computed, deliberately. The mock does NOT
   * reimplement `VocPreviewSanitizer`: that would make the client a second implementation
   * of a redaction rule, free to disagree with the server about what is sensitive, in a
   * demo whose whole subject is text an operator is about to paste in public. So each row
   * records what the server would have returned for its body, and nothing here decides it.
   *
   * Null only when the source was blank — never as a stand-in for "suppressed", which is a
   * preview concept the full-body path does not have.
   */
  redactedBody: string | null;
  /** Whether the server tokenized anything — drives the "일부 정보가 가려졌습니다" note. */
  bodyRedacted: boolean;
}

/**
 * 12 reviews: 2 rated 1~2, 4 rated 3, 6 rated 4~5.
 *
 * The split is the fixture's whole contract — it is what makes the HIGH card 2건, the
 * MEDIUM card 4건, the LOW_RATING drill-down 6 (their union), and NEW_REVIEW 12.
 *
 * Product names are display values only, never a SKU/상품번호. One null product and one
 * null preview, deliberately on DIFFERENT rows (id 4 vs id 7), so the demo exercises each
 * placeholder without implying the two absences travel together.
 */
const NAVER_REVIEWS: readonly MockNaverReview[] = [
  // 2 rated 1~2 → the HIGH "낮은 평점(1~2점) 리뷰" card
  // id 0 carries a redacted span so the demo exercises the "일부 정보가 가려졌습니다" note —
  // and shows why the preview and the full body are different reads: the preview's 60 chars
  // stop before the tokenized part.
  { id: 0, rating: 1, productName: "베이직 코튼 티셔츠 화이트", safePreview: "부착 후 며칠 만에 떨어졌어요", sourceCreatedDate: "2026-05-28",
    redactedBody: "부착 후 며칠 만에 떨어졌어요. 세탁도 안 했는데 프린트가 통째로 일어났습니다.\n교환이나 환불 가능한지 알려주세요. [전화번호] 로 연락 주시면 감사하겠습니다.", bodyRedacted: true },
  { id: 1, rating: 2, productName: "가을 니트 가디건 CHARCOAL", safePreview: "배송은 빨랐는데 색이 생각과 달라요", sourceCreatedDate: "2026-05-27",
    redactedBody: "배송은 빨랐는데 색이 생각과 달라요.\n상세페이지 사진은 차콜인데 실물은 거의 검정에 가깝습니다.", bodyRedacted: false },
  // 4 rated 3 → the MEDIUM "보통 평점(3점) 리뷰" card
  { id: 2, rating: 3, productName: "리넨 와이드 팬츠 M", safePreview: "무난합니다 가격 대비 그럭저럭", sourceCreatedDate: "2026-05-26",
    redactedBody: "무난합니다. 가격 대비 그럭저럭이에요.\n다만 여름에 입기엔 조금 두껍습니다.", bodyRedacted: false },
  { id: 3, rating: 3, productName: "베이직 코튼 티셔츠 화이트", safePreview: "사이즈가 조금 큰 편이에요", sourceCreatedDate: "2026-05-25",
    redactedBody: "사이즈가 조금 큰 편이에요. 평소 M 입는데 한 치수 작게 시켰어야 했나 싶습니다.", bodyRedacted: false },
  { id: 4, rating: 3, productName: null, safePreview: "재구매 의사는 반반입니다", sourceCreatedDate: "2026-05-24",
    redactedBody: "재구매 의사는 반반입니다. 품질은 괜찮은데 배송이 예상보다 늦었어요.", bodyRedacted: false },
  { id: 5, rating: 3, productName: "가을 니트 가디건 CHARCOAL", safePreview: "보통이에요 특별한 점은 없네요", sourceCreatedDate: "2026-05-23",
    redactedBody: "보통이에요. 특별한 점은 없네요.", bodyRedacted: false },
  // 6 rated 4~5 → in NEW_REVIEW / spike only; never in the 1~3점 union
  { id: 6, rating: 4, productName: "리넨 와이드 팬츠 M", safePreview: "포장이 꼼꼼했어요 다음에 또 살게요", sourceCreatedDate: "2026-05-22",
    redactedBody: "포장이 꼼꼼했어요. 다음에 또 살게요.", bodyRedacted: false },
  // id 7: preview suppressed, body present. The two nulls are NOT the same fact — a
  // suppressed preview is a display judgement about 60 characters, and the reply surface
  // still has a complaint to answer.
  { id: 7, rating: 5, productName: "베이직 코튼 티셔츠 화이트", safePreview: null, sourceCreatedDate: "2026-05-21",
    redactedBody: "[번호] [번호] 굿", bodyRedacted: true },
  { id: 8, rating: 4, productName: "가을 니트 가디건 CHARCOAL", safePreview: "핏이 예쁩니다", sourceCreatedDate: "2026-05-20",
    redactedBody: "핏이 예쁩니다. 배송도 빨랐어요.", bodyRedacted: false },
  { id: 9, rating: 5, productName: "리넨 와이드 팬츠 M", safePreview: "아주 만족스러워요", sourceCreatedDate: "2026-05-19",
    redactedBody: "아주 만족스러워요. 재질도 좋고 핏도 잘 맞습니다.", bodyRedacted: false },
  { id: 10, rating: 4, productName: "베이직 코튼 티셔츠 화이트", safePreview: "무난하게 잘 입고 있어요", sourceCreatedDate: "2026-05-18",
    redactedBody: "무난하게 잘 입고 있어요.", bodyRedacted: false },
  { id: 11, rating: 5, productName: "가을 니트 가디건 CHARCOAL", safePreview: "따뜻하고 가볍습니다", sourceCreatedDate: "2026-05-17",
    redactedBody: "따뜻하고 가볍습니다. 겨울에도 입을 수 있을 것 같아요.", bodyRedacted: false },
];

/** Reviews in the prior equal-length window — the spike rule's baseline. */
const NAVER_PREVIOUS_REVIEW_COUNT = 5;

const lowRatingReviews = NAVER_REVIEWS.filter((r) => r.rating <= 2);
const midRatingReviews = NAVER_REVIEWS.filter((r) => r.rating === 3);

/**
 * The reviews behind one lens, or null when the lens is not this store's to answer.
 *
 * Mirrors AttentionItemFilters exactly:
 *   LOW_RATING_REVIEW          → (REVIEW, 1..3)      both cards share the type and drill the union
 *   NEW_REVIEW / spike         → (REVIEW, no bounds) every review in the window
 *   anything inquiry-shaped    → not this store's    (see the null branch's caller)
 */
function reviewsForLens(type: string): readonly MockNaverReview[] | null {
  switch (type) {
    case "LOW_RATING_REVIEW":
      return NAVER_REVIEWS.filter((r) => r.rating >= 1 && r.rating <= 3);
    case "NEW_REVIEW":
    case "RECENT_REVIEW_SPIKE_CANDIDATE":
      return NAVER_REVIEWS;
    default:
      return null;
  }
}

/**
 * A review's address — keyed on the REVIEW, not the lens it was found through.
 *
 * Load-bearing: product scope §5 makes it a requirement that a decision belongs to the
 * review, so "어느 카드로 들어와도 같은 상태를 본다". The ref used to embed the signal type,
 * which gave one review two addresses and made that invariant undemonstrable in the demo —
 * deciding under 낮은 평점 and re-opening under 신규 리뷰 showed nothing.
 */
function naverReviewRef(id: number): string {
  return `review:mock-voc-${id}`;
}

/** Seeded so the demo opens with one decided row beside undecided ones. */
const SEEDED_TRIAGE_REVIEW_ID = 0;

/** The channel display name behind a demo account id, or null if it cannot be derived. */
function mockChannelNameForAccount(accountId: string): string | null {
  return mockChannelForAccount(accountId)?.nameKo ?? null;
}

export function mockAccountAttention(
  accountId: string,
  range: { from: string; to: string },
): OperatorAttentionSummary {
  // The channel comes from the ACCOUNT, not from a constant. The demo has two CONNECTED
  // accounts (쿠팡 and 네이버), and this used to hardcode NAVER for both — so opening the
  // 쿠팡 account showed a 쿠팡 header above a 네이버 스마트스토어 attention pane, which is the
  // exact "one account, one channel" contradiction the comment below warns about, one level
  // up.
  const channelName = mockChannelNameForAccount(accountId);
  if (mockChannelCodeForAccount(accountId) !== "NAVER") {
    // Unsupported channel → VocItemSourceRegistry resolves no source → EMPTY_SNAPSHOT →
    // AttentionSignalRules gates every signal on `> 0` → no signals at all. The channel name
    // is still reported (the service reads it before the source lookup), so this is an
    // honest empty state and not a null pane. COUPANG has no VocItemSource; only NAVER and
    // CAFE24 do, and Cafe24's demo account is not CONNECTED.
    return {
      sellerAccountId: accountId,
      channel: channelName,
      fromDate: range.from,
      toDate: range.to,
      items: [],
    };
  }
  // One account, one channel: NAVER. A SellerAccount is bound to a single channelId, so a
  // summary claiming one channel over rows claiming another describes an account that
  // cannot exist.
  //
  // REVIEW SIGNALS ONLY, and that is not a shortcut — it is what NAVER can actually raise.
  // NAVER's attention source is IngestedReviewVocItemSource (its channel allow-list is
  // NAVER alone), that store holds reviews and nothing else, and it passes a literal 0 for
  // every inquiry count into the snapshot. AttentionSignalRules gates each inquiry signal on
  // `> 0`, so UNANSWERED_INQUIRY / NEW_INQUIRY / UNKNOWN_REPLY_STATUS /
  // RECENT_INQUIRY_SPIKE_CANDIDATE can never fire for a NAVER account. This fixture used to
  // show three of them; they were rows the product cannot produce.
  //
  // The cost is a thinner demo — four cards instead of five, no inquiry lane. That is the
  // honest trade: a Cafe24 account would demo the inquiry side but has no triage anchor at
  // all, so it would show none of what this surface is now for.
  // Resolved from the account above, not typed in — same string the catalog holds.
  const channel = channelName;
  // Every count below is COUNTED from NAVER_REVIEWS, never typed in. The rules do the same
  // (each `count` is the snapshot field the signal was gated on), so a card can no longer
  // disagree with the rows behind it.
  const current = NAVER_REVIEWS.length;
  const previous = NAVER_PREVIOUS_REVIEW_COUNT;
  return {
    sellerAccountId: accountId,
    channel,
    fromDate: range.from,
    toDate: range.to,
    // Sorted by the same severity rank the backend applies, rather than hand-ordered: the
    // rules emit in gate order and then stable-sort HIGH→LOW, so the wire order is
    // HIGH(1~2점) → MEDIUM(3점) → MEDIUM(spike) → LOW(신규 리뷰) — the spike is emitted last
    // but outranks 신규 리뷰. Listing them below in emission order and sorting here keeps the
    // mock honest without asking anyone to hold that interleaving in their head.
    items: sortBySeverity([
      {
        // Two cards, ONE type — matching the rules, which emit LOW_RATING_REVIEW at HIGH
        // for 1~2점 and again at MEDIUM for 3점. Both drill to the combined 1~3점 set, so
        // the drill-down total (their union) deliberately exceeds either card's count.
        type: "LOW_RATING_REVIEW",
        severity: "HIGH",
        count: lowRatingReviews.length,
        label: "낮은 평점(1~2점) 리뷰",
        description: "불만족 리뷰입니다. 내용을 확인하고 대응을 검토하세요.",
        sourceType: "REVIEW",
        channel,
      },
      {
        type: "LOW_RATING_REVIEW",
        severity: "MEDIUM",
        count: midRatingReviews.length,
        // Verbatim from AttentionSignalRules — the card renders `description`, so an
        // invented sentence is a sentence the product never says.
        label: "보통 평점(3점) 리뷰",
        description: "개선 여지가 있는 리뷰입니다. 확인을 권장합니다.",
        sourceType: "REVIEW",
        channel,
      },
      {
        type: "NEW_REVIEW",
        severity: "LOW",
        count: current,
        label: "신규 리뷰",
        description: "기간 내 새로 수집된 리뷰입니다.",
        sourceType: "REVIEW",
        channel,
      },
      {
        // The same current reviews as NEW_REVIEW, up from the prior equal-length window —
        // the shape the rules derive from newReviews vs previousReviews, both of which this
        // source really does fill. MEDIUM, not HIGH: the rules need current >= previous * 3
        // for HIGH, and 12 < 15.
        type: "RECENT_REVIEW_SPIKE_CANDIDATE",
        severity: "MEDIUM",
        count: current,
        label: "리뷰 급증 감지",
        description: `선택 기간 리뷰가 ${current}건으로 직전 동일 기간 ${previous}건보다 증가했습니다.`,
        sourceType: "REVIEW",
        channel,
        spike: { previousCount: previous, deltaCount: current - previous, ratio: current / previous },
      },
    ]),
  };
}

export function mockAttentionItems(
  accountId: string,
  params: { type: string; from: string; to: string },
  page: number,
  size: number,
): OperatorVocItemPage {
  const { type } = params;
  // The account decides, here too — the drill-down is the summary's neighbour, and leaving
  // it account-blind while fixing the summary is exactly the miss this round is about. An
  // account with no source drills to nothing; the UI cannot reach this (no card exists to
  // click) but a direct call gets the real answer instead of another account's rows.
  const lens = mockChannelCodeForAccount(accountId) === "NAVER" ? reviewsForLens(type) : null;
  // Not this store's lens — this account is NAVER, whose source holds no inquiries. Drilling
  // an inquiry lens yields NOTHING rather than inquiry rows, which is exactly what
  // IngestedReviewVocItemSource does ("an inquiry-kind signal can never have been raised
  // from this store's snapshot, so drilling one yields nothing rather than silently listing
  // reviews under an inquiry lens"). Unreachable through the UI — the summary raises no
  // inquiry card to click — and answered honestly anyway.
  if (lens == null) {
    return { signalType: type, fromDate: params.from, toDate: params.to, page, size, total: 0, items: [] };
  }
  // Both the total and the rows come from the SAME filtered list, so the count is the rows'
  // length by construction rather than by agreement. LOW_RATING drills the 1~3점 union —
  // legitimately more than either of its two cards, since they share the type — while the
  // unbounded lenses drill every review, matching theirs.
  const rows = lens.slice(page * size, page * size + size).map((r) => toVocItem(r, type));
  return {
    signalType: type,
    fromDate: params.from,
    toDate: params.to,
    page,
    size,
    total: lens.length,
    items: rows,
  };
}

/** One canonical review, as the ingested-review source would put it on the wire. */
function toVocItem(review: MockNaverReview, signalType: string): OperatorVocItem {
  const actionRef = naverReviewRef(review.id);
  return {
    channelCode: "NAVER",
    channelNameKo: "네이버 스마트스토어",
    sourceType: "REVIEW",
    productName: review.productName,
    rating: review.rating,
    // Null, not "UNKNOWN": a seller-center export carries no reply state, so the source
    // sends null rather than inventing a token. Renders as 상태 미상 either way — the
    // difference is that null is what the wire actually holds.
    replyStatus: null,
    sourceCreatedDate: review.sourceCreatedDate,
    collectedDate: "2026-05-30",
    signalType,
    safePreview: review.safePreview,
    actionRef,
    // Reflects whatever the operator decided this session, falling back to the seed. Keyed
    // on the ref, which is keyed on the review — so a decision made under one card is
    // visible under every other card that surfaces the same review.
    triageDisposition: mockTriageFor(review, actionRef),
    hasReplyPreparation: mockHasReplyPreparation(actionRef),
  };
}

/**
 * Whether this review already carries reply work — the demo's stand-in for the server's
 * batch lookup.
 *
 * Drafts OR approvals, matching the server rather than deriving one from the other. The row
 * and the reply panel must agree about this: it is half the panel's mount rule, so a demo
 * where they disagree would show the panel on rows the real product hides, or hide it on
 * rows the real product shows — either way teaching the wrong rule to whoever is evaluating.
 */
function mockHasReplyPreparation(actionRef: string): boolean {
  return (reviewReplyDrafts.get(actionRef)?.length ?? 0) > 0 || reviewReplyApprovals.has(actionRef);
}

/**
 * The disposition a row currently carries: this session's decision, else the seed.
 *
 * One function, called by both the drill-down row and the reply panel. They have to agree
 * about whether a review is 대응 필요 — the panel's entire gate is that answer — and two
 * copies of this fallback is exactly how they would quietly stop agreeing.
 */
function mockTriageFor(review: MockNaverReview, actionRef: string): TriageDisposition | null {
  return (
    triageDecisions.get(actionRef) ??
    (review.id === SEEDED_TRIAGE_REVIEW_ID ? "RESPONSE_NEEDED" : null)
  );
}

/**
 * Demo-mode triage decisions, by actionRef.
 *
 * Module-level on purpose, exactly like {@link savedCredentials}: it has to survive the
 * control unmounting. An earlier stateless version claimed the choice "stuck for the
 * session" and did not — closing and re-opening the drill-down re-read
 * {@link mockAttentionItems}, which always reported null, so the decision silently
 * evaporated. A demo whose whole subject is a RECORD must not lose the record.
 *
 * In-memory and per-tab: a reload starts clean. That is the honest limit of a fake, and it
 * is why this is only reachable behind the demo flag.
 */
const triageDecisions = new Map<string, TriageDisposition>();

/**
 * Demo-mode triage: record the decision and echo it back.
 *
 * The alternative was no mock at all, so every demo click errored — which looks more broken
 * than an absent control, and would undo the point of showing the control at all. Product
 * scope already fences this off: mock data is allowed only in an explicitly separated
 * demo/dev mode, and this write exists only behind that flag.
 */
export function mockVocItemTriage(
  actionRef: string,
  disposition: TriageDisposition,
): TriageDecisionResponse {
  triageDecisions.set(actionRef, disposition);
  // Always a fresh apply, never a replay: this has no command-id ledger, so it has no
  // basis to claim a decision was already applied. Faking `replayed: true` would assert
  // history the demo does not have.
  return { actionRef, disposition, replayed: false };
}

/** Test-only: drop the demo decisions so each test starts from the seeded fixture. */
export function resetMockTriageDecisions(): void {
  triageDecisions.clear();
}

// --- Review response preparation (demo mode) --------------------------------------
//
// Module-level, for triageDecisions' reason: the panel unmounts every time the drill-down
// closes, and a demo whose subject is a RECORD must not lose the record.
//
// These enforce the SAME rules the backend does — the gate, the freeze, the asymmetric
// withdrawal, copy-from-the-approved-head. Not gold-plating: a demo that let an operator
// copy an unapproved draft, or approve a review that is not 대응 필요, would be teaching
// the product's rules wrong to the person evaluating it, which is worse than showing no
// demo. Where a rule is a security property (redaction) the mock states the server's answer
// instead of reimplementing it — see MockNaverReview.redactedBody.

/** Draft versions per actionRef, oldest first. Append-only, exactly like the server's. */
const reviewReplyDrafts = new Map<string, ReviewReplyDraft[]>();
/** The current approval per actionRef, or absent when never approved. */
const reviewReplyApprovals = new Map<string, ReviewReplyApproval>();

/** Minted submission-run bindings, keyed on the opaque ref (v1.6). */
interface MockSubmissionRef {
  actionRef: string;
  boundVersion: number;
  boundFingerprint: string;
}
const reviewReplySubmissionRefs = new Map<string, MockSubmissionRef>();
/** Append-only operator-reported outcomes, keyed on the single-use ref they consumed (v1.6). */
interface MockOutcome extends ReviewReplyOutcome {
  actionRef: string;
}
const reviewReplyOutcomes = new Map<string, MockOutcome>();

let mockSubmissionRefCounter = 0;
/** A stand-in for the server's opaque 16-hex submissionRef. Unique per call, never a real value. */
function mockSubmissionRefToken(): string {
  mockSubmissionRefCounter += 1;
  const a = ((mockSubmissionRefCounter * 2654435761) >>> 0).toString(16).padStart(8, "0");
  const b = (mockSubmissionRefCounter >>> 0).toString(16).padStart(8, "0");
  return (a + b).slice(0, 16);
}

/**
 * A stand-in for the server's content fingerprint.
 *
 * NOT the real algorithm (SHA-256 over canonical JSON) and does not pretend to be: it only
 * has to be stable per content so the demo can show an approval bound to an exact version.
 * Prefixed so nobody mistakes one of these for a value a real backend produced.
 */
function mockFingerprint(body: string): string {
  let h = 0;
  for (let i = 0; i < body.length; i += 1) {
    h = (h * 31 + body.charCodeAt(i)) | 0;
  }
  return `mock-${(h >>> 0).toString(16).padStart(8, "0")}`;
}

/** The fixture row behind a ref, or null when the ref names nothing this store knows. */
function reviewForRef(actionRef: string): MockNaverReview | null {
  const found = NAVER_REVIEWS.find((r) => naverReviewRef(r.id) === actionRef);
  return found ?? null;
}

/**
 * Mirrors RuleBasedReviewReplyProvider — rating first, then keywords, else the default.
 *
 * The templates are copied VERBATIM from the Java provider, for the reason the attention
 * card copies AttentionSignalRules' descriptions verbatim: the panel renders this text, so
 * an invented sentence is a sentence the product never says. If the provider's templates
 * change, these change with them.
 *
 * Rating beats keywords: a 5★ "배송 빨라요" must not be answered with an apology for late
 * delivery.
 */
const MOCK_POSITIVE_MIN_RATING = 4;

const MOCK_REPLY_RULES: ReadonlyArray<{ category: string; keywords: string[]; body: string }> = [
  {
    category: "quality_reply",
    keywords: ["불량", "하자", "깨짐", "파손", "터짐", "고장", "품질"],
    body: "안녕하세요, 고객님. 상품에 문제가 있어 불편을 드린 점 진심으로 사과드립니다. 말씀해 주신 내용을 확인한 뒤 필요한 조치를 안내드리겠습니다. 알려주셔서 감사합니다.",
  },
  {
    category: "delivery_reply",
    keywords: ["배송", "택배", "발송", "도착", "출고", "지연"],
    body: "안녕하세요, 고객님. 상품을 받아보시기까지 불편을 드린 점 사과드립니다. 배송 과정을 다시 살펴보고 개선하겠습니다. 소중한 의견 남겨주셔서 감사합니다.",
  },
  {
    category: "packaging_reply",
    keywords: ["포장", "박스", "완충"],
    body: "안녕하세요, 고객님. 포장 상태로 불편을 드려 죄송합니다. 포장 방식을 다시 점검하겠습니다. 알려주셔서 감사합니다.",
  },
  {
    category: "product_info_reply",
    keywords: ["설명", "사양", "스펙", "사진", "상이", "다릅", "달라요"],
    body: "안녕하세요, 고객님. 상품 정보가 기대하신 것과 달라 실망을 드린 점 사과드립니다. 상품 설명을 다시 점검해 더 정확히 안내하겠습니다. 의견 감사합니다.",
  },
  {
    category: "pricing_reply",
    keywords: ["가격", "비싸", "할인", "가성비"],
    body: "안녕하세요, 고객님. 가격에 대한 의견 감사합니다. 더 나은 가치를 드릴 수 있도록 계속 고민하겠습니다.",
  },
];

const MOCK_POSITIVE_BODY =
  "안녕하세요, 고객님. 좋은 후기를 남겨주셔서 진심으로 감사합니다. 앞으로도 만족하실 수 있도록 노력하겠습니다.";
const MOCK_DEFAULT_BODY =
  "안녕하세요, 고객님. 소중한 후기를 남겨주셔서 감사합니다. 남겨주신 의견을 잘 살펴보고 반영하겠습니다.";

function mockSuggestion(review: MockNaverReview): ReviewReplySuggestion {
  const provenance = {
    providerKind: "RULE_BASED",
    providerName: "review-reply-template",
    providerVersion: "templates-v1",
  };
  if (review.rating >= MOCK_POSITIVE_MIN_RATING) {
    return { body: MOCK_POSITIVE_BODY, category: "positive_reply", ...provenance };
  }
  const haystack = review.redactedBody ?? "";
  for (const rule of MOCK_REPLY_RULES) {
    if (rule.keywords.some((k) => haystack.includes(k))) {
      return { body: rule.body, category: rule.category, ...provenance };
    }
  }
  return { body: MOCK_DEFAULT_BODY, category: "general_reply", ...provenance };
}

/** The demo's stand-in for the server's decided_at. Fixed, so the demo reads no clock. */
const MOCK_DECIDED_AT = "2026-07-17T00:00:00Z";

/**
 * Demo-mode reply prep for one review.
 *
 * Computes `capabilities` exactly as ReviewReplyService does, from the same four inputs
 * (disposition, draft existence, approval state, and the CHANNEL's reply state) — including the
 * asymmetry: leaving 대응 필요 closes save/approve/copy but never withdrawal, and a review the
 * channel already answered loses the guided run alone.
 *
 * Demo reviews carry no import behind them, so `channelReplyState` is UNKNOWN — the same value the
 * server sends for a review whose source said nothing, and the one that blocks nothing.
 */
export function mockReviewReplyPrep(actionRef: string): ReviewReplyPrep {
  // Demo data has no import behind it, so the channel has said nothing about a reply. Typed as the
  // wire's own string so the capability rule below is the SAME expression the server evaluates —
  // narrowing it to the literal would let the comparison be optimized away and the parity lost.
  const channelReplyState: string = "UNKNOWN";
  const review = reviewForRef(actionRef);
  if (review == null) {
    // The real backend answers 404 for a ref it cannot address; the demo throws so the
    // panel takes its error path rather than rendering a review that does not exist.
    throw new Error("mock: unknown actionRef");
  }
  const disposition = mockTriageFor(review, actionRef);
  const versions = reviewReplyDrafts.get(actionRef) ?? [];
  const head = versions.length > 0 ? versions[versions.length - 1] : null;
  const approval = reviewReplyApprovals.get(actionRef) ?? null;

  const responseNeeded = disposition === "RESPONSE_NEEDED";
  const approved = approval?.state === "APPROVED";
  const canCopy = responseNeeded && approved;

  return {
    actionRef,
    redactedBody: review.redactedBody,
    bodyRedacted: review.bodyRedacted,
    triageDisposition: disposition,
    suggestion: mockSuggestion(review),
    draft: head,
    approval:
      approval == null
        ? null
        : {
            ...approval,
            // The copyable body is withheld unless copying is allowed — the same contract
            // the server keeps, so a client written against the demo cannot learn to copy
            // something the real backend would not hand it.
            approvedBody: canCopy ? approval.approvedBody : null,
          },
    outcome: mockOutcomeForHead(actionRef, approved ? approval?.approvedVersion ?? null : null),
    capabilities: {
      canSave: responseNeeded && !approved,
      canApprove: responseNeeded && !approved && head != null,
      canWithdraw: approved,
      canCopy,
      // Same rule as canCopy, minus a review the channel already answered — the server computes it
      // the same way (responseNeeded && approved && !channelAnswered).
      canStartSubmissionRun: canCopy && channelReplyState !== "ANSWERED",
    },
    channelReplyState,
  };
}

/** The latest recorded outcome for a review's current approved version, or null. */
function mockOutcomeForHead(actionRef: string, approvedVersion: number | null): ReviewReplyOutcome | null {
  if (approvedVersion == null) {
    return null;
  }
  let latest: MockOutcome | null = null;
  for (const o of reviewReplyOutcomes.values()) {
    if (o.actionRef === actionRef && o.recordedVersion === approvedVersion) {
      latest = o; // insertion order → the last match is the most recent
    }
  }
  if (latest == null) {
    return null;
  }
  return {
    operatorOutcome: latest.operatorOutcome,
    verification: latest.verification,
    recordedVersion: latest.recordedVersion,
    recordedFingerprint: latest.recordedFingerprint,
    awRunRef: latest.awRunRef,
    recordedAt: latest.recordedAt,
  };
}

/** Demo-mode draft save: append-only versions with the server's baseVersion semantics. */
export function mockSaveReviewReplyDraft(
  actionRef: string,
  body: string,
  baseVersion: number,
): ReviewReplyDraft {
  const prep = mockReviewReplyPrep(actionRef);
  if (!prep.capabilities.canSave) {
    throw new Error("mock: 저장할 수 없는 상태입니다");
  }
  const versions = reviewReplyDrafts.get(actionRef) ?? [];
  const current = versions.length;
  const normalized = body.replace(/\r\n?/g, "\n").trim();
  const fingerprint = mockFingerprint(normalized);
  const head = versions[versions.length - 1] ?? null;

  // Idempotent re-save of identical content, exactly as the server treats it.
  if (head != null && head.contentFingerprint === fingerprint && baseVersion >= current - 1) {
    return head;
  }
  if (baseVersion !== current) {
    throw new Error("mock: stale baseVersion");
  }
  const next: ReviewReplyDraft = {
    version: current + 1,
    body: normalized,
    contentFingerprint: fingerprint,
    fingerprintAlgorithm: "review-reply-v1",
    createdAt: MOCK_DECIDED_AT,
  };
  reviewReplyDrafts.set(actionRef, [...versions, next]);
  return next;
}

/**
 * Demo-mode approve/withdraw.
 *
 * Always reports `replayed: false`, for mockVocItemTriage's reason: this has no command-id
 * ledger, so it has no basis to claim a decision was already applied. Faking a replay would
 * assert history the demo does not have.
 */
export function mockDecideReviewReplyApproval(
  actionRef: string,
  state: ReviewReplyApprovalStateName,
  baseVersion: number | null,
): ReviewReplyApprovalResponse {
  const prep = mockReviewReplyPrep(actionRef);
  if (state === "WITHDRAWN") {
    if (!prep.capabilities.canWithdraw) {
      throw new Error("mock: 승인된 초안이 없습니다");
    }
    reviewReplyApprovals.set(actionRef, {
      state: "WITHDRAWN",
      approvedVersion: null,
      approvedFingerprint: null,
      approvedBody: null,
      decidedAt: MOCK_DECIDED_AT,
    });
    return { actionRef, state: "WITHDRAWN", replayed: false };
  }
  if (!prep.capabilities.canApprove) {
    throw new Error("mock: 승인할 수 없는 상태입니다");
  }
  const versions = reviewReplyDrafts.get(actionRef) ?? [];
  const head = versions[versions.length - 1] ?? null;
  if (head == null || baseVersion !== head.version) {
    throw new Error("mock: stale baseVersion");
  }
  reviewReplyApprovals.set(actionRef, {
    state: "APPROVED",
    approvedVersion: head.version,
    approvedFingerprint: head.contentFingerprint,
    approvedBody: head.body,
    decidedAt: MOCK_DECIDED_AT,
  });
  return { actionRef, state: "APPROVED", replayed: false };
}

/**
 * Demo-mode start of a guided reply-submission run: mint a single-use ref bound to the approved head.
 * Gated exactly as the server gates it (`canStartSubmissionRun`), so the demo can never offer the
 * guided flow on a review the real backend would refuse.
 */
export function mockStartReviewReplySubmissionRun(actionRef: string): ReviewReplySubmissionRunResponse {
  const prep = mockReviewReplyPrep(actionRef);
  if (!prep.capabilities.canStartSubmissionRun || prep.approval?.approvedVersion == null) {
    throw new Error("mock: 답변 제출을 시작할 수 없는 상태입니다");
  }
  const submissionRef = mockSubmissionRefToken();
  reviewReplySubmissionRefs.set(submissionRef, {
    actionRef,
    boundVersion: prep.approval.approvedVersion,
    boundFingerprint: prep.approval.approvedFingerprint ?? "",
  });
  return { actionRef, submissionRef, approvedVersion: prep.approval.approvedVersion };
}

/**
 * Demo-mode record of the operator's report. Single-use: a second record against a spent ref is
 * refused, exactly as the server refuses it. Always `replayed: false` (no command-id ledger here, for
 * mockDecideReviewReplyApproval's reason). Verification is always UNVERIFIED — never a channel claim.
 */
export function mockRecordReviewReplyOutcome(
  actionRef: string,
  submissionRef: string,
  operatorOutcome: OperatorOutcomeName,
  awRunRef: string,
): ReviewReplyOutcomeResponse {
  const binding = reviewReplySubmissionRefs.get(submissionRef);
  if (binding == null || binding.actionRef !== actionRef) {
    throw new Error("mock: 유효하지 않은 제출 참조입니다");
  }
  if (reviewReplyOutcomes.has(submissionRef)) {
    throw new Error("mock: 이미 결과가 기록된 제출입니다"); // single-use
  }
  const prep = mockReviewReplyPrep(actionRef);
  if (
    prep.triageDisposition !== "RESPONSE_NEEDED" ||
    prep.approval?.state !== "APPROVED" ||
    prep.approval.approvedVersion !== binding.boundVersion
  ) {
    throw new Error("mock: 승인 상태가 바뀌었습니다");
  }
  reviewReplyOutcomes.set(submissionRef, {
    actionRef,
    operatorOutcome,
    verification: "UNVERIFIED",
    recordedVersion: binding.boundVersion,
    recordedFingerprint: binding.boundFingerprint,
    // The runId comes from the runtime terminal (the sole source), not fabricated from the ref.
    awRunRef,
    recordedAt: MOCK_DECIDED_AT,
  });
  return { actionRef, recorded: true, replayed: false };
}

/** Test-only: drop the demo drafts/approvals/submission-refs/outcomes so each test starts fresh. */
export function resetMockReviewReplyState(): void {
  reviewReplyDrafts.clear();
  reviewReplyApprovals.clear();
  reviewReplySubmissionRefs.clear();
  reviewReplyOutcomes.clear();
}

export function mockSyncRuns(): SyncRunView[] {
  return [
    {
      id: "mock-run-1",
      sellerAccountId: "mock-acct",
      channelId: "mock-channel-0",
      dataType: "INQUIRY",
      trigger: "SCHEDULED",
      attempt: 1,
      rateLimited: false,
      nextRetryAt: null,
      jobType: "MOCK_API",
      uploadType: null,
      status: "SUCCESS",
      totalRows: 45,
      successRows: 45,
      skippedRows: 0,
      failedRows: 0,
      errorMessage: null,
      startedAt: hoursAgoISO(4),
      finishedAt: hoursAgoISO(4),
    },
    {
      id: "mock-run-2",
      sellerAccountId: null,
      channelId: "mock-channel-0",
      dataType: null,
      trigger: "UPLOAD",
      attempt: 1,
      rateLimited: false,
      nextRetryAt: null,
      jobType: "FILE_UPLOAD",
      uploadType: "REVIEW",
      status: "SUCCESS",
      totalRows: 44,
      successRows: 42,
      skippedRows: 2,
      failedRows: 0,
      errorMessage: null,
      startedAt: hoursAgoISO(8),
      finishedAt: hoursAgoISO(8),
    },
  ];
}

export function mockSyncJobs(): SyncJobView[] {
  return [
    {
      id: "mock-job-1",
      channelId: "mock-channel-0",
      jobType: "FILE_UPLOAD",
      uploadType: "REVIEW",
      status: "SUCCESS",
      totalRows: 44,
      successRows: 42,
      skippedRows: 2,
      failedRows: 0,
      errorMessage: null,
      startedAt: hoursAgoISO(3),
      finishedAt: hoursAgoISO(3),
    },
  ];
}

/**
 * Demo-mode review-import history.
 *
 * Deliberately spans the outcomes the real surface must tell apart — a normal import, an
 * all-duplicate re-import, an empty export, and a failure — so the demo shows the honest state table
 * rather than a row of uniform successes. Newest first, like the real read.
 */
export function mockReviewImports(limit?: number): ReviewImport[] {
  const rows: ReviewImport[] = [
    {
      id: "mock-import-1",
      method: "SELLER_CENTER_EXPORT",
      status: "SUCCESS",
      totalRows: 6,
      successRows: 6,
      skippedRows: 0,
      failedRows: 0,
      startedAt: "2026-05-10T09:00:00Z",
      finishedAt: "2026-05-10T09:00:12Z",
    },
    {
      id: "mock-import-2",
      method: "SELLER_CENTER_EXPORT",
      status: "SUCCESS",
      totalRows: 6,
      successRows: 0,
      skippedRows: 6,
      failedRows: 0,
      startedAt: "2026-05-09T09:00:00Z",
      finishedAt: "2026-05-09T09:00:08Z",
    },
    {
      id: "mock-import-3",
      method: "SELLER_CENTER_EXPORT",
      status: "SUCCESS",
      totalRows: 0,
      successRows: 0,
      skippedRows: 0,
      failedRows: 0,
      startedAt: "2026-05-08T09:00:00Z",
      finishedAt: "2026-05-08T09:00:05Z",
    },
    {
      id: "mock-import-4",
      method: "MANUAL_UPLOAD",
      status: "FAILED",
      totalRows: 0,
      successRows: 0,
      skippedRows: 0,
      failedRows: 0,
      startedAt: "2026-05-07T09:00:00Z",
      finishedAt: "2026-05-07T09:00:02Z",
    },
  ];
  return limit == null ? rows : rows.slice(0, limit);
}
