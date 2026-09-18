// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { CustomerOperationsHome } from "../../lib/customerOperationsTypes";
import type { InquiryQueueResponse, OperationsHome } from "../../lib/types";
import { expectNoAxeViolations } from "../../test/axe";

const api = vi.hoisted(() => ({
  getInquiryQueueStrict: vi.fn(),
  activateCustomerOperations: vi.fn(),
  resumeCustomerOperations: vi.fn(),
}));
vi.mock("../../lib/apiClient", () => ({ api, getToken: () => null }));

import { CustomerOpsHome, coHomeApplies } from "./CustomerOpsHome";
import { mergeHomeWork } from "../../lib/homeWork";
import { waitLabel } from "../../lib/copy/customerOps";

const NOW = new Date("2026-09-16T05:30:00Z"); // 14:30 KST

function co(over: Partial<CustomerOperationsHome> = {}): CustomerOperationsHome {
  return {
    available: true,
    eligible: true,
    status: "ACTIVE",
    cadenceMinutes: 120,
    lastCheckedAt: "2026-09-16T05:02:00Z",
    lastRunStatus: "SUCCESS",
    nextCheckAt: "2026-09-16T07:00:00Z",
    sources: [],
    decisions: {
      total: 2,
      rows: [
        {
          caseId: "c-1", subjectKind: "INQUIRY", channelNameKo: "카페24", title: "뚜껑이 깨져서 왔어요", rating: null,
          reasonNote: "고객이 답변을 기다립니다.", summary: "사진에서 균열이 보입니다.", recommendedActionType: "CANCEL_OR_EXCHANGE",
          recommendedAction: null, missingInformation: [], draftPrepared: true, decidedBy: "AGENT",
          openedAt: "2026-09-16T02:30:00Z", to: "/inquiries/i-1",
        },
        {
          caseId: "c-2", subjectKind: "INQUIRY", channelNameKo: "네이버 스마트스토어", title: "9oz 뚜껑도 파나요?", rating: null,
          reasonNote: "고객이 답변을 기다립니다.", summary: null, recommendedActionType: "ADD_KNOWLEDGE",
          recommendedAction: null, missingInformation: ["9oz 뚜껑 판매 여부"], draftPrepared: false, decidedBy: "AGENT",
          openedAt: "2026-09-16T00:30:00Z", to: "/inquiries/i-2",
        },
      ],
    },
    handled: {
      since: null, autoResolved: 31, monitoring: 4, draftsPrepared: 9, verifying: 0, checked: 47,
      rows: [
        { caseId: "h-1", subjectKind: "REVIEW", channelNameKo: "네이버", title: "좋아요", rating: 5, disposition: "AUTO_RESOLVED", decidedBy: "RULE", reasonNote: "", summary: null, verifying: false, to: "/reviews/reply/r-settled" },
      ],
    },
    gaps: { total: 0, rows: [] },
    ...over,
  };
}

function ops(): OperationsHome {
  return {
    reviews: {
      needsAttentionUndecided: 2, needsAttentionTotal: 2, watchTotal: 0,
      rows: [
        { reviewId: "r-1", accountId: "a", channelCode: "NAVER", rating: 1, occurredOn: "2026-09-15", productName: "컵 뚜껑 12oz", quote: "뚜껑이 컵에 잘 안 맞아요" },
        { reviewId: "r-settled", accountId: "a", channelCode: "NAVER", rating: 5, occurredOn: "2026-09-10", productName: null, quote: "좋아요" },
      ],
    },
    problems: {
      decidable: 1, observing: 1,
      rows: [{ issue: { id: "iss-1", title: "포장 파손", change: { kinds: ["SURGE"], labelsKo: ["급증"], highSurge: true, surgeWindowCount: 4, surgeBaselineWeekly: 1 } }, context: {} }],
    },
    collection: [],
    prepared: { reviewRepliesApproved: 0, inquiryDraftsReady: 0, rows: [] },
  } as never;
}

function queue(over: Partial<InquiryQueueResponse> = {}): InquiryQueueResponse {
  return {
    content: [
      { workItemId: "w-1", inquiryId: "i-1", sellerAccountId: "a", channelId: "ch", channelCode: "CAFE24", channelNameKo: "카페24", productId: null, productName: null, phase: "PROPOSED", status: "UNANSWERED", title: "뚜껑이 깨져서 왔어요", snippet: null, receivedAt: "2026-09-16T02:00:00Z", hasDraft: true },
      { workItemId: "w-3", inquiryId: "i-3", sellerAccountId: "a", channelId: "ch", channelCode: "CAFE24", channelNameKo: "카페24", productId: null, productName: null, phase: "OPEN", status: "UNANSWERED", title: null, snippet: "주문 취소 가능할까요?", receivedAt: "2026-09-16T04:30:00Z", hasDraft: false },
    ],
    page: 0, size: 50, totalElements: 2, totalPages: 1,
    ...over,
  };
}

function draw(home = co(), operations: OperationsHome | null = ops()) {
  const onChanged = vi.fn();
  const view = render(
    <MemoryRouter>
      <CustomerOpsHome co={home} ops={operations} now={NOW} onChanged={onChanged} />
    </MemoryRouter>,
  );
  return { ...view, onChanged };
}

describe("mergeHomeWork — one list from three reads", () => {
  it("is keyed by the screen that owns the item: a case wins, and nothing a case already settled comes back as work", () => {
    const work = mergeHomeWork(co(), ops(), queue());
    const keys = work.rows.map((r) => r.key);
    expect([...keys].sort()).toEqual(["case:c-1", "case:c-2", "inquiry:i-3", "review:r-1"]);
    // i-1 is the case c-1; r-settled was settled by the job.
    expect(keys).not.toContain("inquiry:i-1");
    expect(keys).not.toContain("review:r-settled");
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("orders by how long it has waited, oldest first", () => {
    const work = mergeHomeWork(co(), ops(), queue());
    expect(work.rows.map((r) => r.key)).toEqual(["review:r-1", "case:c-2", "case:c-1", "inquiry:i-3"]);
  });

  it("a read that failed is absent, not zero — and the count is what was drawn", () => {
    const work = mergeHomeWork(co(), ops(), null);
    expect(work.rows.map((r) => r.key)).toEqual(["review:r-1", "case:c-2", "case:c-1"]);
    expect(work.truncated).toBe(false);
  });

  it("says when a read knows of more than it returned", () => {
    expect(mergeHomeWork(co(), null, queue({ totalElements: 80 })).truncated).toBe(true);
    const more = co();
    expect(mergeHomeWork({ ...more, decisions: { ...more.decisions, total: 9 } }, null, null).truncated).toBe(true);
  });
});

describe("CustomerOpsHome", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    api.getInquiryQueueStrict.mockResolvedValue(queue());
  });

  it("reads 자동 확인 → 내 확인 필요 first: what was checked, never called processed", async () => {
    const { container } = draw();
    const card = await screen.findByTestId("work-flow-card");
    expect(card).toHaveTextContent("자동 확인 · 24시간");
    expect(card).toHaveTextContent("47건");
    expect(card).toHaveTextContent("정리 31");
    expect(card).toHaveTextContent("관찰 4");
    expect(card).toHaveTextContent("초안 9 (미발송)");
    expect(card).not.toHaveTextContent("처리");
    await waitFor(() => expect(card).toHaveTextContent("내 확인 필요"));
    await waitFor(() => expect(card).toHaveTextContent("4건"));
    expect(card).toHaveTextContent("교환·환불 1·정보 부족 1·답변 필요 1·리뷰 1");
    await expectNoAxeViolations(container);
  });

  it("each row says why, from where, how long — and one row, the first, carries the filled verb", async () => {
    draw();
    const list = await screen.findByRole("list", { name: "확인 필요" });
    await waitFor(() => expect(within(list).getAllByRole("link")).toHaveLength(4));
    const [first, second] = within(list).getAllByRole("link");
    expect(first).toHaveAttribute("href", "/reviews/reply/r-1");
    expect(first).toHaveTextContent("리뷰");
    expect(first).toHaveTextContent("네이버 리뷰 ★1");
    expect(second).toHaveAttribute("href", "/customer-operations/cases/c-2");
    expect(second).toHaveTextContent("정보 부족");
    expect(second).toHaveTextContent("9oz 뚜껑 판매 여부 필요");
    expect(second).toHaveTextContent("정보 입력");
    expect(second).toHaveTextContent("5시간 대기");
    const exchange = within(list).getByRole("link", { name: /뚜껑이 깨져서 왔어요/ });
    expect(exchange).toHaveTextContent("초안 있음 · 미발송");
    expect(list.querySelectorAll(".bg-brand-700")).toHaveLength(1);
  });

  it("a source that was not read is excluded from the count and says so, with its fix", async () => {
    draw(
      co({
        gaps: { total: 1, rows: [{ caseId: "g-1", channelCode: "COUPANG", channelNameKo: "쿠팡", reason: "SOURCE_AUTH_REQUIRED", dataTypes: ["INQUIRY"], since: "2026-09-15T13:00:00Z", lastSeenAt: "", to: "/connect/coupang" }] },
        sources: [
          { channelCode: "NAVER", channelNameKo: "네이버", dataType: "INQUIRY", completeness: "PARTIAL", observedCount: 3, newCount: 1, failureReason: "TIMEOUT", observedAt: null, sellerActionRequired: false },
        ],
      }),
    );
    const card = await screen.findByTestId("work-flow-card");
    expect(card).toHaveTextContent("쿠팡 문의 연결 만료 · 어제 22:00부터 집계 제외");
    expect(within(card).getByRole("link", { name: "재연결" })).toHaveAttribute("href", "/connect/coupang");
    expect(card).toHaveTextContent("네이버 문의 일부만 확인 · 응답 지연");
  });

  it("a list read that failed counts what loaded and says the count is partial — never 「N+」", async () => {
    api.getInquiryQueueStrict.mockRejectedValue(new Error("down"));
    draw();
    const card = await screen.findByTestId("work-flow-card");
    await waitFor(() => expect(card).toHaveTextContent("문의 목록 읽기 실패 · 부분 집계"));
    // c-1, c-2 and the review — what loaded, with no 「+」.
    expect(card).toHaveTextContent("3건");
    expect(card).not.toHaveTextContent("3+");
    expect(card).not.toHaveTextContent("리뷰 목록 읽기 실패");
  });

  it("「N+」 only when a read reports more than it returned", async () => {
    api.getInquiryQueueStrict.mockResolvedValue(queue({ totalElements: 80 }));
    draw();
    const card = await screen.findByTestId("work-flow-card");
    await waitFor(() => expect(card).toHaveTextContent("4+건"));
    expect(card).not.toHaveTextContent("부분 집계");
  });

  it("a failed latest run keeps the 24-hour tally and names the check it does not include", async () => {
    draw(co({ lastRunStatus: "FAILED" }));
    const card = await screen.findByTestId("work-flow-card");
    // What earlier runs checked in the window is still checked.
    expect(card).toHaveTextContent("47건");
    expect(card).toHaveTextContent("정리 31");
    expect(card).toHaveTextContent("마지막 확인 실패 (오늘 14:02) · 이번 확인분 집계 제외 · 다음 확인 오늘 16:00");
  });

  it("nothing waiting is 「없음」 with the next check — and no list", async () => {
    api.getInquiryQueueStrict.mockResolvedValue(queue({ content: [], totalElements: 0 }));
    draw(co({ decisions: { total: 0, rows: [] } }), null);
    const card = await screen.findByTestId("work-flow-card");
    await waitFor(() => expect(card).toHaveTextContent("없음"));
    expect(card).toHaveTextContent("다음 확인 오늘 16:00");
    expect(screen.queryByRole("list", { name: "확인 필요" })).toBeNull();
  });

  it("a paused job says so and resumes on one press", async () => {
    api.resumeCustomerOperations.mockResolvedValue({});
    const { onChanged } = draw(co({ status: "PAUSED" }));
    expect(screen.getAllByText("일시정지됨").length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button", { name: "재개" }));
    await waitFor(() => expect(api.resumeCustomerOperations).toHaveBeenCalled());
    expect(onChanged).toHaveBeenCalled();
    expect(screen.queryByTestId("work-flow-card")).toBeNull();
  });

  it("repeated problems are one quiet line, not a task", async () => {
    draw();
    expect(await screen.findByText(/포장 파손 급증/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "보기" })).toHaveAttribute("href", "/memory/iss-1");
  });

  it("applies only where the job is open and has something to say", () => {
    expect(coHomeApplies(null)).toBe(false);
    expect(coHomeApplies(co({ available: false }))).toBe(false);
    expect(coHomeApplies(co({ status: null, eligible: false }))).toBe(false);
    expect(coHomeApplies(co({ status: null, eligible: true }))).toBe(true);
    expect(coHomeApplies(co())).toBe(true);
  });
});

describe("waitLabel", () => {
  it("minutes, hours, days — and a bare date is days in Korea time", () => {
    expect(waitLabel("2026-09-16T05:10:00Z", NOW)).toBe("20분 대기");
    expect(waitLabel("2026-09-16T02:30:00Z", NOW)).toBe("3시간 대기");
    expect(waitLabel("2026-09-13T05:30:00Z", NOW)).toBe("3일 대기");
    expect(waitLabel("2026-09-16", NOW)).toBe("오늘 접수");
    expect(waitLabel("2026-09-14", NOW)).toBe("2일 대기");
    expect(waitLabel(null, NOW)).toBeNull();
  });
});
