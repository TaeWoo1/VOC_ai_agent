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
  // §1: the home brief reads the WORK QUEUE. Empty by default — a test that is about waiting work says so.
  getInquiryQueueStrict.mockResolvedValue({ content: [], page: 0, size: 5, totalElements: 0, totalPages: 0 });
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
    // §2: the strip's inquiry number is the same 「처리할 일」 the rest of the screen means.
    expect(numbers).toHaveTextContent("지금 처리할 일");
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

  /**
   * §1 — an empty QUEUE over held RECORDS is not an empty shop.
   *
   * The two are different questions with different answers (measured live: 10 actionable work items
   * against 21 unanswered records), so a brief that says 「지금 처리할 일은 없습니다」 has to name which one
   * it means or the sentence reads as a verdict on the records too.
   */
  it("no prepared cases + nothing actionable + records held ⇒ the brief names both, and confuses neither", async () => {
    getProactiveCases.mockResolvedValue({ items: [], total: 0, high: 0 });
    renderHome();
    expect(await screen.findByText(/지금 처리할 일은 없습니다/)).toBeInTheDocument();
    expect(screen.getByText(/문의 화면에서 볼 수 있습니다/)).toBeInTheDocument();
    expect(screen.queryByText(/새로 들어온 문의나 리뷰가 생기면/)).toBeNull();
    expect(screen.queryByText("AI가 먼저 확인한 일")).toBeNull();
  });

  it("§2: with work to name, the brief NAMES it and says the QUEUE's own count once", async () => {
    getProactiveCases.mockResolvedValue({ items: [], total: 0, high: 0 });
    getInquiryQueueStrict.mockResolvedValue({
      page: 0, size: 3, totalElements: 22, totalPages: 8,
      content: [
        { inquiryId: "i-1", workItemId: "w-1", sellerAccountId: "s", channelId: "c", channelCode: "NAVER", channelNameKo: "네이버 스마트스토어", productId: null, productName: null, phase: "OPEN", status: "UNANSWERED", title: "현금영수증 발행 부탁드립니다", receivedAt: "2026-07-22T00:00:00Z" },
        { inquiryId: "i-2", workItemId: "w-2", sellerAccountId: "s", channelId: "c", channelCode: "CAFE24", channelNameKo: "카페24 자사몰", productId: null, productName: null, phase: "OPEN", status: "UNANSWERED", title: "배송이 너무 늦습니다", receivedAt: "2026-07-30T00:00:00Z" },
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
    expect(screen.getByText(/지금 처리할 일이 22건 있습니다/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "처리할 일 22건 전체 보기" })).toHaveAttribute("href", "/inquiries?state=NEEDS_REPLY");
    // §5: the strip stops printing the number the brief is already saying one line below.
    expect(screen.queryByText("현재 미답변 문의")).toBeNull();
    expect(screen.getByText(/부정 리뷰/)).toBeInTheDocument();
  });

  it("§2: when the queue read fails the brief names no work and claims none", async () => {
    getProactiveCases.mockResolvedValue({ items: [], total: 0, high: 0 });
    getInquiryQueueStrict.mockRejectedValue(new Error("nope"));
    renderHome();
    // A failed read is not a zero: the brief says what it still knows (records are held) and never
    // reports 「처리할 일 0건」, which would be a claim about work it could not look at.
    expect(await screen.findByText(/지금 처리할 일은 없습니다/)).toBeInTheDocument();
    expect(screen.queryByText(/지금 처리할 일이 0건/)).toBeNull();
  });

  it("a genuinely quiet morning — no cases AND no waiting work — is the truthful zero", async () => {
    getProactiveCases.mockResolvedValue({ items: [], total: 0, high: 0 });
    const quiet = overview();
    quiet.metrics.kpis = quiet.metrics.kpis.map((k) =>
      k.key === "unansweredInquiries" || k.key === "negativeReviews" ? { ...k, value: 0 } : k,
    );
    // Truly quiet: no work AND no records held — otherwise the honest sentence is §1's, not this one.
    quiet.metrics.channels = quiet.metrics.channels.map((c) => ({ ...c, unansweredInquiries: 0 }));
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
    // The shortcut renders the work queue, so this test states its own row (the suite default is empty).
    getInquiryQueueStrict.mockResolvedValue({
      page: 0, size: 5, totalElements: 22, totalPages: 5,
      content: [{ workItemId: "w1", inquiryId: "i1", sellerAccountId: "s", channelId: "c", channelCode: "CAFE24", channelNameKo: "카페24 자사몰", productId: null, productName: null, phase: "OPEN", status: "UNANSWERED", title: "배송 언제 되나요?", receivedAt: "2026-08-26T00:00:00Z" }],
    });
    renderHome();
    await screen.findByText(/좋은 아침입니다/);
    await userEvent.type(screen.getByLabelText("무엇이든 물어보세요"), "미답변 문의 보여줘");
    await userEvent.keyboard("{Enter}");
    // ONE control per row (Frontend-first v1): the row IS the control, and the workspace link lives
    // inside the row it belongs to — opened by that press, not sitting beside every row as a third copy
    // of the same action.
    // Scoped to the shortcut's OWN turn: the home brief reads the same queue now (§1), so the row it
    // named is legitimately on screen too — this test is about what the shortcut answers.
    await screen.findByText("답변이 필요한 문의 22건");
    const turns = screen.getAllByTestId("agent-turn");
    const answer = turns[turns.length - 1]!;
    expect(within(answer).getByRole("button", { name: /배송 언제 되나요/ })).toBeInTheDocument();
    expect(within(answer).queryByRole("link", { name: "문의 화면에서 열기" })).toBeNull();
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
