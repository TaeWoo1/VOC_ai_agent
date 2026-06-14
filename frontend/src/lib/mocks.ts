// Seeded mock responses. Used when VITE_USE_MOCKS=true, and as a fallback when
// the backend is unreachable — so the UI is never blank during a demo.
import type {
  AuthResponse,
  CapabilityView,
  ChannelResponse,
  ChannelStatus,
  ConnectionStatusView,
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

export function mockChannels(): ChannelResponse[] {
  return CHANNELS.map((c, i) => ({
    id: `mock-channel-${i}`,
    code: c.code,
    nameKo: c.nameKo,
    status: c.status,
    dataBadges: c.dataBadges,
    lastSyncedAt: c.status === "CONNECTED" ? hoursAgoISO(i + 1) : null,
    actionLabel: actionLabel(c.status),
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

export function mockConnectionStatus(): ConnectionStatusView {
  return {
    sellerAccountId: "mock-acct",
    state: "CONNECTED",
    lastSuccessAt: hoursAgoISO(4),
    consecutiveFailures: 0,
    lastError: null,
    lastSyncedAt: hoursAgoISO(4),
    nextScheduledAt: hoursAheadISO(2),
  };
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
