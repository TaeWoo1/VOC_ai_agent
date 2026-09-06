// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ReportsV2 } from "./ReportsV2";
import { expectNoAxeViolations } from "../../test/axe";
import type { AgentReportView } from "../../lib/types";

const getCurrentAgentReport = vi.fn();
const getAgentReport = vi.fn();
const listAgentReports = vi.fn();
const regenerateAgentReport = vi.fn();

vi.mock("../../lib/apiClient", () => ({
  api: {
    getCurrentAgentReport: (kind: string) => getCurrentAgentReport(kind),
    getAgentReport: (id: string) => getAgentReport(id),
    listAgentReports: (kind: string) => listAgentReports(kind),
    regenerateAgentReport: (kind: string, start: string | null) => regenerateAgentReport(kind, start),
  },
  getToken: () => null,
}));

const ISSUE = "11111111-1111-4111-8111-111111111111";

const BUSY: AgentReportView = {
  id: "rep-1",
  kind: "WEEKLY",
  kindLabelKo: "주간",
  periodStart: "2026-08-24",
  periodEnd: "2026-08-30",
  periodLabelKo: "2026년 8월 24일 ~ 30일",
  version: 1,
  generatedAt: "2026-09-04T03:00:00Z",
  facts: {
    period: {
      kind: "WEEKLY", kindLabelKo: "주간", start: "2026-08-24", end: "2026-08-30",
      labelKo: "2026년 8월 24일 ~ 30일", previousStart: "2026-08-17", previousEnd: "2026-08-23",
    },
    counters: [
      { id: "c-reviews", labelKo: "받은 리뷰", periodic: true, current: 81, previous: 65, delta: 16, to: null },
      { id: "c-negative-reviews", labelKo: "부정 리뷰", periodic: true, current: 3, previous: 1, delta: 2, to: null },
      { id: "c-inquiries", labelKo: "받은 문의", periodic: true, current: 5, previous: 1, delta: 4, to: null },
      { id: "c-orders", labelKo: "주문", periodic: true, current: 120, previous: null, delta: null, to: null },
      { id: "c-unanswered-now", labelKo: "현재 답변이 필요한 문의", periodic: false, current: 5, previous: null, delta: null, to: "/inquiries?status=UNANSWERED" },
    ],
    issues: [
      {
        id: `i-${ISSUE}`, issueId: ISSUE, title: "접착 부족", severity: "NORMAL", severityLabelKo: "보통",
        current: 4, previous: 1, delta: 3, changeLabelsKo: ["증가 중"], productId: "p1", productName: "선바로 몰딩",
        to: `/memory/${ISSUE}`,
      },
    ],
    opportunities: [
      {
        id: `o-${ISSUE}-PRODUCT_GUIDE_SUPPLEMENT`, issueId: ISSUE, kind: "PRODUCT_GUIDE_SUPPLEMENT",
        kindLabelKo: "상품 상세·안내 보완", status: "OPEN", statusLabelKo: "검토 전", issueTitle: "접착 부족",
        productId: "p1", productName: "선바로 몰딩",
        recommendationKo: "'접착' 안내를 상세 페이지에 보완하는 것을 검토하세요",
        nextActionKo: "상세페이지 안내문 초안 준비", to: `/memory/${ISSUE}`,
      },
    ],
    nextSteps: [
      { id: "n-1", labelKo: "답변이 필요한 문의 보기", to: "/inquiries?status=UNANSWERED", factIds: ["c-unanswered-now"] },
      { id: "n-2", labelKo: "접착 부족 — 상세페이지 안내문 초안 준비", to: `/memory/${ISSUE}`, factIds: [`o-${ISSUE}-PRODUCT_GUIDE_SUPPLEMENT`] },
    ],
    generatedAt: "2026-09-04T03:00:00Z",
  },
  summary: {
    lines: [
      { text: "2026년 8월 24일 ~ 30일에 리뷰 81건, 문의 5건이 들어왔습니다 (이전 기간 리뷰 65건, 문의 1건).", kind: "FACT", factIds: ["c-reviews", "c-inquiries"] },
      { text: "「접착 부족」 관련 리뷰가 4건 있었습니다 (이전 기간 1건).", kind: "FACT", factIds: [`i-${ISSUE}`] },
      { text: "「접착 부족」 관련 리뷰 증가를 확인할 필요가 있습니다.", kind: "INTERPRETATION", factIds: [`i-${ISSUE}`] },
      { text: "늘어난 원인은 리뷰가 말해주지 않습니다. 근거 리뷰를 직접 확인해 주세요.", kind: "LIMIT", factIds: [`i-${ISSUE}`] },
    ],
  },
  narrative: {
    headline: "리뷰가 늘었고 접착 관련 이야기가 더 나왔습니다",
    lines: [
      { text: "리뷰가 81건으로 이전 기간 65건보다 늘었습니다.", factIds: ["c-reviews"] },
      { text: "「접착 부족」 관련 리뷰가 4건으로 늘어 확인이 필요합니다.", factIds: [`i-${ISSUE}`] },
    ],
  },
  narrativeStatus: "READY",
  narrativeNoteKo: null,
};

const QUIET: AgentReportView = {
  ...BUSY,
  id: "rep-q",
  facts: {
    ...BUSY.facts,
    counters: BUSY.facts.counters.map((c) => ({ ...c, current: 0, previous: c.periodic ? 0 : null, delta: c.periodic ? 0 : null, to: null })),
    issues: [],
    opportunities: [],
    nextSteps: [],
  },
  summary: { lines: [{ text: "2026년 8월 24일 ~ 30일에는 달라진 것이 없습니다 — 새 리뷰·문의·반복 문제가 확인되지 않았습니다.", kind: "FACT", factIds: ["c-reviews"] }] },
  narrative: null,
  narrativeStatus: "UNAVAILABLE",
  narrativeNoteKo: "AI 요약 기능이 이 계정에서 꺼져 있어, 정리된 사실만 보여 드립니다.",
};

function renderReports(url = "/reports") {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ReportsV2 />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getCurrentAgentReport.mockResolvedValue(BUSY);
  getAgentReport.mockResolvedValue(BUSY);
  listAgentReports.mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("운영 리포트 — one stored snapshot, sentences that cite facts", () => {
  it("shows the narrative on top and every section as doorways to the objects the facts name", async () => {
    const { container } = renderReports();
    // The loading state already carries the page heading, so wait for the snapshot itself.
    const narrative = await screen.findByTestId("report-narrative");
    expect(screen.getByRole("heading", { level: 1, name: "운영 리포트" })).toBeInTheDocument();
    expect(getCurrentAgentReport).toHaveBeenCalledWith("WEEKLY");

    expect(narrative).toHaveTextContent("리뷰가 늘었고 접착 관련 이야기가 더 나왔습니다");
    expect(narrative).toHaveTextContent("리뷰가 81건으로 이전 기간 65건보다 늘었습니다.");
    // A narrative line's citation is a link to the object it rests on.
    expect(screen.getAllByRole("link", { name: "접착 부족" })[0]).toHaveAttribute("href", `/memory/${ISSUE}`);

    // The standing figure links only where exactly that count is shown.
    expect(screen.getByRole("link", { name: "현재 답변이 필요한 문의" })).toHaveAttribute("href", "/inquiries?status=UNANSWERED");
    expect(screen.getByText(/기간과 무관한 지금 수치/)).toBeInTheDocument();
    // A previous window with no reading is said so, never compared against as zero.
    expect(screen.getByText(/이전 기간 자료 없음/)).toBeInTheDocument();
    expect(screen.queryByText(/0건 늘음/)).toBeNull();

    // Issue, opportunity and next-step rows open existing screens — no report-only object anywhere.
    const links = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(links.filter((h) => h === `/memory/${ISSUE}`).length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText("'접착' 안내를 상세 페이지에 보완하는 것을 검토하세요")).toBeInTheDocument();
    // The CTA names its destination and carries no count: the snapshot number lives on the counter,
    // and this link opens the live screen (Pilot QA, 2026-09-06).
    expect(screen.getByText("답변이 필요한 문의 보기")).toBeInTheDocument();
    expect(screen.queryByText(/답변이 필요한 문의 \d+건 처리하기/)).toBeNull();
    await expectNoAxeViolations(container);
  });

  it("falls back to the deterministic summary — with interpretation marked and the limit muted — when there is no narrative", async () => {
    getCurrentAgentReport.mockResolvedValue(QUIET);
    renderReports();
    expect(await screen.findByTestId("report-summary")).toHaveTextContent("달라진 것이 없습니다");
    expect(screen.getByText("AI 요약 기능이 이 계정에서 꺼져 있어, 정리된 사실만 보여 드립니다.")).toBeInTheDocument();
    expect(screen.queryByTestId("report-narrative")).toBeNull();
    // Zero is not a door.
    expect(screen.queryByRole("link", { name: "현재 답변이 필요한 문의" })).toBeNull();
    expect(screen.getByText("이 기간에 근거 리뷰가 붙은 반복 문제가 없습니다.")).toBeInTheDocument();
  });

  it("marks an interpretation line as 확인 필요 and never as a cause", async () => {
    getCurrentAgentReport.mockResolvedValue({ ...BUSY, narrative: null, narrativeStatus: "FAILED", narrativeNoteKo: "AI 요약을 만들지 못해, 정리된 사실만 보여 드립니다." });
    renderReports();
    await screen.findByTestId("report-summary");
    expect(screen.getByText("확인 필요")).toBeInTheDocument();
    expect(screen.getByText(/늘어난 원인은 리뷰가 말해주지 않습니다/)).toBeInTheDocument();
  });

  it("switches cadence through the URL and reads the monthly snapshot", async () => {
    renderReports();
    await screen.findByTestId("report-narrative");
    fireEvent.click(screen.getByRole("button", { name: "월간" }));
    await waitFor(() => expect(getCurrentAgentReport).toHaveBeenCalledWith("MONTHLY"));
  });

  it("regenerates only on the explicit control, as a new version", async () => {
    const v2 = { ...BUSY, id: "rep-2", version: 2 };
    regenerateAgentReport.mockResolvedValue(v2);
    // The page then addresses the new version by id in the URL, and that read must answer the same row.
    getAgentReport.mockImplementation((id: string) => Promise.resolve(id === "rep-2" ? v2 : BUSY));
    renderReports();
    await screen.findByTestId("report-narrative");
    expect(regenerateAgentReport).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "최신 자료로 다시 만들기" }));
    await waitFor(() => expect(regenerateAgentReport).toHaveBeenCalledWith("WEEKLY", "2026-08-24"));
    expect(await screen.findByText(/2번째 판/)).toBeInTheDocument();
  });

  it("opens a stored report by id without generating", async () => {
    renderReports("/reports?id=rep-1");
    await screen.findByTestId("report-narrative");
    expect(getAgentReport).toHaveBeenCalledWith("rep-1");
    expect(getCurrentAgentReport).not.toHaveBeenCalled();
  });
});
