// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ReportsV2 } from "./ReportsV2";
import { expectNoAxeViolations } from "../../test/axe";
import type { FeedItem, ItemAnalysis, ReviewIssueView } from "../../lib/types";

const getReviewIssuesStrict = vi.fn();
const getInboxStrict = vi.fn();
const getItemAnalysisStrict = vi.fn();
const getSellerAccountsStrict = vi.fn();
const getChannelsStrict = vi.fn();
const getChannelReviewsStrict = vi.fn();

vi.mock("../../lib/apiClient", () => ({
  api: {
    getReviewIssuesStrict: () => getReviewIssuesStrict(),
    getInboxStrict: () => getInboxStrict(),
    getItemAnalysisStrict: () => getItemAnalysisStrict(),
    getSellerAccountsStrict: () => getSellerAccountsStrict(),
    getChannelsStrict: () => getChannelsStrict(),
    getChannelReviewsStrict: (accountId: string, params: unknown) => getChannelReviewsStrict(accountId, params),
  },
  getToken: () => null,
}));

const ISSUE: ReviewIssueView = {
  id: "issue-1",
  title: "접착력이 약하다는 이야기가 늘고 있어요",
  aspect: "접착",
  problem: "부착 후 떨어짐",
  severity: "HIGH",
  lifecycleState: "NEEDS_REVIEW",
  lifecycleLabelKo: "확인 필요",
  evidenceCount: 4,
  firstEvidenceOn: null,
  lastEvidenceOn: null,
  dominantProductId: null,
  dominantProductName: null,
  dismissed: false,
  extractorKind: "RULE_BASED",
  change: {
    kinds: ["SURGING"],
    labelsKo: ["증가 중"],
    highSurge: true,
    surgeWindowCount: 4,
    surgeBaselineWeekly: 0.6,
  },
};

const INBOX: FeedItem[] = [
  {
    id: "i1",
    type: "INQUIRY",
    channelNameKo: "채널",
    productName: "상품",
    snippet: "내용",
    rating: null,
    status: "UNANSWERED",
    receivedAt: "2026-08-03T00:00:00Z",
  },
  {
    id: "r1",
    type: "REVIEW",
    channelNameKo: "채널",
    productName: "상품",
    snippet: "내용",
    rating: 1,
    status: "NEGATIVE",
    receivedAt: "2026-08-03T00:00:00Z",
  },
];

const ANALYSES: ItemAnalysis[] = [
  {
    sourceType: "REVIEW",
    sourceId: "r1",
    summary: "요약",
    category: "분류",
    sentiment: "NEGATIVE",
    urgency: "NORMAL",
    recommendedAction: "FAQ 후보",
    analyzerKind: "RULE_BASED",
    analyzerName: "rule-based",
    analyzerVersion: "rules-v1",
    createdAt: "2026-08-03T00:00:00Z",
  },
];

function renderReports() {
  return render(
    <MemoryRouter>
      <ReportsV2 />
    </MemoryRouter>,
  );
}

function attentionPage(total: number) {
  return {
    page: 0, size: 1, total, newCount: 0, lastImportAt: null, lastImportComplete: true, aiPilotEnabled: false,
    channel: { channelCode: "NAVER", aiTriage: true, originalLocate: "NONE", replySupported: true },
    triageSummary: { needsAttention: total, watch: 0, fyi: 0, aiAttention: 0, repeatedCategories: [] },
    items: [],
  };
}

beforeEach(() => {
  getReviewIssuesStrict.mockResolvedValue([ISSUE]);
  getInboxStrict.mockResolvedValue({ items: INBOX, total: INBOX.length });
  getItemAnalysisStrict.mockResolvedValue(ANALYSES);
  getChannelsStrict.mockResolvedValue([
    { id: "nv", code: "NAVER", nameKo: "네이버 스마트스토어", status: "CONNECTED", dataBadges: [], lastSyncedAt: null, actionLabel: "", support: { autoCollectSupported: false, autoCollectDataTypes: [], fileUploadSupported: true, fileUploadDataTypes: [], connectionCheckSupported: false, credentialSetupSupported: false } },
  ]);
  getSellerAccountsStrict.mockResolvedValue([
    { id: "acc-nv", channelId: "nv", channelNameKo: "네이버 스마트스토어", alias: null, connectionStatus: "CONNECTED", lastSyncedAt: null, fileUpload: false },
  ]);
  getChannelReviewsStrict.mockResolvedValue(attentionPage(7));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("주간 고객운영 리포트 — composition", () => {
  it("renders the sections it can derive", async () => {
    renderReports();
    expect(
      await screen.findByRole("heading", { level: 1, name: "주간 고객운영 리포트" }),
    ).toBeInTheDocument();
    for (const section of [
      "이번 기간 요약",
      "확인이 필요한 문의·리뷰",
      "반복되는 고객 문제",
      "FAQ·상세페이지에서 다룰 후보",
    ]) {
      expect(await screen.findByRole("heading", { name: section })).toBeInTheDocument();
    }
  });

  it("reports real figures from the loaded sources", async () => {
    renderReports();
    const unanswered = await screen.findByRole("link", { name: /답변이 필요한 문의/ });
    expect(unanswered).toHaveTextContent("1");
    expect(unanswered).toHaveAttribute("href", "/inquiries?state=NEEDS_REPLY");
    expect(screen.getByRole("link", { name: /자주 나오는 질문/ })).toHaveTextContent("1");
  });

  it("counts 확인이 필요한 리뷰 by triage tier — the same number 홈 and 리뷰 show — not by the feed's rating", async () => {
    renderReports();
    const reviews = await screen.findByRole("link", { name: /확인이 필요한 리뷰/ });
    expect(reviews).toHaveTextContent("7");
    expect(reviews).toHaveAttribute("href", "/reviews/acc-nv?tier=NEEDS_ATTENTION");
    expect(getChannelReviewsStrict).toHaveBeenCalledWith("acc-nv", expect.objectContaining({ tier: "NEEDS_ATTENTION" }));
    expect(screen.getByText(/확인이 필요한 리뷰 7건/)).toBeInTheDocument();
  });

  it("splits the review figure into per-channel links when several accounts hold it", async () => {
    getChannelsStrict.mockResolvedValue([
      { id: "nv", code: "NAVER", nameKo: "네이버 스마트스토어", status: "CONNECTED", dataBadges: [], lastSyncedAt: null, actionLabel: "", support: { autoCollectSupported: false, autoCollectDataTypes: [], fileUploadSupported: true, fileUploadDataTypes: [], connectionCheckSupported: false, credentialSetupSupported: false } },
      { id: "cp", code: "COUPANG", nameKo: "쿠팡", status: "CONNECTED", dataBadges: [], lastSyncedAt: null, actionLabel: "", support: { autoCollectSupported: false, autoCollectDataTypes: [], fileUploadSupported: true, fileUploadDataTypes: [], connectionCheckSupported: false, credentialSetupSupported: false } },
    ]);
    getSellerAccountsStrict.mockResolvedValue([
      { id: "acc-nv", channelId: "nv", channelNameKo: "", alias: null, connectionStatus: "CONNECTED", lastSyncedAt: null, fileUpload: false },
      { id: "acc-cp", channelId: "cp", channelNameKo: "", alias: null, connectionStatus: "CONNECTED", lastSyncedAt: null, fileUpload: false },
    ]);
    getChannelReviewsStrict.mockImplementation(async (id: string) => attentionPage(id === "acc-nv" ? 7 : 4));
    renderReports();
    const shares = await screen.findByRole("list", { name: "확인이 필요한 리뷰 채널별" });
    expect(screen.queryByRole("link", { name: /확인이 필요한 리뷰/ })).toBeNull();
    expect(screen.getByRole("link", { name: /쿠팡/ })).toHaveAttribute("href", "/reviews/acc-cp?tier=NEEDS_ATTENTION");
    expect(shares).toHaveTextContent("7");
    expect(screen.getByText(/확인이 필요한 리뷰 11건/)).toBeInTheDocument();
  });

  it("links a recurring issue to its own memory deep link", async () => {
    renderReports();
    expect(await screen.findByRole("link", { name: /접착력이/ })).toHaveAttribute(
      "href",
      "/memory/issue-1",
    );
  });

  it("writes a summary an operator can hand over as-is", async () => {
    renderReports();
    expect(await screen.findByText(/확인이 필요한 반복 문제 1건/)).toBeInTheDocument();
    expect(screen.getByText(/답변이 필요한 문의 1건/)).toBeInTheDocument();
  });
});

describe("주간 고객운영 리포트 — honesty", () => {
  it("marks a failed source unavailable rather than showing zero", async () => {
    getInboxStrict.mockRejectedValue(new Error("down"));
    renderReports();
    const unanswered = await screen.findByRole("link", { name: /답변이 필요한 문의/ });
    expect(unanswered).toHaveTextContent("지금 확인할 수 없습니다");
    expect(unanswered.textContent).not.toMatch(/\d/);
  });

  it("keeps the sources that did load when another fails", async () => {
    getReviewIssuesStrict.mockRejectedValue(new Error("down"));
    renderReports();
    const unanswered = await screen.findByRole("link", { name: /답변이 필요한 문의/ });
    expect(unanswered).toHaveTextContent("1");
  });

  it("marks the review figure unavailable when its reads fail", async () => {
    getSellerAccountsStrict.mockRejectedValue(new Error("down"));
    renderReports();
    const reviews = await screen.findByRole("link", { name: /확인이 필요한 리뷰/ });
    expect(reviews).toHaveTextContent("지금 확인할 수 없습니다");
    expect(reviews.textContent).not.toMatch(/\d/);
  });

  it("shows an honest empty workspace when nothing loaded", async () => {
    getReviewIssuesStrict.mockRejectedValue(new Error("down"));
    getInboxStrict.mockRejectedValue(new Error("down"));
    getSellerAccountsStrict.mockRejectedValue(new Error("down"));
    renderReports();
    expect(await screen.findByText("아직 정리할 자료가 없습니다")).toBeInTheDocument();
    expect(screen.getByText(/자료를 연결하면/)).toBeInTheDocument();
  });

  it("asserts no business outcome", async () => {
    renderReports();
    await screen.findByRole("heading", { level: 1 });
    const text = document.body.textContent ?? "";
    for (const claim of ["매출", "전환율", "만족도", "향상"]) {
      expect(text).not.toContain(claim);
    }
  });
});

describe("주간 고객운영 리포트 — accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = renderReports();
    await screen.findByRole("heading", { level: 1 });
    await expectNoAxeViolations(container);
  });
});
