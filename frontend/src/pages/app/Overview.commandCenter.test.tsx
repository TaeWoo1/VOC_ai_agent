// @vitest-environment jsdom
/**
 * <b>The home screen as a command center</b> (Agent Command Center v1, regressions E · F · G).
 *
 * <p>Three claims, and each of them is the difference between an operations product and a chatbot
 * with a dashboard bolted on: the Agent speaks first, a list request comes back as a LIST, and a
 * sentence asking to send something reaches nothing that can send.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Overview } from "./Overview";
import type { MetricKpi, OverviewResponse } from "../../lib/types";

const getOverviewStrict = vi.fn();
const getInquiryQueueStrict = vi.fn();
const getProactiveCases = vi.fn();
const getReviewIssuesStrict = vi.fn();
const confirmInquiryPublish = vi.fn();
const navigate = vi.fn();

vi.mock("../../lib/apiClient", () => ({
  api: {
    getOverviewStrict: (d?: number) => getOverviewStrict(d),
    getInquiryQueueStrict: (p: unknown) => getInquiryQueueStrict(p),
    getProactiveCases: (n?: number) => getProactiveCases(n),
    getReviewIssuesStrict: () => getReviewIssuesStrict(),
    markProactiveCaseOpened: vi.fn(),
    confirmInquiryPublish: (...a: unknown[]) => confirmInquiryPublish(...a),
  },
  getToken: () => null,
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigate };
});

function kpi(key: string, label: string, value: number, comparable = true): MetricKpi {
  return {
    key, label, value, unit: "건",
    previousValue: comparable ? 0 : null,
    deltaPercent: null, comparable, excludedChannels: 0, freshnessUnproven: false,
  } as MetricKpi;
}

function overview(): OverviewResponse {
  return {
    metrics: {
      period: { from: "2026-08-21", to: "2026-08-27", previousFrom: "2026-08-14", previousTo: "2026-08-20", days: 7 },
      revenueBasis: "결제 완료 기준",
      orderCountBasis: "주문 건수 기준",
      kpis: [
        kpi("orders", "주문", 12),
        kpi("unansweredInquiries", "미답변 문의", 22, false),
        kpi("negativeReviews", "부정 리뷰", 3),
        kpi("inquiries", "문의", 5),
      ],
      series: [],
      channels: [],
      exclusions: [],
      exampleDataIncluded: false,
    },
    insights: [
      {
        key: "INQUIRY_BACKLOG", severity: "ATTENTION",
        title: "답변이 필요한 문의 22건", detail: "카페24 자사몰 21건이 가장 많습니다.",
        to: "/inquiries", actionLabel: "문의 열기", agentGoal: null,
      },
    ],
  };
}

beforeEach(() => {
  getOverviewStrict.mockResolvedValue(overview());
  getProactiveCases.mockResolvedValue({ items: [], total: 0, high: 0 });
  getInquiryQueueStrict.mockResolvedValue({
    content: [
      {
        workItemId: "w1", inquiryId: "i1", sellerAccountId: "s1", channelId: "c1",
        channelCode: "CAFE24", channelNameKo: "카페24 자사몰", productId: null, productName: null,
        phase: "PROPOSED", status: "UNANSWERED", title: "배송 언제 되나요?",
        receivedAt: "2026-08-26T00:00:00Z",
      },
    ],
    page: 0, size: 5, totalElements: 1, totalPages: 1,
  });
  getReviewIssuesStrict.mockResolvedValue([]);
});

afterEach(() => vi.clearAllMocks());

function renderHome() {
  return render(
    <MemoryRouter>
      <Overview />
    </MemoryRouter>,
  );
}

describe("home — the Agent goes first", () => {
  it("E — the briefing is stated before the dashboard numbers", async () => {
    const { container } = renderHome();

    const headline = await screen.findByText("오늘 먼저 확인하면 좋은 일이 2개 있습니다.");
    const numbers = container.querySelector('[aria-label="오늘 상태"]')!;
    // Position in the document, not in the source: whichever comes first is what a seller reads.
    expect(headline.compareDocumentPosition(numbers) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("§1-A — the greeting and the command box open the screen, above the work and the numbers", async () => {
    const { container } = renderHome();

    const headline = await screen.findByText("오늘 먼저 확인하면 좋은 일이 2개 있습니다.");
    const command = container.querySelector("#home-command")!;
    const prepared = container.querySelector('[aria-label="준비된 답변 초안"]')!;
    const numbers = container.querySelector('[aria-label="오늘 상태"]')!;

    // The defect this closes: the input shipped BELOW the six-figure grid, which put the one control
    // a chat-first product is named for off the first screen at 125%.
    const after = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(after(headline, command)).toBe(true);
    expect(after(command, prepared)).toBe(true);
    expect(after(prepared, numbers)).toBe(true);
  });

  it("E — it counts what is on the screen, in seller language", async () => {
    renderHome();

    // 1 prepared draft + 0 proactive + 1 finding.
    await screen.findByText("오늘 먼저 확인하면 좋은 일이 2개 있습니다.");
    expect(screen.getByText("답변 초안을 준비해 둔 문의 1건")).toBeInTheDocument();
    expect(screen.getByText("답변이 필요한 문의 22건")).toBeInTheDocument();
    // Never the vocabulary of our own data model.
    expect(screen.queryByText(/proactive|PROPOSED|NO_ANSWER_BASIS|case/i)).toBeNull();
  });

  it("prepared work links to the inquiry, and says it was not sent anywhere", async () => {
    renderHome();

    const row = await screen.findByRole("link", { name: /배송 언제 되나요/ });
    expect(row).toHaveAttribute("href", "/inquiries/i1");
    expect(screen.getByText(/아직 아무 곳에도 보내지 않았습니다/)).toBeInTheDocument();
  });

  it("a quiet morning gets a sentence, not an empty screen", async () => {
    getInquiryQueueStrict.mockResolvedValue({ content: [], page: 0, size: 5, totalElements: 0, totalPages: 0 });
    getOverviewStrict.mockResolvedValue({ ...overview(), insights: [] });
    renderHome();

    await screen.findByText("지금 먼저 확인할 일은 없습니다.");
  });
});

describe("home — the command box answers with objects", () => {
  it("F — a list request renders a list, not a paragraph", async () => {
    const user = userEvent.setup();
    renderHome();
    await screen.findByText("오늘 먼저 확인하면 좋은 일이 2개 있습니다.");

    await user.click(screen.getByRole("button", { name: "미답변 문의 보여줘" }));

    const result = await screen.findByTestId("command-result");
    expect(within(result).getByText("답변이 필요한 문의")).toBeInTheDocument();
    // The count is the KPI the seller can already see — not a second read that could disagree.
    expect(within(result).getByText("22건")).toBeInTheDocument();
    await waitFor(() =>
      expect(within(result).getByRole("link", { name: /배송 언제 되나요/ })).toHaveAttribute(
        "href",
        "/inquiries/i1",
      ),
    );
  });

  it("§2/§14-D — nothing to flag means no section and no invented work", async () => {
    renderHome();
    await screen.findByText("오늘 먼저 확인하면 좋은 일이 2개 있습니다.");

    // Zero open cases is a correct state and gets no large empty panel announcing itself. The
    // greeting counts what is rendered — 1 prepared + 0 + 1 finding — so an absent section is
    // absent from the number too, and nothing anywhere manufactures a case to fill the space.
    expect(screen.queryByLabelText("AI가 먼저 확인한 일")).toBeNull();
    expect(screen.queryByText(/확인 중|분석 중|준비 중/)).toBeNull();
  });

  it("§14-E — a recognised command reaches no planner and leaves the page", async () => {
    const user = userEvent.setup();
    renderHome();
    await screen.findByText("오늘 먼저 확인하면 좋은 일이 2개 있습니다.");

    await user.type(screen.getByLabelText("무엇을 도와드릴까요?"), "미답변 문의 보여줘");
    await user.click(screen.getByRole("button", { name: "물어보기" }));

    // Deterministic navigation over objects that already exist: no run is started, no model is
    // called, and the seller does not leave the screen they asked from. The `/agent` handover is
    // what an UNRECOGNISED sentence gets, and only that.
    await screen.findByText("답변이 필요한 문의");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("G — 「답변 보내줘」 sends nothing; it reaches the Agent", async () => {
    const user = userEvent.setup();
    renderHome();
    await screen.findByText("오늘 먼저 확인하면 좋은 일이 2개 있습니다.");

    await user.type(screen.getByLabelText("무엇을 도와드릴까요?"), "이 문의 답변 보내줘");
    await user.click(screen.getByRole("button", { name: "물어보기" }));

    expect(confirmInquiryPublish).not.toHaveBeenCalled();
    expect(screen.queryByTestId("command-result")).toBeNull();
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining("/agent?goal="));
  });

  it("an unrecognised question is handed over rather than half-answered", async () => {
    const user = userEvent.setup();
    renderHome();
    await screen.findByText("오늘 먼저 확인하면 좋은 일이 2개 있습니다.");

    await user.type(screen.getByLabelText("무엇을 도와드릴까요?"), "이번 달 매출이 왜 줄었어");
    await user.click(screen.getByRole("button", { name: "물어보기" }));

    expect(screen.queryByTestId("command-result")).toBeNull();
    expect(navigate).toHaveBeenCalled();
  });
});
