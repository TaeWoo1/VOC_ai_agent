// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HomeV2 } from "./HomeV2";
import { HOME_REVIEW_OPS_COPY } from "../../lib/actionWindow/copy";
import { expectNoAxeViolations } from "../../test/axe";
import type { FeedItem } from "../../lib/types";

const getInboxStrict = vi.fn();
const getItemAnalysisStrict = vi.fn();
const getReviewIssuesStrict = vi.fn();
const getChannelsStrict = vi.fn();
const getConnectorAlertsStrict = vi.fn();

vi.mock("../../lib/apiClient", () => ({
  api: {
    getInboxStrict: () => getInboxStrict(),
    getItemAnalysisStrict: () => getItemAnalysisStrict(),
    getReviewIssuesStrict: () => getReviewIssuesStrict(),
    getChannelsStrict: () => getChannelsStrict(),
    getConnectorAlertsStrict: () => getConnectorAlertsStrict(),
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
      feedItem({ id: "i1", type: "INQUIRY", status: "UNANSWERED" }),
      feedItem({ id: "r1", type: "REVIEW", status: "NEGATIVE", rating: 1 }),
      feedItem({ id: "r2", type: "REVIEW", status: "NORMAL", rating: 5 }),
    ],
    total: 3,
  });
  getItemAnalysisStrict.mockResolvedValue([]);
  getReviewIssuesStrict.mockResolvedValue([]);
  getChannelsStrict.mockResolvedValue([]);
  getConnectorAlertsStrict.mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("운영 홈 — three zones", () => {
  it("renders 확인 필요 / 진행 중 / 연결 상태 and nothing else", async () => {
    renderHome();
    expect(await screen.findByRole("heading", { name: "확인 필요" })).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: HOME_REVIEW_OPS_COPY.sectionTitle }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "연결 상태" })).toBeInTheDocument();
  });

  it("leads with the seller's question, not a dashboard title", async () => {
    renderHome();
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(
      "오늘 확인할 고객 신호",
    );
  });

  it("omits 이번 주 흐름 — no metric nobody has verified is derivable", async () => {
    renderHome();
    await screen.findByRole("heading", { name: "확인 필요" });
    expect(screen.queryByText(/이번 주 흐름/)).toBeNull();
  });
});

describe("운영 홈 — counts are measured, never invented", () => {
  it("shows real counts once the reads land", async () => {
    renderHome();
    const reply = await screen.findByRole("link", { name: /답변이 필요한 문의/ });
    expect(reply).toHaveTextContent("1");
    const check = screen.getByRole("link", { name: /확인이 필요한 리뷰/ });
    expect(check).toHaveTextContent("1");
  });

  it("says 자료를 연결하면 표시됩니다 — not 0 — before anything has arrived", async () => {
    getInboxStrict.mockResolvedValue({ items: [], total: 0 });
    renderHome();
    const reply = await screen.findByRole("link", { name: /답변이 필요한 문의/ });
    expect(reply).toHaveTextContent("자료를 연결하면 표시됩니다");
    expect(reply.textContent).not.toMatch(/\d/);
  });

  it("says 지금은 확인할 수 없습니다 — not 0 — when a read fails", async () => {
    getInboxStrict.mockRejectedValue(new Error("down"));
    renderHome();
    const reply = await screen.findByRole("link", { name: /답변이 필요한 문의/ });
    expect(reply).toHaveTextContent("지금은 확인할 수 없습니다");
    expect(reply.textContent).not.toMatch(/\d/);
  });

  it("reports recurring issues as unavailable when their strict read fails", async () => {
    getReviewIssuesStrict.mockRejectedValue(new Error("no backend"));
    renderHome();
    const issues = await screen.findByRole("link", { name: /반복되는 고객 문제/ });
    expect(issues).toHaveTextContent("지금은 확인할 수 없습니다");
  });
});

describe("운영 홈 — connection zone", () => {
  it("never claims all connections are healthy", async () => {
    renderHome();
    await screen.findByRole("heading", { name: "연결 상태" });
    expect(screen.queryByText(/모두 정상/)).toBeNull();
    expect(screen.queryByText(/정상입니다/)).toBeNull();
  });

  it("offers a way into connection management", async () => {
    renderHome();
    expect(await screen.findByRole("link", { name: "연결 관리" })).toHaveAttribute(
      "href",
      "/connect",
    );
  });
});

describe("운영 홈 — agent assist is fail-closed", () => {
  it("renders no agent action when the runtime did not answer", async () => {
    renderHome();
    await screen.findByRole("heading", { name: "확인 필요" });
    expect(screen.queryByRole("link", { name: /운영 에이전트/ })).toBeNull();
    // Not a disabled button either — an unusable control costs more trust than an absent one.
    expect(screen.queryByRole("button", { name: /운영 에이전트/ })).toBeNull();
    expect(screen.queryByText(/준비 중/)).toBeNull();
  });

  it("offers the agent action only once the runtime is reachable", async () => {
    agentReachable.mockReturnValue(true);
    renderHome();
    expect(await screen.findByRole("link", { name: "운영 에이전트로 정리" })).toHaveAttribute(
      "href",
      "/agent",
    );
  });
});

describe("운영 홈 — the preview leads into the inbox", () => {
  it("deep-links each previewed row to its inbox item", async () => {
    renderHome();
    await screen.findByRole("heading", { name: "확인 필요" });
    const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(hrefs).toContain("/inbox/i1");
    expect(hrefs).toContain("/inbox/r1");
    // The calm review is not previewed — the zone is what needs a person, not a feed.
    expect(hrefs).not.toContain("/inbox/r2");
  });
});

describe("운영 홈 — accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = renderHome();
    await screen.findByRole("heading", { name: "확인 필요" });
    await expectNoAxeViolations(container);
  });
});
