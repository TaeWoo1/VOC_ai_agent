// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HomeV2 } from "./HomeV2";
import { expectNoAxeViolations } from "../../test/axe";
import type { ChannelResponse, ChannelReviewPageView, FeedItem, SellerAccountResponse } from "../../lib/types";

const getInboxStrict = vi.fn();
const getItemAnalysisStrict = vi.fn();
const getReviewIssuesStrict = vi.fn();
const getChannelsStrict = vi.fn();
const getSellerAccountsStrict = vi.fn();
const getConnectorAlertsStrict = vi.fn();
const getChannelReviewsStrict = vi.fn();

vi.mock("../../lib/apiClient", () => ({
  api: {
    getInboxStrict: () => getInboxStrict(),
    getItemAnalysisStrict: () => getItemAnalysisStrict(),
    getReviewIssuesStrict: () => getReviewIssuesStrict(),
    getChannelsStrict: () => getChannelsStrict(),
    getSellerAccountsStrict: () => getSellerAccountsStrict(),
    getConnectorAlertsStrict: () => getConnectorAlertsStrict(),
    getChannelReviewsStrict: (accountId: string, params: unknown) => getChannelReviewsStrict(accountId, params),
  },
  getToken: () => null,
}));

// The operations store opens transports; the honesty gate it feeds is what matters here.
vi.mock("../../hooks/useOperationsStore", () => ({
  useOperationsStore: () => ({ sourceMode: "mock", run: null }),
}));

const agentReachable = vi.fn(() => false);
vi.mock("../../hooks/useAgentAvailability", () => ({
  useAgentAvailability: () => agentReachable(),
}));

function feedItem(over: Partial<FeedItem> & Pick<FeedItem, "id" | "type">): FeedItem {
  return {
    channelNameKo: "채널 가",
    productName: "상품",
    snippet: "내용",
    rating: null,
    status: "NORMAL",
    receivedAt: "2026-08-03T10:00:00Z",
    ...over,
  } as FeedItem;
}

function channel(id: string, code: string, nameKo: string, status: ChannelResponse["status"] = "CONNECTED"): ChannelResponse {
  return {
    id,
    code,
    nameKo,
    status,
    dataBadges: [],
    lastSyncedAt: null,
    actionLabel: status === "RECONNECT_REQUIRED" ? "다시 연결하기" : "연결 관리",
    support: {
      autoCollectSupported: false,
      autoCollectDataTypes: [],
      fileUploadSupported: true,
      fileUploadDataTypes: [],
      connectionCheckSupported: false,
      credentialSetupSupported: false,
    },
  } as ChannelResponse;
}

function account(id: string, channelId: string): SellerAccountResponse {
  return { id, channelId, channelNameKo: "", alias: null, connectionStatus: "CONNECTED", lastSyncedAt: null, fileUpload: false };
}

function attentionPage(total: number, ids: string[]): ChannelReviewPageView {
  return {
    page: 0,
    size: 3,
    total,
    newCount: 0,
    lastImportAt: null,
    lastImportComplete: true,
    aiPilotEnabled: false,
    channel: { channelCode: "NAVER", aiTriage: true, originalLocate: "NONE", replySupported: true },
    triageSummary: { needsAttention: total, watch: 0, fyi: 0, aiAttention: 0, repeatedCategories: [] },
    items: ids.map((id, i) => ({
      id,
      writtenOn: `2026-08-1${i}`,
      rating: 1,
      negative: true,
      preview: "본문",
      productName: `상품 ${id}`,
      productId: null,
      vendorItemId: null,
      mediaCount: 0,
      textless: false,
      isNew: false,
      triage: { tier: "NEEDS_ATTENTION", reason: "1점", tags: [], recommendedAction: null },
      aiMark: null,
    })),
  } as ChannelReviewPageView;
}

function renderHome() {
  return render(
    <MemoryRouter>
      <HomeV2 />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  agentReachable.mockReturnValue(false);
  getInboxStrict.mockResolvedValue({
    items: [
      feedItem({ id: "i1", type: "INQUIRY", status: "UNANSWERED", productName: "케이블 몰딩" }),
      feedItem({ id: "i2", type: "INQUIRY", status: "ANSWERED" }),
      feedItem({ id: "r1", type: "REVIEW", status: "NEGATIVE", rating: 1 }),
    ],
    total: 3,
    unansweredInquiries: 1,
  });
  getItemAnalysisStrict.mockResolvedValue([]);
  getReviewIssuesStrict.mockResolvedValue([{ id: "iss1", dismissed: false }, { id: "iss2", dismissed: true }]);
  getChannelsStrict.mockResolvedValue([channel("nv", "NAVER", "네이버 스마트스토어"), channel("cp", "COUPANG", "쿠팡")]);
  getSellerAccountsStrict.mockResolvedValue([account("acc-nv", "nv"), account("acc-cp", "cp")]);
  getConnectorAlertsStrict.mockResolvedValue([]);
  getChannelReviewsStrict.mockImplementation(async (accountId: string) =>
    accountId === "acc-nv" ? attentionPage(12, ["r-nv-1", "r-nv-2"]) : attentionPage(3, ["r-cp-1"]),
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("홈 — Today Inbox answers the one question", () => {
  it("asks the question as its headline and lists exactly 리뷰 · 문의 · 연결", async () => {
    renderHome();
    expect(
      await screen.findByRole("heading", { level: 1, name: "오늘 확인하거나 조치할 일" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("확인이 필요한 리뷰")).toBeInTheDocument();
    expect(screen.getByText("답변이 필요한 문의")).toBeInTheDocument();
    expect(screen.getByText("확인이 필요한 연결")).toBeInTheDocument();
    // No 주문 item: the order model has no actionable state yet.
    expect(screen.queryByText(/주문/)).toBeNull();
  });
});

describe("홈 — every count is its destination's count", () => {
  it("리뷰: sums each account's attention-filtered total, and each channel share links to that exact filter", async () => {
    renderHome();
    const shares = await screen.findByRole("list", { name: "확인이 필요한 리뷰 채널별" });
    expect(within(shares).getByRole("link", { name: /네이버 스마트스토어/ })).toHaveAttribute(
      "href",
      "/reviews/acc-nv?tier=NEEDS_ATTENTION",
    );
    expect(within(shares).getByRole("link", { name: /네이버 스마트스토어/ })).toHaveTextContent("12");
    expect(within(shares).getByRole("link", { name: /쿠팡/ })).toHaveAttribute("href", "/reviews/acc-cp?tier=NEEDS_ATTENTION");
    expect(screen.getByText("15")).toBeInTheDocument();
    // Two accounts: no one screen shows 15, so the headline is not a link.
    expect(screen.queryByRole("link", { name: /확인이 필요한 리뷰 15/ })).toBeNull();
    // The read asked for the same filter the links open — the count and the destination agree by construction.
    expect(getChannelReviewsStrict).toHaveBeenCalledWith("acc-nv", expect.objectContaining({ tier: "NEEDS_ATTENTION" }));
    // Rows open the review on its own account.
    const rows = screen.getByRole("list", { name: "확인이 필요한 리뷰 목록" });
    expect(within(rows).getAllByRole("link").map((l) => l.getAttribute("href"))).toContain("/reviews/acc-nv?review=r-nv-1");
  });

  it("리뷰: links the headline when a single account holds the whole count", async () => {
    getSellerAccountsStrict.mockResolvedValue([account("acc-nv", "nv")]);
    renderHome();
    const headline = await screen.findByRole("link", { name: /확인이 필요한 리뷰 12/ });
    expect(headline).toHaveAttribute("href", "/reviews/acc-nv?tier=NEEDS_ATTENTION");
  });

  it("문의: shows the server's uncapped unanswered count and links to the state-filtered 문의 page and rows", async () => {
    getInboxStrict.mockResolvedValue({
      items: [feedItem({ id: "i1", type: "INQUIRY", status: "UNANSWERED", productName: "케이블 몰딩" })],
      total: 1,
      unansweredInquiries: 37,
    });
    renderHome();
    const headline = await screen.findByRole("link", { name: /답변이 필요한 문의 37/ });
    expect(getInboxStrict).toHaveBeenCalled();
    expect(headline).toHaveAttribute("href", "/inquiries?state=NEEDS_REPLY");
    const rows = screen.getByRole("list", { name: "답변이 필요한 문의 목록" });
    expect(within(rows).getByRole("link", { name: /케이블 몰딩/ })).toHaveAttribute("href", "/inquiries/i1");
  });

  it("연결: lists interrupted channels and open alerts, each pointing where it is handled", async () => {
    getChannelsStrict.mockResolvedValue([channel("nv", "NAVER", "네이버 스마트스토어", "RECONNECT_REQUIRED")]);
    getConnectorAlertsStrict.mockResolvedValue([
      { id: "al1", sellerAccountId: "acc-nv", channelId: "nv", channelNameKo: "네이버 스마트스토어", accountAlias: null, type: "AUTH_EXPIRED", severity: "WARNING", message: "연결 정보가 만료되었습니다", createdAt: "2026-08-10T00:00:00Z", acknowledgedAt: null },
    ]);
    renderHome();
    const rows = await screen.findByRole("list", { name: "확인이 필요한 연결 목록" });
    const hrefs = within(rows).getAllByRole("link").map((l) => l.getAttribute("href"));
    expect(hrefs).toEqual(["/connect", "/settings/alerts"]);
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});

describe("홈 — a number only when a number was measured", () => {
  it("says 자료를 연결하면 표시됩니다 — not 0 — before anything has arrived", async () => {
    getInboxStrict.mockResolvedValue({ items: [], total: 0, unansweredInquiries: 0 });
    getSellerAccountsStrict.mockResolvedValue([]);
    renderHome();
    const reply = await screen.findByRole("link", { name: /답변이 필요한 문의/ });
    expect(reply).toHaveTextContent("자료를 연결하면 표시됩니다");
    expect(reply.textContent).not.toMatch(/\d/);
    await waitFor(() => expect(screen.getAllByText("자료를 연결하면 표시됩니다")).toHaveLength(2));
  });

  it("says 지금은 확인할 수 없습니다 — not 0 — when a read fails", async () => {
    getInboxStrict.mockRejectedValue(new Error("down"));
    getChannelReviewsStrict.mockRejectedValue(new Error("down"));
    renderHome();
    const reply = await screen.findByRole("link", { name: /답변이 필요한 문의/ });
    expect(reply).toHaveTextContent("지금은 확인할 수 없습니다");
    expect(reply.textContent).not.toMatch(/\d/);
    // Both review accounts failed: unavailable, no invented zero.
    await waitFor(() => expect(screen.getAllByText("지금은 확인할 수 없습니다")).toHaveLength(2));
  });

  it("keeps the count from the review accounts that loaded and names the one that did not", async () => {
    getChannelReviewsStrict.mockImplementation(async (accountId: string) => {
      if (accountId === "acc-cp") throw new Error("down");
      return attentionPage(12, ["r-nv-1"]);
    });
    renderHome();
    expect(await screen.findByText("쿠팡은(는) 지금 확인할 수 없습니다.")).toBeInTheDocument();
    // The headline (single loaded account → a link) carries 12, and so does the share chip.
    expect(screen.getByRole("link", { name: /확인이 필요한 리뷰 12/ })).toHaveAttribute("href", "/reviews/acc-nv?tier=NEEDS_ATTENTION");
  });

  it("never claims all connections are healthy", async () => {
    renderHome();
    await screen.findByText("확인이 필요한 연결");
    expect(screen.queryByText(/모두 정상/)).toBeNull();
    expect(screen.queryByText(/정상입니다/)).toBeNull();
  });
});

describe("홈 — 참고 keeps memory and reports reachable without making them today's work", () => {
  it("counts recurring issues the operator has not set aside, and links memory and reports", async () => {
    renderHome();
    expect(await screen.findByRole("link", { name: "반복되는 고객 문제" })).toHaveAttribute("href", "/memory");
    expect(screen.getByText("1건")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "리포트" })).toHaveAttribute("href", "/reports");
  });

  it("reports recurring issues as unavailable when their strict read fails", async () => {
    getReviewIssuesStrict.mockRejectedValue(new Error("no backend"));
    renderHome();
    await screen.findByRole("link", { name: "반복되는 고객 문제" });
    expect(await screen.findAllByText("지금은 확인할 수 없습니다")).not.toHaveLength(0);
  });
});

describe("홈 — agent assist is fail-closed", () => {
  it("renders no agent action when the runtime did not answer", async () => {
    renderHome();
    await screen.findByRole("heading", { name: "오늘 할 일" });
    expect(screen.queryByRole("link", { name: /운영 에이전트/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /운영 에이전트/ })).toBeNull();
    expect(screen.queryByText(/준비 중/)).toBeNull();
  });

  it("offers the agent action only once the runtime is reachable", async () => {
    agentReachable.mockReturnValue(true);
    renderHome();
    expect(await screen.findByRole("link", { name: "운영 에이전트로 정리" })).toHaveAttribute("href", "/agent");
  });
});

describe("홈 — accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = renderHome();
    await screen.findByRole("list", { name: "확인이 필요한 리뷰 채널별" });
    await expectNoAxeViolations(container);
  });
});
