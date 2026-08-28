// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AgentPanelProvider } from "../../lib/agentPanel";
import { ConversationProvider } from "../../lib/conversation/ConversationProvider";
import { AgentHome, greetingLine, contextStrip } from "./AgentHome";
import { agentTurn } from "../../test/conversationFixtures";
import type { MetricKpi, OverviewResponse } from "../../lib/types";

const getOverviewStrict = vi.fn();
const getProactiveCases = vi.fn();
const getInquiryQueueStrict = vi.fn();
const getReviewIssuesStrict = vi.fn();
vi.mock("../../../lib/bridge/localAgentHint", () => ({ probeLocalAgent: async () => "PAIRED" }));
vi.mock("../../lib/apiClient", () => ({
  api: {
    getOverviewStrict: (d?: number) => getOverviewStrict(d),
    getProactiveCases: (n?: number) => getProactiveCases(n),
    getInquiryQueueStrict: (p: unknown) => getInquiryQueueStrict(p),
    getReviewIssuesStrict: () => getReviewIssuesStrict(),
    getSyncRunsStrict: vi.fn(async () => []),
    markProactiveCaseOpened: vi.fn(),
  },
  getToken: () => null,
}));
vi.mock("../../lib/conversation/conversationClient", () => ({
  conversationClient: {
    createConversation: vi.fn(async () => ({ conversationId: "c-1", createdAt: "x" })),
    getConversation: vi.fn(),
    listConversations: vi.fn(async () => [{ conversationId: "c-old", createdAt: "x", updatedAt: "2026-08-27T08:00:00Z", turnCount: 4, headline: "지난 리뷰 확인" }]),
    sendTurn: vi.fn(),
  },
}));
import { conversationClient } from "../../lib/conversation/conversationClient";

function kpi(key: string, label: string, value: number, comparable = true, freshnessUnproven = false): MetricKpi {
  return { key, label, value, unit: "건", previousValue: comparable ? 0 : null, deltaPercent: null, comparable, excludedChannels: 0, freshnessUnproven };
}

function overview(over: Partial<OverviewResponse["metrics"]> = {}): OverviewResponse {
  return {
    metrics: {
      period: { from: "2026-08-21", to: "2026-08-27", previousFrom: "2026-08-14", previousTo: "2026-08-20", days: 7 },
      revenueBasis: "결제 완료 기준",
      orderCountBasis: "주문 건수 기준",
      kpis: [kpi("orders", "주문", 12), kpi("unansweredInquiries", "미답변 문의", 22, false), kpi("negativeReviews", "부정 리뷰", 3)],
      series: [{ key: "orders", label: "주문", unit: "건", points: [{ date: "2026-08-26", value: 5 }, { date: "2026-08-27", value: 4 }] }],
      channels: [{ channelCode: "CAFE24", channelNameKo: "카페24", orderState: "OBSERVED_FRESH", revenue: 1, orders: 1, countedInOrders: true, inquiryState: "OBSERVED_FRESH", inquiries: 1, unansweredInquiries: 1, countedInInquiries: true, reviewState: "OBSERVED_FRESH", reviews: 1, negativeReviews: 0, countedInReviews: true }],
      exclusions: [],
      exampleDataIncluded: false,
      ...over,
    },
    insights: [],
  };
}

const CASE = {
  id: "case-1", subjectKind: "INQUIRY", subjectId: "i-1", workItemId: "w-1", channelId: "ch", channelNameKo: "카페24 자사몰", productId: null, productName: null,
  snippet: "배송은 언제 되나요?", rating: null, priority: "HIGH", reason: "UNANSWERED", reasonNote: "답변 초안을 준비했습니다", evidenceState: null, evidenceCount: 1,
  knowledgeGap: null, preparedAction: "DRAFT_PREPARED", draftVersion: 1, recommendation: null, subjectReceivedAt: null, preparedAt: null,
};

const MORNING = new Date("2026-08-27T09:30:00+09:00");

function renderHome(now = MORNING) {
  return render(
    <MemoryRouter>
      <AgentPanelProvider>
        <ConversationProvider>
          <AgentHome now={now} />
        </ConversationProvider>
      </AgentPanelProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  getOverviewStrict.mockResolvedValue(overview());
  getProactiveCases.mockResolvedValue({ items: [CASE, { ...CASE, id: "case-2", subjectId: "i-2", snippet: "교환 가능한가요?" }], total: 2, high: 2 });
  getInquiryQueueStrict.mockResolvedValue({ content: [{ workItemId: "w1", inquiryId: "i1", sellerAccountId: "s", channelId: "c", channelCode: "CAFE24", channelNameKo: "카페24 자사몰", productId: null, productName: null, phase: "OPEN", status: "UNANSWERED", title: "배송 언제 되나요?", receivedAt: "2026-08-26T00:00:00Z" }], page: 0, size: 5, totalElements: 1, totalPages: 1 });
  getReviewIssuesStrict.mockResolvedValue([]);
  vi.mocked(conversationClient.sendTurn).mockReset();
});
afterEach(() => vi.clearAllMocks());

describe("greeting — arithmetic, never a model", () => {
  it("is the hour plus the count of what was prepared; zero gets its own sentence", () => {
    expect(greetingLine(9, 2)).toBe("좋은 아침입니다. 오늘 제가 먼저 확인한 일이 2개 있습니다.");
    expect(greetingLine(15, 0)).toBe("안녕하세요. 오늘 먼저 확인한 일은 없습니다.");
    expect(greetingLine(15, null)).toBe("안녕하세요.");
  });

  it("the context strip says 「오늘 주문」 only when the last point IS today", () => {
    const strip = contextStrip(overview(), MORNING);
    expect(strip.map((k) => k.label)).toEqual(["현재 미답변 문의", "오늘 주문", "최근 7일 부정 리뷰"]);
    expect(strip[1]!.value).toBe(4);
    const stale = contextStrip(overview(), new Date("2026-08-30T09:00:00+09:00"));
    expect(stale[1]!.label).toBe("최근 7일 주문");
    expect(stale[1]!.value).toBe(12);
  });
});

describe("home — the Agent operating workspace", () => {
  it("opens with the greeting, three numbers, and the prepared cases as the first agent turn", async () => {
    renderHome();
    expect(await screen.findByText("좋은 아침입니다. 오늘 제가 먼저 확인한 일이 2개 있습니다.")).toBeInTheDocument();
    const numbers = screen.getByLabelText("오늘 상태");
    expect(within(numbers).getByText("현재 미답변 문의")).toBeInTheDocument();
    expect(within(numbers).getByRole("link", { name: "자세한 숫자 보기" })).toHaveAttribute("href", "/overview");
    const turn = screen.getAllByTestId("agent-turn")[0]!;
    expect(within(turn).getByRole("link", { name: /배송은 언제 되나요/ })).toHaveAttribute("href", "/inquiries/i-1");
    expect(within(turn).getAllByText("답변 준비됨")).toHaveLength(2);
    expect(screen.getByRole("form", { name: "AI 담당자에게 요청" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "오늘의 운영" })).toBeInTheDocument();
    // Never our own vocabulary.
    expect(screen.queryByText(/proactive|PROPOSED|DRAFT_PREPARED|case/i)).toBeNull();
  });

  it("a quiet morning is a truthful zero, not an empty list", async () => {
    getProactiveCases.mockResolvedValue({ items: [], total: 0, high: 0 });
    renderHome();
    expect(await screen.findByText("좋은 아침입니다. 오늘 먼저 확인한 일은 없습니다.")).toBeInTheDocument();
    expect(screen.getByText(/새로 들어온 문의나 리뷰가 생기면/)).toBeInTheDocument();
    expect(screen.queryByText("AI가 먼저 확인한 일")).toBeNull();
  });

  it("before the first connection the greeting stops counting and offers the one thing to do", async () => {
    getOverviewStrict.mockResolvedValue(overview({ channels: [] }));
    renderHome();
    expect(await screen.findByText("판매 채널을 연결하면 시작할 수 있습니다.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "채널 연결하기" })).toHaveAttribute("href", "/connect");
    expect(screen.queryByLabelText("오늘 상태")).toBeNull();
  });

  it("an exact shortcut answers locally with an object; no turn is sent", async () => {
    renderHome();
    await screen.findByText(/좋은 아침입니다/);
    await userEvent.type(screen.getByLabelText("무엇이든 물어보세요"), "미답변 문의 보여줘");
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByRole("link", { name: /배송 언제 되나요/ })).toHaveAttribute("href", "/inquiries/i1");
    expect(screen.getByText("답변이 필요한 문의 22건")).toBeInTheDocument();
    expect(conversationClient.sendTurn).not.toHaveBeenCalled();
  });

  it("every other sentence goes to the runtime — a chip is a prompt the seller sends", async () => {
    vi.mocked(conversationClient.sendTurn).mockResolvedValue(agentTurn());
    renderHome();
    await screen.findByText(/좋은 아침입니다/);
    await userEvent.click(screen.getByRole("button", { name: "오늘 리뷰 뭐 들어왔어?" }));
    await waitFor(() => expect(conversationClient.sendTurn).toHaveBeenCalledTimes(1));
    expect(vi.mocked(conversationClient.sendTurn).mock.calls[0]![1].text).toBe("오늘 리뷰 뭐 들어왔어?");
    expect(await screen.findByText("이 상품에 미답변 문의는 없습니다.")).toBeInTheDocument();
  });

  it("「지난 대화」 lists earlier conversations and opens one", async () => {
    vi.mocked(conversationClient.getConversation).mockResolvedValue({ conversationId: "c-old", createdAt: "x", updatedAt: "x", turns: [agentTurn({ conversationId: "c-old", message: "지난 답변입니다." })], workingSet: null, pendingHumanAction: null, pendingPrepared: null });
    renderHome();
    await screen.findByText(/좋은 아침입니다/);
    await userEvent.click(screen.getByRole("button", { name: "지난 대화" }));
    await userEvent.click(await screen.findByRole("button", { name: /지난 리뷰 확인/ }));
    expect(await screen.findByText("지난 답변입니다.")).toBeInTheDocument();
    expect(window.localStorage.getItem("reviewnary.conversation.current")).toBe("c-old");
  });
});
