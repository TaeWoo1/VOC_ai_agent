// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { CustomerOperationsHome, ResponsibilityView } from "../../lib/customerOperationsTypes";
import { expectNoAxeViolations } from "../../test/axe";

const api = vi.hoisted(() => ({
  getCustomerOperations: vi.fn(),
  getCustomerOperationsHome: vi.fn(),
  activateCustomerOperations: vi.fn(),
  pauseCustomerOperations: vi.fn(),
  resumeCustomerOperations: vi.fn(),
  stopCustomerOperations: vi.fn(),
}));
vi.mock("../../lib/apiClient", () => ({ api, getToken: () => null }));

import { CustomerOperations } from "./CustomerOperations";

const NOW = new Date("2026-09-16T05:30:00Z"); // 14:30 KST

function view(over: Partial<ResponsibilityView> = {}): ResponsibilityView {
  return {
    templateCode: "CUSTOMER_OPERATIONS_V1",
    displayName: "고객 운영 관리",
    available: true,
    eligible: true,
    status: null,
    cadenceMinutes: 120,
    timezone: "Asia/Seoul",
    sourcesInScope: ["CAFE24:INQUIRY", "CAFE24:REVIEW"],
    nextRunAt: null,
    activatedAt: null,
    pausedAt: null,
    stoppedAt: null,
    runs: [],
    ...over,
  };
}

function home(over: Partial<CustomerOperationsHome> = {}): CustomerOperationsHome {
  return {
    available: true,
    eligible: true,
    status: "ACTIVE",
    cadenceMinutes: 120,
    lastCheckedAt: "2026-09-16T05:02:00Z",
    lastRunStatus: "PARTIAL",
    nextCheckAt: "2026-09-16T07:00:00Z",
    sources: [
      { channelCode: "CAFE24", channelNameKo: "카페24", dataType: "INQUIRY", completeness: "COMPLETE", observedCount: 5, newCount: 1, failureReason: null, observedAt: "2026-09-16T05:01:00Z", sellerActionRequired: false },
      { channelCode: "CAFE24", channelNameKo: "카페24", dataType: "REVIEW", completeness: "NONE", observedCount: null, newCount: null, failureReason: "AUTH_REQUIRED", observedAt: null, sellerActionRequired: true },
    ],
    decisions: {
      total: 1,
      rows: [
        {
          caseId: "c-1", subjectKind: "INQUIRY", channelNameKo: "카페24", title: "환불 문의", rating: null,
          reasonNote: "고객이 답변을 기다리는 새 문의입니다.", summary: "고객이 파손으로 환불을 요청했습니다.",
          recommendedActionType: "REFUND_OR_COMPENSATION", recommendedAction: "사진을 확인하고 환불 여부를 정해 주세요.",
          missingInformation: ["파손 사진"], draftPrepared: true, decidedBy: "AGENT", openedAt: "2026-09-16T05:02:00Z", to: "/inquiries/i-1",
        },
      ],
    },
    handled: {
      since: "2026-09-15T05:30:00Z", autoResolved: 2, monitoring: 1, draftsPrepared: 1, verifying: 0,
      rows: [
        { caseId: "h-1", subjectKind: "REVIEW", channelNameKo: "카페24", title: "잘 받았습니다", rating: 5, disposition: "AUTO_RESOLVED", decidedBy: "RULE", reasonNote: "별점 4~5점 리뷰라 따로 대응할 일이 없습니다.", summary: null, verifying: false, to: "/reviews/reply/r-1" },
      ],
    },
    gaps: {
      total: 1,
      rows: [{ caseId: "g-1", channelCode: "CAFE24", channelNameKo: "카페24", reason: "SOURCE_AUTH_REQUIRED", dataTypes: ["REVIEW"], since: "2026-09-16T03:00:00Z", lastSeenAt: "2026-09-16T05:02:00Z", to: "/connect/cafe24" }],
    },
    ...over,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <CustomerOperations now={NOW} />
    </MemoryRouter>,
  );
}

/**
 * <b>The four facts the Home stopped saying</b> (product-owner decision, 2026-09-26).
 *
 * <p>The Home's status line carried seven of them and, on an org that had checked once, eleven; it answers
 * 「자동 확인이 돌고 있나」 and the Home needs that question's conclusion, not its parameters. These pin the other
 * end of that move: the screen that owns the job renders every one of them, so nothing was deleted by being
 * taken off the first screen. `CustomerOpsHome.test.tsx` asserts the same four are absent there.
 */
describe("고객 운영 관리 page — the facts the Home handed over", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
  });

  it("renders 확인 주기, 다음 확인 and the 24-hour tally", async () => {
    api.getCustomerOperations.mockResolvedValue(view({ status: "ACTIVE", nextRunAt: "2026-09-16T07:00:00Z" }));
    api.getCustomerOperationsHome.mockResolvedValue(home());
    renderPage();
    expect(await screen.findByText("2시간마다")).toBeInTheDocument();
    expect(screen.getByText("오늘 16:00")).toBeInTheDocument();
    // The tally, in the same words the Home used — the label, the denominator, and what became of them.
    const checked = await screen.findByText("최근 24시간 자동 확인");
    expect(checked.parentElement).toHaveTextContent("확인 완료");
    expect(screen.getByText("정리 2 · 관찰 1 · 초안 1 (미발송)")).toBeInTheDocument();
  });

  it("names the denominator when the server sends one, and counts 처리 확인 중 only when there is any", async () => {
    api.getCustomerOperations.mockResolvedValue(view({ status: "ACTIVE" }));
    api.getCustomerOperationsHome.mockResolvedValue(
      home({ handled: { ...home().handled, checked: 47, autoResolved: 31, monitoring: 4, draftsPrepared: 9, verifying: 3 } }),
    );
    renderPage();
    const checked = await screen.findByText("최근 24시간 자동 확인");
    expect(checked.parentElement).toHaveTextContent("47건");
    expect(screen.getByText("정리 31 · 관찰 4 · 초안 9 (미발송) · 처리 확인 중 3")).toBeInTheDocument();
  });

  it("says 첫 확인 전 before anything has finished, and draws no tally it cannot vouch for", async () => {
    api.getCustomerOperations.mockResolvedValue(view({ status: "ACTIVE" }));
    api.getCustomerOperationsHome.mockResolvedValue(home({ lastCheckedAt: null, lastRunStatus: null }));
    renderPage();
    const checked = await screen.findByText("최근 24시간 자동 확인");
    expect(checked.parentElement).toHaveTextContent("첫 확인 전");
    expect(screen.queryByText(/정리 \d/)).toBeNull();
    expect(await screen.findByText("아직 없음")).toBeInTheDocument();
  });
});

describe("고객 운영 관리 page", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    api.getCustomerOperationsHome.mockResolvedValue(home({ status: null, decisions: { total: 0, rows: [] }, gaps: { total: 0, rows: [] }, sources: [] }));
  });

  // Rewritten 2026-09-22: the job's sources stopped being one channel's, so the sentence and the link
  // must stop naming one. The old version asserted 「Cafe24를 먼저 연결해 주세요」 + /connect/cafe24, which
  // sent a seller who sells on NAVER to a shop they do not have.
  it("without any connected channel it cannot start, and names no channel while saying so", async () => {
    api.getCustomerOperations.mockResolvedValue(view({ eligible: false }));
    renderPage();
    const sentence = await screen.findByText("고객 운영 관리를 시작하려면 판매 채널을 먼저 연결해 주세요.");
    expect(sentence).toBeInTheDocument();
    for (const channel of ["Cafe24", "카페24", "네이버", "쿠팡"]) {
      expect(sentence.textContent).not.toContain(channel);
    }
    expect(screen.getByRole("link", { name: "판매 채널 연결하기" })).toHaveAttribute("href", "/connect");
    expect(screen.queryByRole("button", { name: /시작하기/ })).toBeNull();
  });

  // The scope the screen prints is this seller's own resolved sources — the server sends them per
  // organisation — so a NAVER-only seller is never told the job also watches two Cafe24 boards.
  it("names the seller's own sources, whichever channel they are", async () => {
    api.getCustomerOperations.mockResolvedValue(view({ sourcesInScope: ["NAVER:INQUIRY"] }));
    renderPage();
    const job = await screen.findByRole("region", { name: "맡긴 일" });
    expect(within(job).getByText("네이버 문의")).toBeInTheDocument();
    expect(within(job).queryByText(/Cafe24/)).toBeNull();
  });

  it("states the job's contract before it is started, and starts it", async () => {
    api.getCustomerOperations.mockResolvedValue(view());
    api.activateCustomerOperations.mockResolvedValue(view({ status: "ACTIVE", nextRunAt: "2026-09-16T07:00:00Z" }));
    renderPage();
    const job = await screen.findByRole("region", { name: "맡긴 일" });
    expect(within(job).getByText("Reviewnary가 새 고객 문제를 확인하고, 직접 판단할 필요가 있는 일만 알려드립니다.")).toBeInTheDocument();
    expect(within(job).getByText("2시간마다")).toBeInTheDocument();
    for (const text of ["Cafe24 문의", "Cafe24 리뷰", "중요하지 않은 일 정리", "반복 문제 관찰", "필요한 정보 조사", "답변/행동 준비", "고객에게 실제 메시지 전송", "금전/보상/취소", "불확실한 판단"]) {
      expect(within(job).getByText(text)).toBeInTheDocument();
    }
    await userEvent.click(screen.getByRole("button", { name: "고객 운영 관리 시작하기" }));
    expect(api.activateCustomerOperations).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("운영 중")).toBeInTheDocument();
    expect(screen.getByText("오늘 16:00")).toBeInTheDocument();
  });

  it("a case the seller decided stays visible while its result is read back, and claims nothing", async () => {
    api.getCustomerOperations.mockResolvedValue(view({ status: "ACTIVE", nextRunAt: "2026-09-16T07:00:00Z" }));
    api.getCustomerOperationsHome.mockResolvedValue(
      home({
        decisions: { total: 0, rows: [] },
        handled: {
          since: "2026-09-15T05:30:00Z", autoResolved: 0, monitoring: 0, draftsPrepared: 0, verifying: 1,
          rows: [
            {
              caseId: "v-1", subjectKind: "INQUIRY", channelNameKo: "카페24", title: "교환 문의", rating: null,
              disposition: "NEEDS_DECISION", decidedBy: "AGENT", reasonNote: "답변이 필요합니다.",
              summary: null, verifying: true, to: "/inquiries/i-9",
            },
          ],
        },
      }),
    );
    renderPage();

    // It left 「내 결정 필요」 the moment they acted; without this it would appear nowhere at all. The sentence is
    // the area's, said once — the row carries the word and what the case is about.
    expect(await screen.findByText("승인한 작업의 처리 결과를 확인하고 있습니다.")).toBeInTheDocument();
    // The rows sit inside a native <details>; they are in the document whether or not it is open, so this
    // asserts what the seller can reach rather than simulating a disclosure toggle.
    expect(screen.getByText("처리 확인 중")).toBeInTheDocument();
    expect(screen.getByText("교환 문의")).toBeInTheDocument();
    expect(screen.getByText("답변이 필요합니다.")).toBeInTheDocument();

    // The execution record owns delivery, and it has not spoken yet.
    const page = document.body.textContent ?? "";
    for (const claim of ["보냈습니다", "전송했습니다", "처리 완료", "처리했습니다", "등록했습니다"]) {
      expect(page, `the page claims ${claim} before the record said so`).not.toContain(claim);
    }
  });

  it("an active job shows its three areas and asks before stopping", async () => {
    api.getCustomerOperations.mockResolvedValue(view({ status: "ACTIVE", nextRunAt: "2026-09-16T07:00:00Z" }));
    api.getCustomerOperationsHome.mockResolvedValue(home());
    api.stopCustomerOperations.mockResolvedValue(view({ status: "STOPPED" }));
    const { container } = renderPage();

    expect(await screen.findByRole("heading", { name: "내 결정 필요" })).toBeInTheDocument();
    expect(screen.getByText("직접 판단하실 일이 1건 있습니다.")).toBeInTheDocument();
    expect(screen.getByText("초안 준비됨 · 아직 보내지 않음")).toBeInTheDocument();
    expect(screen.getByText(/따로 할 일이 없는 2건을 정리했습니다/)).toBeInTheDocument();
    expect(screen.getByText("Cafe24 리뷰 — 연결이 만료되어 확인하지 못했습니다.")).toBeInTheDocument();
    expect(screen.getByText(/Cafe24 리뷰 — 확인하지 못했습니다/)).toBeInTheDocument();
    expect(screen.queryByText(/리뷰 — 확인함 · 0건/)).toBeNull();
    expect(screen.getByText("오늘 14:02 · 일부만 확인")).toBeInTheDocument();
    await expectNoAxeViolations(container);

    await userEvent.click(screen.getByRole("button", { name: "중지" }));
    expect(api.stopCustomerOperations).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "중지하기" }));
    await waitFor(() => expect(api.stopCustomerOperations).toHaveBeenCalledTimes(1));
  });

  it("an organisation the deployment has not opened the job for sees no controls", async () => {
    api.getCustomerOperations.mockResolvedValue(view({ available: false }));
    renderPage();
    expect(await screen.findByText("이 계정에서는 아직 고객 운영 관리를 사용할 수 없습니다.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
