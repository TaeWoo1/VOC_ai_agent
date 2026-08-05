// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { CustomerMemory } from "./CustomerMemory";
import { expectNoAxeViolations } from "../../test/axe";
import type { ReviewIssueDetailView, ReviewIssueView } from "../../lib/types";

const getReviewIssuesStrict = vi.fn();
const getReviewIssueDetailStrict = vi.fn();
const getInboxStrict = vi.fn();
const startReviewIssueAction = vi.fn();
const markReviewIssueRemediated = vi.fn();

vi.mock("../../lib/apiClient", () => ({
  api: {
    getReviewIssuesStrict: () => getReviewIssuesStrict(),
    getReviewIssueDetailStrict: (id: string) => getReviewIssueDetailStrict(id),
    getInboxStrict: () => getInboxStrict(),
    startReviewIssueAction: (id: string) => startReviewIssueAction(id),
    markReviewIssueRemediated: (id: string) => markReviewIssueRemediated(id),
  },
  getToken: () => null,
}));

function issue(over: Partial<ReviewIssueView> & Pick<ReviewIssueView, "id">): ReviewIssueView {
  return {
    title: "접착력이 약하다는 이야기가 늘고 있어요",
    aspect: "접착",
    problem: "부착 후 떨어짐",
    severity: "HIGH",
    lifecycleState: "NEEDS_REVIEW",
    lifecycleLabelKo: "확인 필요",
    evidenceCount: 4,
    firstEvidenceOn: "2026-06-18",
    lastEvidenceOn: "2026-08-02",
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
    ...over,
  } as ReviewIssueView;
}

const SURGING = issue({ id: "issue-1" });
const IMPROVED = issue({
  id: "issue-2",
  title: "재단 중 파손 이야기가 줄었어요",
  severity: "LOW",
  lifecycleState: "VERIFYING",
  lifecycleLabelKo: "개선 확인 중",
  change: {
    kinds: ["IMPROVED"],
    labelsKo: ["개선됨"],
    highSurge: false,
    surgeWindowCount: 0,
    surgeBaselineWeekly: 0,
  } as ReviewIssueView["change"],
});

const DETAIL: ReviewIssueDetailView = {
  issue: SURGING,
  evidence: [
    {
      reviewId: "rev-loaded",
      unitOrdinal: 1,
      occurredOn: "2026-08-02",
      productId: null,
      productName: "전선몰딩 1호",
      rating: 1,
      quote: "부착 후 며칠 지나니 떨어졌어요.",
    },
    {
      reviewId: "rev-not-loaded",
      unitOrdinal: 1,
      occurredOn: "2026-07-28",
      productId: null,
      productName: null,
      rating: 2,
      quote: "한쪽이 들뜹니다.",
    },
    {
      reviewId: "rev-suppressed",
      unitOrdinal: 2,
      occurredOn: "2026-07-19",
      productId: null,
      productName: null,
      rating: 2,
      quote: null,
    },
  ],
  history: [
    {
      fromState: "OBSERVING",
      toState: "NEEDS_REVIEW",
      toStateLabelKo: "확인 필요",
      actor: "SYSTEM",
      reason: "THRESHOLD_REACHED",
      note: null,
      at: "2026-07-01T00:00:00Z",
    },
  ],
};

function renderMemory(path = "/memory") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/memory" element={<CustomerMemory />} />
        <Route path="/memory/:issueId" element={<CustomerMemory />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getReviewIssuesStrict.mockResolvedValue([SURGING, IMPROVED]);
  getReviewIssueDetailStrict.mockResolvedValue(DETAIL);
  getInboxStrict.mockResolvedValue({
    items: [{ id: "rev-loaded", type: "REVIEW" }],
    total: 1,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("고객운영 메모리 — two panes", () => {
  it("renders a grouped issue list and a detail pane", async () => {
    renderMemory();
    const list = await screen.findByLabelText("반복 이슈 목록");
    expect(within(list).getByRole("heading", { name: "확인 필요" })).toBeInTheDocument();
    expect(within(list).getByRole("heading", { name: "개선됨" })).toBeInTheDocument();
    expect(screen.getByText(/왼쪽에서 이슈를 고르면/)).toBeInTheDocument();
  });

  it("shows each issue's state, severity, judgement and evidence count", async () => {
    renderMemory();
    const list = await screen.findByLabelText("반복 이슈 목록");
    const row = within(list).getByRole("link", { name: /접착력이 약하다는/ });
    expect(row).toHaveTextContent("확인 필요");
    expect(row).toHaveTextContent("심각도 심각");
    expect(row).toHaveTextContent("증가 중");
    expect(row).toHaveTextContent("근거 4건");
    expect(row).toHaveTextContent("마지막 확인 2026-08-02");
  });

  it("links each row to its own deep link", async () => {
    renderMemory();
    const list = await screen.findByLabelText("반복 이슈 목록");
    expect(within(list).getByRole("link", { name: /접착력이/ })).toHaveAttribute(
      "href",
      "/memory/issue-1",
    );
  });
});

describe("고객운영 메모리 — deep link", () => {
  it("opens the requested issue with its evidence and trend", async () => {
    renderMemory("/memory/issue-1");
    const detail = await screen.findByLabelText("선택한 이슈");
    expect(within(detail).getByRole("heading", { level: 2 })).toHaveTextContent("접착력이");
    expect(await within(detail).findByText(/부착 후 며칠 지나니 떨어졌어요/)).toBeInTheDocument();
    // The quantified surge line, from the server's own numbers.
    expect(within(detail).getByText(/최근 7일 4건/)).toBeInTheDocument();
  });

  it("says so honestly when the issue is not loaded", async () => {
    renderMemory("/memory/nope");
    expect(await screen.findByText("이 이슈를 찾을 수 없습니다")).toBeInTheDocument();
    expect(screen.getByText(/목록에서 다시 선택해 주세요/)).toBeInTheDocument();
  });

  it("surfaces suppressed evidence as a count rather than an empty quote", async () => {
    renderMemory("/memory/issue-1");
    const detail = await screen.findByLabelText("선택한 이슈");
    expect(await within(detail).findByText(/인용을 표시할 수 없는 근거가 1건/)).toBeInTheDocument();
  });

  it("shows the recorded state history", async () => {
    renderMemory("/memory/issue-1");
    const detail = await screen.findByLabelText("선택한 이슈");
    expect(await within(detail).findByText("기록")).toBeInTheDocument();
  });
});

describe("고객운영 메모리 — evidence links into the inbox", () => {
  it("links a quote only when that row is actually loaded in the inbox", async () => {
    renderMemory("/memory/issue-1");
    const detail = await screen.findByLabelText("선택한 이슈");
    const links = await within(detail).findAllByRole("link", { name: "인박스에서 보기" });
    // Exactly one: the row whose id the inbox actually holds. A link that reliably fails is worse
    // than no link.
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/inbox/rev-loaded");
  });
});

describe("고객운영 메모리 — lifecycle actions", () => {
  it("offers only the transition the lifecycle allows", async () => {
    renderMemory("/memory/issue-1");
    await screen.findByLabelText("선택한 이슈");
    expect(screen.getByRole("button", { name: "조치 시작" })).toBeInTheDocument();
    // There is deliberately no 해결 처리 control at any state — 해결됨 rests on observed quiet
    // weeks, and a button would let an assertion stand in for that evidence.
    expect(screen.queryByRole("button", { name: /해결/ })).toBeNull();
  });

  it("offers no action where the next move belongs to SellerOps", async () => {
    getReviewIssueDetailStrict.mockResolvedValue({ ...DETAIL, issue: IMPROVED });
    renderMemory("/memory/issue-2");
    const detail = await screen.findByLabelText("선택한 이슈");
    expect(
      await within(detail).findByText(/조치 이후 리뷰 변화를 지켜보고 있어요/),
    ).toBeInTheDocument();
    expect(within(detail).queryByRole("button")).toBeNull();
  });

  it("never describes the extraction as AI", async () => {
    renderMemory("/memory/issue-1");
    const detail = await screen.findByLabelText("선택한 이슈");
    expect(await within(detail).findByText(/규칙 기반 분석으로 모은 이슈 후보/)).toBeInTheDocument();
    expect(detail.textContent).not.toContain("AI");
  });
});

describe("고객운영 메모리 — empty and failed states", () => {
  it("invites a connection when nothing has been recorded", async () => {
    getReviewIssuesStrict.mockResolvedValue([]);
    renderMemory();
    expect(await screen.findByText("아직 쌓인 기록이 없습니다")).toBeInTheDocument();
  });

  it("says the read failed rather than showing an empty memory", async () => {
    getReviewIssuesStrict.mockRejectedValue(new Error("down"));
    renderMemory();
    expect(await screen.findByText("기록을 불러오지 못했습니다")).toBeInTheDocument();
  });
});

describe("고객운영 메모리 — accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = renderMemory("/memory/issue-1");
    await screen.findByLabelText("선택한 이슈");
    await expectNoAxeViolations(container);
  });
});
