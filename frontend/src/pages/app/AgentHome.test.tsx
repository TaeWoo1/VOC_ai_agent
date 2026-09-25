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
const getOperationsHomeStrict = vi.fn();
const recordHomeOpened = vi.fn();
const getCustomerOperationsHome = vi.fn();
vi.mock("../../../lib/bridge/localAgentHint", () => ({ probeLocalAgent: async () => "PAIRED" }));
vi.mock("../../lib/apiClient", () => ({
  api: {
    getOverviewStrict: (d?: number) => getOverviewStrict(d),
    getProactiveCases: (n?: number) => getProactiveCases(n),
    getInquiryQueueStrict: (p: unknown) => getInquiryQueueStrict(p),
    getInquiryRowsStrict: (p: unknown) => getInquiryRowsStrict(p),
    getReviewIssuesStrict: () => getReviewIssuesStrict(),
    getOperationsHomeStrict: () => getOperationsHomeStrict(),
    getSyncRunsStrict: vi.fn(async () => []),
    markProactiveCaseOpened: vi.fn(),
    // The return-visit signal: fire-and-forget, awaited by nothing, rendered by nothing.
    recordHomeOpened: () => recordHomeOpened(),
    getCustomerOperationsHome: () => getCustomerOperationsHome(),
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
      channels: [{ channelCode: "CAFE24", channelNameKo: "카페24", orderState: "OBSERVED_FRESH", revenue: 1, orders: 1, countedInOrders: true, inquiryState: "OBSERVED_FRESH", inquiries: 1, unansweredInquiries: 1, countedInInquiries: true, countedInUnansweredNow: true, reviewState: "OBSERVED_FRESH", reviews: 1, negativeReviews: 0, countedInReviews: true, connected: true, connectable: true }],
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

/**
 * Operations Home's four areas, shaped like the live Demo Org: 15 reviews in 확인 필요 of which 13 are
 * undecided, 122 in 지켜보기, 20 repeated problems of which one is anybody's move.
 */
const HOME = {
  reviews: {
    needsAttentionUndecided: 13,
    needsAttentionTotal: 15,
    watchTotal: 122,
    rows: [
      {
        reviewId: "rev-1",
        accountId: "acc-1",
        channelCode: "NAVER",
        rating: 1,
        occurredOn: "2026-07-23",
        productName: "선바로 전선몰딩",
        quote: "상품페이지 설명에 혼선을 줍니다.",
      },
    ],
  },
  problems: {
    decidable: 1,
    observing: 19,
    rows: [
      {
        issue: {
          id: "iss-1",
          title: "접착 부족",
          aspect: "접착",
          problem: "부족",
          severity: "NORMAL",
          lifecycleState: "ACTING",
          lifecycleLabelKo: "조치 중",
          evidenceCount: 18,
          firstEvidenceOn: "2025-07-29",
          lastEvidenceOn: "2026-08-19",
          dominantProductId: "prod-1",
          dominantProductName: "선바로 전선몰딩",
          dismissed: false,
          extractorKind: "RULE_BASED",
          change: { kinds: [], labelsKo: [], highSurge: false, surgeWindowCount: 0, surgeBaselineWeekly: 0 },
        },
        context: {
          issueId: "iss-1",
          aspect: "접착",
          evidence: {
            totalEvidence: 18,
            byProduct: [{
              productId: "prod-1", productName: "선바로 전선몰딩", evidenceCount: 16,
              productReviews: 1761, firstOccurredOn: "2025-07-29", lastOccurredOn: "2026-08-19",
            }],
            unattributedEvidence: 0,
            ratingDistribution: { rating1: 0, rating2: 0, rating3: 3, rating4: 5, rating5: 10, unrated: 0 },
            firstEvidenceOn: "2025-07-29",
            lastEvidenceOn: "2026-08-19",
          },
          knowledge: {
            productId: "prod-1", productName: "선바로 전선몰딩", productSources: 3, productMentions: 2,
            orgSources: 2, orgMentions: 0, excerpts: [],
          },
        },
      },
    ],
  },
  collection: [{
    channelCode: "NAVER", channelNameKo: "네이버 스마트스토어", dataType: "REVIEW",
    state: "OBSERVED_FRESH", supported: true, verificationStatus: null, connected: true,
    connectionStatus: "CONNECTED", routineEnabled: true, routinePausedBy: null,
    lastSuccessfulSyncAt: "2026-09-08T03:06:57Z", rows: 100, openRows: 3,
    newestObservedAt: "2026-09-08T03:00:00Z",
  }],
  prepared: {
    reviewRepliesApproved: 4,
    inquiryDraftsReady: 2,
    rows: [{ kind: "REVIEW_REPLY", id: "rev-9", label: "승인된 리뷰 답변", detail: "선바로 전선몰딩", channelCode: "NAVER", to: "/reviews/reply/rev-9" }],
  },
} as never;

beforeEach(() => {
  window.localStorage.clear();
  getOverviewStrict.mockResolvedValue(overview());
  getProactiveCases.mockResolvedValue({ items: [CASE, { ...CASE, id: "case-2", subjectId: "i-2", snippet: "교환 가능한가요?" }], total: 2, high: 2 });
  // §1: the home brief reads the WORK QUEUE. Empty by default — a test that is about waiting work says so.
  getInquiryQueueStrict.mockResolvedValue({ content: [], page: 0, size: 5, totalElements: 0, totalPages: 0 });
  getOperationsHomeStrict.mockResolvedValue(HOME);
  recordHomeOpened.mockResolvedValue(undefined);
  // 고객 운영 관리 not opened for the org by default: the Home stays the conversation-first Home these suites describe.
  getCustomerOperationsHome.mockResolvedValue({ available: false });
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
    // <b>The order the sentence names must be the order the read made</b> (Pilot QA, 2026-09-06).
    // `getInquiryQueueStrict` returns the queue newest-first (`Sort.DESC createdAt`), and the brief
    // used to promise 「가장 오래 기다린 것부터」 over it — on the live org that named three inquiries
    // from the last four days while twenty had waited since 2016. The fixture keeps that shape: i-1
    // waited LONGER than i-2, and the brief must not claim the rows are ordered by that.
    expect(screen.getByText(/최근에 들어온 것부터/)).toBeInTheDocument();
    expect(screen.queryByText(/가장 오래 기다린 것부터/)).toBeNull();
    // The old card said the same number a third time; it is gone, and so is the chip re-asking for it.
    expect(screen.queryByText("지금 기다리는 일")).toBeNull();
    expect(screen.queryByRole("button", { name: "답변 안 한 문의 보여줘" })).toBeNull();
    expect(screen.getByText(/지금 처리할 일이 22건 있습니다/)).toBeInTheDocument();
    // The queue's own screen, whose first section IS this queue. It used to point at
    // `?state=NEEDS_REPLY` — a parameter no screen reads — so the link opened the whole record and the
    // seller had to find the 22 among 94 (Secondary Workspaces UX Closure v1 §1).
    expect(screen.getByRole("link", { name: "처리할 일 22건 전체 보기" })).toHaveAttribute("href", "/inquiries");
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
    // 「답변이 필요한 문의」 is ONE question, so the heading, the count, the rows and the 전체 보기 all come
    // from the read that answers it — the record under `status=UNANSWERED`. It used to title the answer
    // with the overview KPI and fill it with the OPEN work queue: two different sets under one sentence.
    getInquiryRowsStrict.mockResolvedValue({
      totalCount: 22, limit: 5, productId: null,
      items: [{ workItemId: "w1", inquiryId: "i1", sellerAccountId: "s", channelId: "c", channelCode: "CAFE24", channelNameKo: "카페24 자사몰", productId: null, productName: null, phase: "OPEN", status: "UNANSWERED", title: "배송 언제 되나요?", receivedAt: "2026-08-26T00:00:00Z" }],
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

describe("Operations Home — 지금 확인할 것", () => {
  it("draws the four areas above the conversation", async () => {
    renderHome();
    const areas = await screen.findByLabelText("오늘 확인할 것");
    expect(within(areas).getByLabelText("지금 확인할 리뷰")).toBeInTheDocument();
    expect(within(areas).getByLabelText("반복 문제")).toBeInTheDocument();
    expect(within(areas).getByLabelText("최근 수집 상태")).toBeInTheDocument();
    expect(within(areas).getByLabelText("준비된 작업")).toBeInTheDocument();
  });

  /**
   * The distinction the whole screen turns on. 13 is what asks for work; 15 is the size of the tier;
   * 122 is an observation. None of them is added to another — 13+122 and 15+122 describe nothing.
   */
  it("asks with the undecided count and keeps 지켜보기 as a separate observation", async () => {
    renderHome();
    const area = await screen.findByLabelText("지금 확인할 리뷰");
    expect(within(area).getByText(/판단하지 않은 리뷰가 13건/)).toBeInTheDocument();
    expect(within(area).getByText(/지켜보는 리뷰가 122건/)).toBeInTheDocument();
    expect(area.textContent ?? "").not.toContain("135");
    expect(area.textContent ?? "").not.toContain("137");
  });

  it("opens each review in the decision workspace", async () => {
    renderHome();
    const area = await screen.findByLabelText("지금 확인할 리뷰");
    expect(within(area).getByText(/상품페이지 설명에 혼선을 줍니다/)).toBeInTheDocument();
    expect(within(area).getByRole("link", { name: /상품페이지 설명에 혼선을 줍니다/ }))
      .toHaveAttribute("href", "/reviews/reply/rev-1");
  });

  /**
   * 관찰 중 problems are counted but never drawn as tasks: the sentence asks about the one that is
   * somebody's move, not the nineteen that are not.
   */
  it("asks only about repeated problems that are somebody's move", async () => {
    renderHome();
    const area = await screen.findByLabelText("반복 문제");
    expect(within(area).getByText(/판단이 필요한 반복 문제가 1건/)).toBeInTheDocument();
    expect(area.textContent ?? "").not.toContain("20건");
  });

  it("carries the denominator into the Home as a pair, never a rate", async () => {
    renderHome();
    const area = await screen.findByLabelText("반복 문제");
    expect(within(area).getByText(/리뷰 1,761건 중 16건이 이 문제를 말했습니다/)).toBeInTheDocument();
    expect(area.textContent ?? "").not.toMatch(/%|퍼센트|비율/);
    expect(within(area).getByRole("link", { name: /접착 부족/ })).toHaveAttribute("href", "/memory/iss-1");
  });

  /**
   * The collection area may say when a channel last collected and never how — no connector class, no
   * data-type token, no error code reaches a seller sentence.
   */
  it("reports collection without a provider technical name", async () => {
    renderHome();
    const area = await screen.findByLabelText("최근 수집 상태");
    expect(within(area).getByText(/마지막 수집 2026-09-08/)).toBeInTheDocument();
    expect(area.textContent ?? "").not.toMatch(/NAVER|ORDER_SUMMARY|REVIEW|GW\./);
  });

  it("names each prepared record separately and totals nothing", async () => {
    renderHome();
    const area = await screen.findByLabelText("준비된 작업");
    expect(within(area).getByText(/승인하신 리뷰 답변 4건/)).toBeInTheDocument();
    expect(within(area).getByText(/초안이 준비된 문의 2건/)).toBeInTheDocument();
    expect(area.textContent ?? "").not.toContain("6건");
  });

  /**
   * Four rows reading 「승인된 리뷰 답변」 are four links a seller cannot choose between — measured on
   * the live org before the row carried what distinguishes it.
   */
  it("tells one prepared row from the next", async () => {
    renderHome();
    const area = await screen.findByLabelText("준비된 작업");
    const link = within(area).getByRole("link", { name: /선바로 전선몰딩/ });
    expect(link).toHaveAttribute("href", "/reviews/reply/rev-9");
    expect(link.textContent ?? "").toContain("승인된 리뷰 답변");
  });

  /**
   * <b>A failed read draws nothing.</b> Rendering 「확인 필요 0건」 because a query timed out would tell
   * a seller their morning is clear on the strength of an error — and the conversation below, which is
   * a different read, must keep working.
   */
  it("draws no area when the read failed, and leaves the conversation alone", async () => {
    getOperationsHomeStrict.mockRejectedValue(new Error("down"));
    renderHome();
    await screen.findByRole("heading", { name: "오늘의 운영" });
    await waitFor(() => expect(screen.queryByLabelText("오늘 확인할 것")).toBeNull());
    expect(screen.queryByLabelText("지금 확인할 리뷰")).toBeNull();
  });

  /** Four empty headings would describe a product the seller has not started using. */
  it("draws nothing for an account with no work and nothing connected", async () => {
    getOperationsHomeStrict.mockResolvedValue({
      reviews: { needsAttentionUndecided: 0, needsAttentionTotal: 0, watchTotal: 0, rows: [] },
      problems: { decidable: 0, observing: 0, rows: [] },
      collection: [],
      prepared: { reviewRepliesApproved: 0, inquiryDraftsReady: 0, rows: [] },
    });
    renderHome();
    await screen.findByRole("heading", { name: "오늘의 운영" });
    await waitFor(() => expect(screen.queryByLabelText("오늘 확인할 것")).toBeNull());
  });
});

/**
 * The pilot's return-visit signal (Pilot Launch Readiness §2). Both properties are about the seller,
 * not the number: they must not be able to tell it happened, and it must not be able to hurt them.
 */
describe("return-visit signal", () => {
  it("is sent once when 홈 opens, with nothing in it", async () => {
    renderHome();
    await screen.findByRole("heading", { name: "오늘의 운영" });
    await waitFor(() => expect(recordHomeOpened).toHaveBeenCalledTimes(1));
    // No argument: the organisation is the token's and the day is the server's, so the page has no
    // way to claim who opened it or when — which is also why it has nothing to leak.
    expect(recordHomeOpened).toHaveBeenCalledWith();
  });

  it("renders the whole morning when the signal fails", async () => {
    recordHomeOpened.mockRejectedValue(new Error("measurement down"));
    renderHome();
    await screen.findByRole("heading", { name: "오늘의 운영" });
    // The areas the seller came for are drawn exactly as they are when the signal succeeds.
    expect(await screen.findByLabelText("지금 확인할 리뷰")).toBeTruthy();
  });
});

describe("Customer Operations v3.1 — the job's Home", () => {
  const CO = {
    available: true, eligible: true, status: "ACTIVE", cadenceMinutes: 120,
    lastCheckedAt: "2026-08-27T00:02:00Z", lastRunStatus: "SUCCESS", nextCheckAt: "2026-08-27T02:00:00Z",
    sources: [],
    decisions: { total: 1, rows: [{
      caseId: "k-1", subjectKind: "INQUIRY", channelNameKo: "카페24", title: "배송은 언제 되나요?", rating: null,
      reasonNote: "답변 대기", summary: "출고 기준이 등록돼 있습니다.", recommendedActionType: "REPLY_TO_CUSTOMER",
      recommendedAction: null, missingInformation: [], draftPrepared: true, decidedBy: "AGENT",
      openedAt: "2026-08-27T00:02:00Z", to: "/inquiries/i-1",
    }] },
    handled: { since: null, autoResolved: 5, monitoring: 1, draftsPrepared: 2, verifying: 0, rows: [], checked: 9 },
    gaps: { total: 0, rows: [] },
  };

  it("replaces the numbers line, the opener turn and the four areas — one list, no second copy of the same inquiry", async () => {
    getCustomerOperationsHome.mockResolvedValue(CO);
    getInquiryQueueStrict.mockResolvedValue({
      content: [{ workItemId: "w-1", inquiryId: "i-1", sellerAccountId: "a", channelId: "c", channelCode: "CAFE24", channelNameKo: "카페24",
        productId: null, productName: null, phase: "PROPOSED", status: "UNANSWERED", title: "배송은 언제 되나요?", snippet: null,
        receivedAt: "2026-08-26T23:00:00Z", hasDraft: true }],
      page: 0, size: 50, totalElements: 1, totalPages: 1,
    });
    renderHome();

    const card = await screen.findByTestId("today-summary");
    expect(card).toHaveTextContent("최근 24시간 자동 확인");
    expect(card).toHaveTextContent("9건");
    // 홈 → 오늘 (UI/UX v2 Phase 1, product-owner decision).
    expect(screen.getByRole("heading", { level: 1, name: "오늘" })).toBeInTheDocument();
    // The case and the queue row are the same inquiry: drawn once, as the case.
    const list = await screen.findByRole("list", { name: "확인할 일" });
    const hrefs = within(list).getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/customer-operations/cases/k-1");
    expect(hrefs).not.toContain("/inquiries/i-1");
    expect(within(list).getAllByText("배송은 언제 되나요?")).toHaveLength(1);
    // Nothing of the other Home is drawn beside it.
    expect(screen.queryByRole("region", { name: "오늘 상태" })).toBeNull();
    expect(screen.queryByText("AI가 먼저 확인한 일")).toBeNull();
    expect(screen.queryByText("지금 확인할 리뷰")).toBeNull();
    expect(screen.getByPlaceholderText("질문이나 지시를 입력하세요")).toBeInTheDocument();
  });
});

