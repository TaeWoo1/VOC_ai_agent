// @vitest-environment jsdom
/**
 * Agent Object + First-use Closure v1 — the frontend half.
 *
 * §1 the selected review is an object with a card: the customer's sentence is the biggest text, the
 *    reply move exists only when the channel takes one, and a reloaded thread re-reads the body from
 *    the same exact endpoint rather than keeping a second copy of it.
 * §2 three first-use mornings, and the two that are not 「할 일 없음」 say what they actually are.
 * §3 a near-repeat of a title is declared by the producer, not guessed from the sentence.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AgentPanelProvider } from "../../lib/agentPanel";
import { ConversationProvider } from "../../lib/conversation/ConversationProvider";
import { AgentHome } from "./AgentHome";
import { ReviewDetailArtifact } from "../../components/conversation/artifacts/ReviewDetailArtifact";
import { ArtifactCard } from "../../components/conversation/artifacts/ArtifactCard";
import { currentContext } from "../../lib/conversation/currentContext";
import { delegableSentence, homeFirstUseState, noDataSentence } from "../../lib/homeFirstUse";
import type { ChannelMetricRow, MetricKpi, OverviewResponse } from "../../lib/types";
import type { ReviewDetailArtifact as ReviewDetail, TurnView, WorkingSetView } from "../../lib/conversation/types";

const getOverviewStrict = vi.fn();
const getProactiveCases = vi.fn();
const getInquiryRowsStrict = vi.fn();
const getReviewDetailStrict = vi.fn();
vi.mock("../../lib/apiClient", () => ({
  api: {
    getOverviewStrict: (d?: number) => getOverviewStrict(d),
    getProactiveCases: (n?: number) => getProactiveCases(n),
    getInquiryRowsStrict: (p: unknown) => getInquiryRowsStrict(p),
    getReviewDetailStrict: (id: string) => getReviewDetailStrict(id),
    getInquiryQueueStrict: vi.fn(async () => ({ content: [], page: 0, size: 5, totalElements: 0, totalPages: 0 })),
    getReviewIssuesStrict: vi.fn(async () => []),
    getSyncRunsStrict: vi.fn(async () => []),
    markProactiveCaseOpened: vi.fn(),
  },
  getToken: () => null,
}));
vi.mock("../../lib/conversation/conversationClient", () => ({
  conversationClient: {
    createConversation: vi.fn(async () => ({ conversationId: "c-1", createdAt: "x" })),
    getConversation: vi.fn(),
    listConversations: vi.fn(async () => []),
    sendTurn: vi.fn(),
  },
}));

function kpi(key: string, label: string, value: number): MetricKpi {
  return { key, label, value, unit: "건", previousValue: 0, deltaPercent: null, comparable: true, excludedChannels: 0, freshnessUnproven: false };
}

function row(over: Partial<ChannelMetricRow> = {}): ChannelMetricRow {
  return {
    channelCode: "CAFE24", channelNameKo: "카페24",
    orderState: "OBSERVED_FRESH", revenue: 1, orders: 1, countedInOrders: true,
    inquiryState: "OBSERVED_FRESH", inquiries: 1, unansweredInquiries: 1, countedInInquiries: true,
    reviewState: "OBSERVED_FRESH", reviews: 1, negativeReviews: 0, countedInReviews: true,
    ...over,
  };
}

/** Every data type unconnected — a brand-new account's table. */
const NOT_CONNECTED = row({
  orderState: "NOT_CONNECTED", orders: 0, revenue: 0, inquiryState: "NOT_CONNECTED", inquiries: 0,
  unansweredInquiries: 0, reviewState: "NOT_CONNECTED", reviews: 0,
});
/** Connected this morning: nothing collected yet on any type. */
const CONNECTED_EMPTY = row({
  orderState: "OBSERVED_FRESHNESS_UNPROVEN", orders: 0, revenue: 0,
  inquiryState: "OBSERVED_FRESHNESS_UNPROVEN", inquiries: 0, unansweredInquiries: 0,
  reviewState: "OBSERVED_FRESHNESS_UNPROVEN", reviews: 0,
});

function overview(channels: ChannelMetricRow[]): OverviewResponse {
  const any = channels.some((c) => c.orders > 0 || c.inquiries > 0 || c.reviews > 0);
  return {
    metrics: {
      period: { from: "2026-08-26", to: "2026-09-01", previousFrom: "2026-08-19", previousTo: "2026-08-25", days: 7 },
      revenueBasis: "결제 완료 기준", orderCountBasis: "주문 건수 기준",
      kpis: [kpi("orders", "주문", any ? 12 : 0), kpi("unansweredInquiries", "미답변 문의", any ? 2 : 0), kpi("negativeReviews", "부정 리뷰", 0)],
      series: [{ key: "orders", label: "주문", unit: "건", points: [{ date: "2026-09-01", value: any ? 4 : 0 }] }],
      channels, exclusions: [], exampleDataIncluded: false,
    },
    insights: [],
  };
}

function renderHome() {
  return render(
    <MemoryRouter>
      <AgentPanelProvider>
        <ConversationProvider>
          <AgentHome now={new Date("2026-09-01T09:30:00+09:00")} />
        </ConversationProvider>
      </AgentPanelProvider>
    </MemoryRouter>,
  );
}

function detail(over: Partial<ReviewDetail> = {}): ReviewDetail {
  return {
    artifactId: "a-review-r-2", type: "REVIEW_DETAIL", title: "선택한 리뷰", reviewId: "r-2",
    channelCode: "CAFE24", channelNameKo: "카페24", writtenOn: "2026-08-27", rating: 2, negative: true,
    productId: "p-1", productName: "논슬립 주방 매트",
    body: "접착이 금방 떨어졌어요.", issues: [{ issueId: "iss-1", title: "접착력 부족", severity: "HIGH", to: "/memory/iss-1" }],
    replyCapability: "DRAFTABLE", to: "/reviews",
    ...over,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  getProactiveCases.mockResolvedValue({ items: [], total: 0, high: 0 });
  getInquiryRowsStrict.mockResolvedValue({ from: null, to: null, channel: null, status: "UNANSWERED", order: "OLDEST", limit: 3, term: null, totalCount: 0, items: [] });
  getReviewDetailStrict.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe("§1 — the selected review is an object", () => {
  it("puts the customer's sentence in the biggest type, names the repeated problem, and offers the reply only where it is possible", () => {
    render(<MemoryRouter><ReviewDetailArtifact artifact={detail()} onPrompt={() => undefined} /></MemoryRouter>);

    const body = screen.getByTestId("review-detail-body");
    expect(body).toHaveTextContent("접착이 금방 떨어졌어요.");
    expect(body.className).toContain("text-lg");
    expect(screen.getByRole("link", { name: "접착력 부족" })).toHaveAttribute("href", "/memory/iss-1");
    expect(screen.getByRole("button", { name: "답글 초안" })).toBeTruthy();
    expect(getReviewDetailStrict).not.toHaveBeenCalled();
  });

  it("a channel with no reply flow gets no reply control — the card never offers a move the channel refuses", () => {
    render(<MemoryRouter><ReviewDetailArtifact artifact={detail({ replyCapability: "NOT_SUPPORTED" })} onPrompt={() => undefined} /></MemoryRouter>);
    expect(screen.queryByRole("button", { name: "답글 초안" })).toBeNull();
    render(<MemoryRouter><ReviewDetailArtifact artifact={detail({ artifactId: "a2", replyCapability: "UNKNOWN" })} onPrompt={() => undefined} /></MemoryRouter>);
    expect(screen.queryByRole("button", { name: "답글 초안" })).toBeNull();
  });

  it("a reloaded thread re-reads the body from the exact endpoint rather than keeping a second copy of it", async () => {
    getReviewDetailStrict.mockResolvedValue({ ...detail(), body: "접착이 금방 떨어졌어요." });
    const { body: _b, ...withoutBody } = detail();

    render(<MemoryRouter><ReviewDetailArtifact artifact={withoutBody as ReviewDetail} /></MemoryRouter>);

    await waitFor(() => expect(getReviewDetailStrict).toHaveBeenCalledWith("r-2"));
    expect(await screen.findByTestId("review-detail-body")).toHaveTextContent("접착이 금방 떨어졌어요.");
  });

  it("the context bar names the anchored review from its own card — the closed facts, never the customer's words", () => {
    const turns = [{ turnId: "t1", conversationId: "c", role: "AGENT", message: "", artifacts: [detail()], suggestedActions: [], status: "DONE", createdAt: "x" } as unknown as TurnView];
    const set = { kind: "REVIEWS", label: "선택한 리뷰", count: 1, ids: ["r-2"], filters: {}, productIds: ["p-1"], workItemIds: [], selectedObject: { kind: "REVIEW", id: "r-2", productId: "p-1", channelCode: "CAFE24" }, turnId: "t1" } as unknown as WorkingSetView;

    const context = currentContext(set, null, turns);

    expect(context).toMatchObject({ kind: "ANCHOR", label: "선택한 리뷰", clearable: true });
    expect(context?.meta).toContain("논슬립 주방 매트");
    expect(context?.meta).not.toContain("접착이 금방");
  });
});

describe("§2 — three first-use mornings", () => {
  it("derives the state from the channel table, and the delegable work from what those channels offer", () => {
    expect(homeFirstUseState([NOT_CONNECTED])).toMatchObject({ kind: "NO_CHANNEL", connected: [], observed: false });
    expect(homeFirstUseState([CONNECTED_EMPTY])).toMatchObject({ kind: "NO_DATA", connected: ["카페24"], observed: false });
    // 「가져왔지만 아무것도 없다」 means nothing held — the backlog counter too, which is windowless and
    // is what tells a shop holding year-old inquiries apart from one holding none (Outcome v1 §1).
    expect(homeFirstUseState([row({ reviewState: "ZERO", reviews: 0, orders: 0, inquiries: 0, unansweredInquiries: 0, orderState: "ZERO", inquiryState: "ZERO" })]))
      .toMatchObject({ kind: "NO_DATA", observed: true });
    // Records older than the window are still records: the shop is not empty and must not be told it is.
    expect(homeFirstUseState([row({ reviewState: "ZERO", reviews: 0, orders: 0, inquiries: 0, unansweredInquiries: 3, orderState: "ZERO", inquiryState: "OBSERVED_FRESHNESS_UNPROVEN" })]))
      .toMatchObject({ kind: "WORKING" });
    expect(homeFirstUseState([row()])).toMatchObject({ kind: "WORKING" });
    // A data type this product cannot collect on any channel is never promised.
    const naverOnly = row({ channelCode: "NAVER", channelNameKo: "네이버", reviewState: "NOT_SUPPORTED", reviews: 0 });
    expect(homeFirstUseState([naverOnly]).delegable).toEqual(["ORDER", "INQUIRY"]);
    expect(delegableSentence(homeFirstUseState([naverOnly]))).toContain("주문 · 문의");
    expect(noDataSentence(homeFirstUseState([CONNECTED_EMPTY]))).toContain("첫 수집이 끝나면");
  });

  it("before the first connection: what connecting hands over, and exactly one next action — no briefing", async () => {
    getOverviewStrict.mockResolvedValue(overview([NOT_CONNECTED]));
    renderHome();

    const lead = await screen.findByTestId("first-use-no-channel");
    expect(lead).toHaveTextContent("판매 채널을 연결하면 시작할 수 있습니다.");
    expect(lead).toHaveTextContent("대신 확인하고");
    expect(screen.getByRole("link", { name: "채널 연결하기" })).toHaveAttribute("href", "/connect");
    // The opener never claims there is nothing to check: nothing has been read.
    expect(screen.queryByText(/지금 먼저 확인할 일은 없습니다/)).toBeNull();
  });

  it("connected but empty: says the collection has not landed yet — never 「확인할 일 없음」", async () => {
    getOverviewStrict.mockResolvedValue(overview([CONNECTED_EMPTY]));
    renderHome();

    const lead = await screen.findByTestId("first-use-no-data");
    expect(lead).toHaveTextContent("카페24 연결은 끝났습니다.");
    expect(screen.queryByTestId("first-use-no-channel")).toBeNull();
    expect(screen.queryByText(/지금 먼저 확인할 일은 없습니다/)).toBeNull();
  });

  it("with rows, neither first-use lead is drawn and the ordinary brief runs", async () => {
    getOverviewStrict.mockResolvedValue(overview([row()]));
    renderHome();

    await waitFor(() => expect(screen.queryByLabelText("오늘 상태")).toBeTruthy());
    expect(screen.queryByTestId("first-use-no-channel")).toBeNull();
    expect(screen.queryByTestId("first-use-no-data")).toBeNull();
  });
});

describe("§3 — a repeated title is declared, not guessed", () => {
  it("titleSaid suppresses the header even when the sentence never contained the title", () => {
    const { container } = render(
      <ArtifactCard title="가장 오래 기다린 문의" headline="가장 오래 기다린 것부터 보여드릴게요." titleSaid><p>rows</p></ArtifactCard>,
    );
    expect(container.querySelector("h3")).toBeNull();
    // …and the section keeps its accessible name: what is dropped is the second rendering, not the fact.
    expect(screen.getByLabelText("가장 오래 기다린 문의")).toBeTruthy();
  });

  it("without the declaration the containment fallback still stands, so nothing regresses for producers that have not declared", () => {
    const said = render(<ArtifactCard title="오늘 리뷰" headline="오늘 리뷰는 3건입니다."><p>a</p></ArtifactCard>);
    expect(said.container.querySelector("h3")).toBeNull();
    const notSaid = render(<ArtifactCard title="오늘 리뷰" headline="확인한 내용입니다."><p>a</p></ArtifactCard>);
    expect(notSaid.container.querySelector("h3")?.textContent).toBe("오늘 리뷰");
  });
});
