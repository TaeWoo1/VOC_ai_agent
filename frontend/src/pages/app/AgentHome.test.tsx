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
const getInquiryRowsStrict = vi.fn();
const getReviewIssuesStrict = vi.fn();
vi.mock("../../../lib/bridge/localAgentHint", () => ({ probeLocalAgent: async () => "PAIRED" }));
vi.mock("../../lib/apiClient", () => ({
  api: {
    getOverviewStrict: (d?: number) => getOverviewStrict(d),
    getProactiveCases: (n?: number) => getProactiveCases(n),
    getInquiryQueueStrict: (p: unknown) => getInquiryQueueStrict(p),
    getInquiryRowsStrict: (p: unknown) => getInquiryRowsStrict(p),
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
  // Working Context v1 §2: the brief names the oldest waiting inquiries. Empty by default —
  // the tests that care about the named rows set their own.
  getInquiryRowsStrict.mockResolvedValue({ from: null, to: null, channel: null, status: "UNANSWERED", order: "OLDEST", limit: 3, term: null, totalCount: 0, items: [] });
  vi.mocked(conversationClient.sendTurn).mockReset();
});
afterEach(() => vi.clearAllMocks());

describe("greeting — arithmetic, never a model", () => {
  it("is the hour plus the count of what was prepared; zero gets its own sentence", () => {
    expect(greetingLine(9, 2)).toBe("좋은 아침입니다. 오늘 제가 먼저 확인한 일이 2개 있습니다.");
    // §11: zero says only hello — whether anything is WAITING is the opener turn's sentence, computed
    // from the real workload, so the greeting can never contradict it.
    expect(greetingLine(15, 0)).toBe("안녕하세요.");
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
    // Agentic Experience v2 §4: once there IS a brief, the brief is the headline and the greeting
    // joins the numbers as one quiet line — the hello no longer restates what the brief says with
    // the work attached, and it never appears as the largest text on the page.
    const numbers = await screen.findByLabelText("오늘 상태");
    expect(numbers.tagName).toBe("P");
    expect(numbers).toHaveTextContent("좋은 아침입니다.");
    expect(numbers).not.toHaveTextContent("먼저 확인한 일이");
    expect(numbers).toHaveTextContent("현재 미답변 문의");
    expect(within(numbers).getByRole("link", { name: "자세한 숫자 보기" })).toHaveAttribute("href", "/overview");
    expect(screen.queryByText("새 대화")).toBeNull();
    expect(screen.queryByRole("button", { name: "지난 대화" })).toBeNull();
    const turn = screen.getAllByTestId("agent-turn")[0]!;
    expect(within(turn).getByRole("link", { name: /배송은 언제 되나요/ })).toHaveAttribute("href", "/inquiries/i-1");
    expect(within(turn).getAllByText("답변 준비됨")).toHaveLength(2);
    expect(screen.getByRole("form", { name: "AI 담당자에게 요청" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "오늘의 운영" })).toBeInTheDocument();
    // Never our own vocabulary.
    expect(screen.queryByText(/proactive|PROPOSED|DRAFT_PREPARED|case/i)).toBeNull();
  });

  it("no prepared cases + real waiting work ⇒ the opener names the workload, never 「없습니다」 (§11)", async () => {
    getProactiveCases.mockResolvedValue({ items: [], total: 0, high: 0 });
    renderHome();
    expect(await screen.findByText(/지금 확인이 필요한 일이 있습니다/)).toBeInTheDocument();
    expect(screen.getByText(/답변을 기다리는 문의 22건/)).toBeInTheDocument();
    expect(screen.queryByText(/새로 들어온 문의나 리뷰가 생기면/)).toBeNull();
    expect(screen.queryByText("AI가 먼저 확인한 일")).toBeNull();
  });

  it("§2: with rows to name, the brief NAMES them and says the count once — no 「기다리는 일」 card", async () => {
    getProactiveCases.mockResolvedValue({ items: [], total: 0, high: 0 });
    getInquiryRowsStrict.mockResolvedValue({
      from: null, to: null, channel: null, status: "UNANSWERED", order: "OLDEST", limit: 3, term: null, totalCount: 22,
      items: [
        { inquiryId: "i-1", workItemId: "w-1", sellerAccountId: "s", channelId: "c", channelCode: "NAVER", channelNameKo: "네이버 스마트스토어", productId: null, productName: null, phase: "OPEN", status: "UNANSWERED", title: "현금영수증 발행 부탁드립니다", snippet: "주문할 때 신청을 못 했는데…", receivedAt: "2026-07-22T00:00:00Z", answeredAt: null, sourceSubtype: null, executableIdentity: null },
        { inquiryId: "i-2", workItemId: "w-2", sellerAccountId: "s", channelId: "c", channelCode: "CAFE24", channelNameKo: "카페24 자사몰", productId: null, productName: null, phase: "OPEN", status: "UNANSWERED", title: "배송이 너무 늦습니다", snippet: "일주일이 넘었는데…", receivedAt: "2026-07-30T00:00:00Z", answeredAt: null, sourceSubtype: null, executableIdentity: null },
      ],
    });
    renderHome();
    // The work itself, not a link that says how much of it there is.
    expect(await screen.findByText("현금영수증 발행 부탁드립니다")).toBeInTheDocument();
    expect(screen.getByText("배송이 너무 늦습니다")).toBeInTheDocument();
    expect(screen.getByText(/가장 오래 기다린 것부터/)).toBeInTheDocument();
    // The old card said the same number a third time; it is gone, and so is the chip re-asking for it.
    expect(screen.queryByText("지금 기다리는 일")).toBeNull();
    expect(screen.queryByRole("button", { name: "답변 안 한 문의 보여줘" })).toBeNull();
    expect(screen.getByRole("link", { name: "문의 22건 전체 보기" })).toHaveAttribute("href", "/inquiries?state=NEEDS_REPLY");
    // §5: the strip stops printing the number the brief is already saying one line below.
    expect(screen.queryByText("현재 미답변 문의")).toBeNull();
    expect(screen.getByText(/부정 리뷰/)).toBeInTheDocument();
  });

  it("§2: when the rows read fails the brief falls back to the count it already has", async () => {
    getProactiveCases.mockResolvedValue({ items: [], total: 0, high: 0 });
    getInquiryRowsStrict.mockRejectedValue(new Error("nope"));
    renderHome();
    expect(await screen.findByText(/지금 확인이 필요한 일이 있습니다/)).toBeInTheDocument();
    expect(screen.getByText(/답변을 기다리는 문의 22건/)).toBeInTheDocument();
  });

  it("a genuinely quiet morning — no cases AND no waiting work — is the truthful zero", async () => {
    getProactiveCases.mockResolvedValue({ items: [], total: 0, high: 0 });
    const quiet = overview();
    quiet.metrics.kpis = quiet.metrics.kpis.map((k) =>
      k.key === "unansweredInquiries" || k.key === "negativeReviews" ? { ...k, value: 0 } : k,
    );
    getOverviewStrict.mockResolvedValue(quiet);
    renderHome();
    expect(await screen.findByText(/새로 들어온 문의나 리뷰가 생기면/)).toBeInTheDocument();
    expect(screen.queryByText(/확인이 필요한 일이 있습니다/)).toBeNull();
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
    // ONE control per row (Frontend-first v1): the row IS the control, and the workspace link lives
    // inside the row it belongs to — opened by that press, not sitting beside every row as a third copy
    // of the same action.
    expect(await screen.findByRole("button", { name: /배송 언제 되나요/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "문의 화면에서 열기" })).toBeNull();
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

  it("example prompts show only while the thread is empty; after the first message the thread speaks", async () => {
    vi.mocked(conversationClient.sendTurn).mockResolvedValue(agentTurn());
    renderHome();
    await screen.findByText(/좋은 아침입니다/);
    expect(screen.getByLabelText("예시 질문")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "오늘 리뷰 뭐 들어왔어?" }));
    await screen.findByText("이 상품에 미답변 문의는 없습니다.");
    expect(screen.queryByLabelText("예시 질문")).toBeNull();
    expect(screen.queryByLabelText("오늘의 브리핑")).toBeNull();
  });
});
