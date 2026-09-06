/**
 * The conversation suites' harness: a real {@link ConversationService} over the real Operator graph,
 * with only the transport faked — the same posture as every Operator suite. Plans are v3 recordings
 * replayed at `planGoal`; every read is a seeded fake; the store is in-memory.
 */
import type { ConversationService as ServiceType } from "../../src/conversation/ConversationService";
import { ConversationService } from "../../src/conversation/ConversationService";
import type { ProgressEvent, TurnView } from "../../src/conversation/contract";
import { RunStoreProvider } from "../../src/http/runStoreProvider";
import type { RuntimeConfig } from "../../src/http/config";
import type { SpringClientFactory } from "../../src/http/AgentRunService";
import type {
  ChannelCoverageRow, DashboardOverview, OrderSummaryResponse, RecentReviewsResponse,
} from "../../src/spring/types";
import { FakeOperatorSpringClient } from "../support/FakeOperatorSpringClient";
import type { FakeOperatorSeed } from "../support/FakeOperatorSpringClient";
import { FakeSpringClient } from "../support/FakeSpringClient";
import type { SeedInquiry } from "../support/FakeSpringClient";
import { FakeReviewSpringClient } from "../support/FakeReviewSpringClient";
import { FakeIssueSpringClient } from "../support/FakeIssueSpringClient";
import { fourIssues } from "../support/issueFixtures";
import { twoReviews } from "../support/reviewFixtures";
import { CONVERSATION_PLANS, RECORDED_PLANS } from "../support/recordedPlans";
import { CABLE, INBOX, KNOWLEDGE, MEMORY, MOLDING, REPEATS, coveredSignals, unlinkedSignals } from "../support/operatorFixtures";

export const TODAY = "2026-08-27";
export const COUPANG_ACCOUNT = "acct-coupang";
export const CAFE24_ACCOUNT = "acct-cafe24";

export const CONFIG: RuntimeConfig = {
  port: 0, backendBaseUrl: "http://unused", env: "development", runStoreKind: "memory",
  runStoreDir: "./unused", corsAllowedOrigins: ["http://localhost:5173"],
};

export function coverageRow(overrides: Partial<ChannelCoverageRow>): ChannelCoverageRow {
  return {
    channelCode: "CAFE24", channelNameKo: "카페24", dataType: "REVIEW", state: "OBSERVED_FRESH", supported: true,
    verificationStatus: "LIVE_VERIFIED", connected: true, connectionStatus: "CONNECTED", routineEnabled: true,
    routinePausedBy: null, lastSuccessfulSyncAt: `${TODAY}T01:00:00Z`, rows: 40, openRows: 3,
    newestObservedAt: `${TODAY}T00:30:00Z`, ...overrides,
  };
}

/** Three review rows today: two on the molding product (one negative), one on the cable product. */
export function freshReviews(coverage: ChannelCoverageRow[] = allFreshCoverage()): RecentReviewsResponse {
  return {
    from: TODAY, to: TODAY, negativeOnly: false, total: 3,
    items: [
      { id: "r-1", sellerAccountId: CAFE24_ACCOUNT, channelCode: "CAFE24", channelNameKo: "카페24", writtenOn: TODAY,
        rating: 5, negative: false, preview: "붙이기 쉽고 깔끔해요", productId: MOLDING.id, productName: MOLDING.name, replyState: "NONE" },
      { id: "r-2", sellerAccountId: CAFE24_ACCOUNT, channelCode: "CAFE24", channelNameKo: "카페24", writtenOn: TODAY,
        rating: 2, negative: true, preview: "접착이 금방 떨어졌어요", productId: MOLDING.id, productName: MOLDING.name, replyState: "NONE" },
      { id: "r-3", sellerAccountId: CAFE24_ACCOUNT, channelCode: "CAFE24", channelNameKo: "카페24", writtenOn: TODAY,
        rating: 4, negative: false, preview: null, productId: CABLE.id, productName: CABLE.name, replyState: "NONE" },
    ],
    coverage,
  };
}

/** The negative-only read: r-2 from the set above, plus one that arrived after the first turn. */
export function negativeReviews(coverage: ChannelCoverageRow[] = allFreshCoverage()): RecentReviewsResponse {
  const all = freshReviews(coverage);
  return {
    ...all, negativeOnly: true, total: 2,
    items: [
      all.items[1]!,
      { id: "r-9", sellerAccountId: CAFE24_ACCOUNT, channelCode: "CAFE24", channelNameKo: "카페24", writtenOn: TODAY,
        rating: 1, negative: true, preview: "배송이 너무 늦어요", productId: CABLE.id, productName: CABLE.name, replyState: "NONE" },
    ],
  };
}

export function allFreshCoverage(): ChannelCoverageRow[] {
  return [
    coverageRow({}),
    coverageRow({ channelCode: "COUPANG", channelNameKo: "쿠팡", state: "ZERO", rows: 0, openRows: 0, newestObservedAt: null }),
    coverageRow({ channelCode: "NAVER", channelNameKo: "네이버", state: "NOT_SUPPORTED", supported: false, rows: 0,
      openRows: 0, newestObservedAt: null, lastSuccessfulSyncAt: null, connected: false, connectionStatus: null }),
  ];
}

/** Coupang's review collection has not run since last week — freshness unproven for a TODAY read. */
export function staleCoupangCoverage(): ChannelCoverageRow[] {
  return [
    coverageRow({}),
    coverageRow({ channelCode: "COUPANG", channelNameKo: "쿠팡", state: "OBSERVED_FRESHNESS_UNPROVEN", rows: 12,
      openRows: 1, lastSuccessfulSyncAt: "2026-08-20T01:00:00Z", newestObservedAt: "2026-08-19T00:00:00Z" }),
    coverageRow({ channelCode: "NAVER", channelNameKo: "네이버", state: "NOT_SUPPORTED", supported: false, rows: 0,
      openRows: 0, newestObservedAt: null, lastSuccessfulSyncAt: null, connected: false, connectionStatus: null }),
  ];
}

function series(key: string, label: string, unit: string, values: number[], from: string): { key: string; label: string; unit: string; points: { date: string; value: number }[] } {
  const start = Date.parse(`${from}T00:00:00Z`);
  return { key, label, unit, points: values.map((value, i) => ({ date: new Date(start + i * 86_400_000).toISOString().slice(0, 10), value })) };
}

/** Fourteen days: the earlier week 100,000/day (3 orders), the recent week 60,000/day (2 orders). */
export function overview14(): DashboardOverview {
  const from = "2026-08-14";
  const revenue = [...Array(7).fill(100_000), ...Array(7).fill(60_000)];
  const orders = [...Array(7).fill(3), ...Array(7).fill(2)];
  return {
    metrics: {
      period: { from, to: TODAY, previousFrom: "2026-07-31", previousTo: "2026-08-13", days: 14 },
      revenueBasis: "채널별 결제 금액 합계(취소 미반영)", orderCountBasis: "채널별 주문 건수",
      kpis: [
        { key: "revenue", label: "매출", value: 1_120_000, unit: "원", previousValue: 1_400_000, deltaPercent: -20, comparable: true, excludedChannels: 1, freshnessUnproven: false },
        { key: "orders", label: "주문", value: 35, unit: "건", previousValue: 42, deltaPercent: -17, comparable: true, excludedChannels: 1, freshnessUnproven: false },
      ],
      series: [series("revenue", "매출", "원", revenue, from), series("orders", "주문", "건", orders, from)],
      channels: [
        { channelCode: "CAFE24", channelNameKo: "카페24", orderState: "OBSERVED_FRESH", revenue: 700_000, orders: 21, countedInOrders: true,
          inquiryState: "OBSERVED_FRESH", inquiries: 5, unansweredInquiries: 2, countedInInquiries: true,
          reviewState: "OBSERVED_FRESH", reviews: 40, negativeReviews: 3, countedInReviews: true },
        { channelCode: "NAVER", channelNameKo: "네이버", orderState: "OBSERVED_FRESH", revenue: 420_000, orders: 14, countedInOrders: true,
          inquiryState: "OBSERVED_FRESH", inquiries: 3, unansweredInquiries: 1, countedInInquiries: true,
          reviewState: "NOT_SUPPORTED", reviews: 0, negativeReviews: 0, countedInReviews: false },
      ],
      exclusions: [{ channelCode: "COUPANG", channelNameKo: "쿠팡", dataType: "ORDER_SUMMARY", state: "NOT_CONNECTED", reasonKo: "미연결" }],
      exampleDataIncluded: false,
    },
  };
}

export function cafe24Summary(): OrderSummaryResponse {
  return {
    totalOrders7d: 12, totalSales7d: 360_000,
    trend: Array.from({ length: 7 }, (_, i) => ({ date: `2026-08-${21 + i}`, orderCount: 2, salesAmount: 60_000 })),
    channelShare: [{ channelNameKo: "카페24", salesAmount: 360_000, percent: 100 }],
  };
}

export const W_SHIP = "w-ship";
export const W_SIZE = "w-size";
export const W_RETURN = "w-return";

export function inquiries(): SeedInquiry[] {
  return [
    { workItemId: W_SHIP, inquiryId: "inq-ship", sellerAccountId: CAFE24_ACCOUNT, channelId: "chan-cafe24",
      channelCode: "CAFE24", channelNameKo: "카페24", title: "배송 언제 오나요", details: "주문했는데 택배가 아직이에요",
      receivedAt: "2026-08-26T09:00:00Z", productId: MOLDING.id, productName: MOLDING.name },
    { workItemId: W_SIZE, inquiryId: "inq-size", sellerAccountId: CAFE24_ACCOUNT, channelId: "chan-cafe24",
      channelCode: "CAFE24", channelNameKo: "카페24", title: "사이즈 문의", details: "폭이 몇 mm 인가요",
      receivedAt: "2026-08-26T11:00:00Z" },
    { workItemId: W_RETURN, inquiryId: "inq-return", sellerAccountId: CAFE24_ACCOUNT, channelId: "chan-cafe24",
      channelCode: "CAFE24", channelNameKo: "카페24", title: "반품 문의", details: "반품하고 싶어요",
      receivedAt: "2026-08-27T01:00:00Z", productId: CABLE.id, productName: CABLE.name },
  ];
}

/**
 * Expand each `ALL` review answer into the per-channel answers the read can actually ask for.
 *
 * <b>Found by Planner Model & Prompt Benchmark v1 §5, and it was the instrument, not the product.</b>
 * `listRecentReviews` is keyed `${negativeOnly}:${channel ?? "ALL"}` and 404s on a miss, so a suite
 * seeded only with `ALL` answered every channel-scoped read with a failure: 「카페24만 봐봐」 — for
 * which the planner produces exactly the right plan — ended the run FAILED, on every model. One
 * candidate model "passed" that turn by planning a different question entirely, which is the worst
 * way for a benchmark to be wrong.
 *
 * The rows decide, and an explicit seeding always wins: a channel this world holds no row for gets an
 * EMPTY page, which is what the backend returns and is a different fact from the read failing.
 */
function withChannelKeys(table: Record<string, RecentReviewsResponse>): Record<string, RecentReviewsResponse> {
  const out: Record<string, RecentReviewsResponse> = { ...table };
  for (const [key, response] of Object.entries(table)) {
    const [negative, scope] = key.split(":");
    if (scope !== "ALL") continue;
    for (const code of new Set(response.coverage.map((c) => c.channelCode))) {
      const derived = `${negative}:${code}`;
      if (out[derived]) continue;
      const mine = response.items.filter((i) => i.channelCode === code);
      out[derived] = { ...response, total: mine.length, items: mine };
    }
  }
  return out;
}

export interface Harness {
  readonly service: ServiceType;
  readonly operator: FakeOperatorSpringClient;
  readonly inquiry: FakeSpringClient;
  readonly stores: RunStoreProvider;
  readonly recentReviews: Record<string, RecentReviewsResponse>;
  /**
   * The same factory the service was built with.
   *
   * Returned so a suite can build a SECOND service over the SAME store — which is how a process
   * restart is reproduced without a process (LangGraph Orchestration Migration v1 §9).
   */
  readonly clientFactory: SpringClientFactory;
}

export function harness(
  seed: Partial<FakeOperatorSeed> = {}, seeds: SeedInquiry[] = inquiries(),
  issue: FakeIssueSpringClient = new FakeIssueSpringClient(fourIssues()),
): Harness {
  const recentReviews: Record<string, RecentReviewsResponse> = withChannelKeys({
    "false:ALL": freshReviews(), "true:ALL": negativeReviews(), ...(seed.recentReviews ?? {}),
  });
  const operator = new FakeOperatorSpringClient({
    inbox: INBOX, products: [MOLDING, CABLE],
    signals: { [MOLDING.id]: coveredSignals(), [CABLE.id]: unlinkedSignals() },
    knowledge: KNOWLEDGE, customerMemory: MEMORY, repeats: REPEATS,
    plansByGoal: { ...RECORDED_PLANS, ...CONVERSATION_PLANS },
    overviewByDays: { 7: overview14(), 14: overview14(), 30: overview14() },
    ordersSummary: cafe24Summary(),
    channelCoverage: allFreshCoverage(),
    inquiryReplyTransports: [
      { channelCode: "CAFE24", sourceSubtype: null, transport: "DIRECT_API", reasonKo: null, evidence: "cafe24 board reply article" },
      { channelCode: "NAVER", sourceSubtype: "NAVER_PRODUCT_QNA", transport: "DIRECT_API", reasonKo: null, evidence: "PUT qnas" },
      { channelCode: "NAVER", sourceSubtype: "NAVER_CUSTOMER_INQUIRY", transport: "DIRECT_API", reasonKo: null, evidence: "POST answer" },
      { channelCode: "COUPANG", sourceSubtype: null, transport: "DIRECT_API", reasonKo: null, evidence: "onlineInquiries replies" },
    ],
    reviewChannelCapabilities: {
      [COUPANG_ACCOUNT]: { replySupported: false, executionKind: "NOT_SUPPORTED" } as never,
      [CAFE24_ACCOUNT]: { replySupported: true, executionKind: "API_EXECUTION" } as never,
    },
    ...seed,
    recentReviews,
  });
  const inquiry = new FakeSpringClient(seeds);
  inquiry.publishCapability = { executionEnabled: true, replyAdapterChannelCodes: ["CAFE24", "NAVER", "COUPANG"] };
  inquiry.sellerAccounts = [
    { id: COUPANG_ACCOUNT, channelId: "chan-coupang", channelNameKo: "쿠팡", alias: null, connectionStatus: "CONNECTED", lastSyncedAt: null, fileUpload: false },
    { id: CAFE24_ACCOUNT, channelId: "chan-cafe24", channelNameKo: "카페24", alias: null, connectionStatus: "CONNECTED", lastSyncedAt: null, fileUpload: false },
  ];
  const clientFactory: SpringClientFactory = () => ({
    inquiry, review: new FakeReviewSpringClient(twoReviews()), issue,
    identity: { whoami: async () => ({ userId: "u-1", orgId: "org-conversation-test" }) }, operator,
  });
  const stores = new RunStoreProvider(CONFIG);
  const service = new ConversationService({ storeProvider: stores, clientFactory });
  return { service, operator, inquiry, stores, recentReviews, clientFactory };
}

export const TOKEN = "test-token";

/** One turn, collecting the stages it reported. */
export async function say(h: Harness, id: string, text: string, extra: Record<string, unknown> = {}):
  Promise<{ turn: TurnView; stages: string[] }> {
  const stages: string[] = [];
  const turn = await h.service.turn(TOKEN, id, { text, referenceDate: TODAY, ...extra } as never, (e: ProgressEvent) => {
    if (e.type === "stage") stages.push(e.stage);
  });
  return { turn, stages };
}

export function artifact<T extends TurnView["artifacts"][number]["type"]>(turn: TurnView, type: T):
  Extract<TurnView["artifacts"][number], { type: T }> {
  const found = turn.artifacts.find((a) => a.type === type);
  if (!found) throw new Error(`no ${type} artifact; got ${turn.artifacts.map((a) => a.type).join(",")} — ${turn.message}`);
  return found as Extract<TurnView["artifacts"][number], { type: T }>;
}
