// Seeded mock responses. Used when VITE_USE_MOCKS=true, and as a fallback when
// the backend is unreachable — so the UI is never blank during a demo.
import type {
  AuthResponse,
  CapabilityView,
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
  OrderSummaryResponse,
  SalesTrendPoint,
  ScheduleView,
  SellerAccountResponse,
  SyncJobView,
  SyncRunView,
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

// The channel code behind a demo account id (`mock-acct-mock-channel-{i}`), or
// null if it can't be derived — used to keep the demo test-connection honest.
function mockChannelCodeForAccount(accountId?: string): string | null {
  if (accountId == null) {
    return null;
  }
  const match = accountId.match(/mock-channel-(\d+)$/);
  if (match == null) {
    return null;
  }
  return CHANNELS[Number(match[1])]?.code ?? null;
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
