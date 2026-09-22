// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { ReplyWorkHistory } from "./ReplyWorkHistory";
import { api } from "../../lib/apiClient";
import type { OperatorDismissedReplyWorkView, OperatorVocItem, ReviewWorkAccount } from "../../lib/types";

/**
 * <b>지난 답변 작업</b> — the history the 리뷰 screen's 「내 답변 작업」 used to carry, now under 확인할 일
 * (UI/UX v2 Phase 3). Ported from `MyReplyWork.test.tsx` with that component: a reported reply is labelled
 * UNVERIFIED and never 완료, and the recovery list (제외한 작업) is lazy, restores with an idempotency key, pages,
 * declines on an unattributable scope and never renders a dead read as empty.
 */

function item(over: Partial<OperatorVocItem> = {}): OperatorVocItem {
  return {
    channelCode: "NAVER",
    channelNameKo: "네이버 스마트스토어",
    sourceType: "REVIEW",
    productName: "합성 상품",
    rating: 1,
    replyStatus: "PENDING",
    sourceCreatedDate: "2026-05-10",
    collectedDate: "2026-05-11",
    signalType: "LOW_RATING_REVIEW",
    safePreview: "합성 미리보기",
    reviewId: "11111111-1111-1111-1111-111111111111",
    actionRef: "review:11111111-1111-1111-1111-111111111111",
    triageDisposition: "RESPONSE_NEEDED",
    hasReplyPreparation: false,
    replyWorkState: "DRAFT_NEEDED",
    category: null,
    hasReportedSubmission: false,
    ...over,
  };
}

function account(over: Partial<ReviewWorkAccount> = {}): ReviewWorkAccount {
  return {
    accountId: "acct-1",
    channelCode: "NAVER",
    channelNameKo: "네이버 스마트스토어",
    coverage: "COVERED",
    todo: [],
    recentlyReported: [],
    ...over,
  };
}

function dismissedView(over: Partial<OperatorDismissedReplyWorkView> = {}): OperatorDismissedReplyWorkView {
  return {
    sellerAccountId: "acct-1",
    channel: "네이버 스마트스토어",
    coverage: "COVERED",
    items: [],
    page: 0,
    size: 10,
    hasMore: false,
    ...over,
  };
}

function draw(accounts: ReviewWorkAccount[], onRestored = vi.fn()) {
  render(
    <MemoryRouter>
      <ReplyWorkHistory accounts={accounts} onRestored={onRestored} />
    </MemoryRouter>,
  );
  return onRestored;
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("지난 답변 작업 — 최근에 기록한 답변", () => {
  it("a reported reply appears under its own section, labelled UNVERIFIED — never 완료", async () => {
    draw([account({ recentlyReported: [item({ hasReportedSubmission: true })] })]);
    const recent = await screen.findByTestId("reply-work-recent");
    expect(recent).toHaveTextContent("최근에 기록한 답변");
    expect(recent).toHaveTextContent(/확인하지 않습니다|확인 안 함/);
    expect(recent).not.toHaveTextContent("답변 완료");
  });

  it("draws nothing for an organisation with no reply-capable account", () => {
    draw([]);
    expect(screen.queryByRole("region", { name: "지난 답변 작업" })).toBeNull();
  });
});

describe("지난 답변 작업 — 제외한 작업 (recovery)", () => {
  it("is LAZY — the recovery list is not read until the seller opens it", async () => {
    const dismissed = vi.spyOn(api, "getDismissedReplyWork").mockResolvedValue(dismissedView());
    draw([account()]);
    const toggle = await screen.findByTestId("dismissed-work-toggle");
    expect(dismissed).not.toHaveBeenCalled();
    await userEvent.click(toggle);
    await waitFor(() => expect(dismissed).toHaveBeenCalledTimes(1));
  });

  it("lists set-aside reviews and restores one — telling 확인할 일 to read again, claiming no completion", async () => {
    const ref = "review:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    vi.spyOn(api, "getDismissedReplyWork")
      .mockResolvedValueOnce(dismissedView({ items: [item({ actionRef: ref })] }))
      .mockResolvedValue(dismissedView({ items: [] }));
    const restore = vi.spyOn(api, "restoreReplyWork").mockResolvedValue({ actionRef: ref, replayed: false });
    const onRestored = draw([account()]);

    await userEvent.click(await screen.findByTestId("dismissed-work-toggle"));
    await userEvent.click(await screen.findByTestId("dismissed-work-restore"));

    await waitFor(() => expect(restore).toHaveBeenCalledTimes(1));
    const [, restoredRef, body] = restore.mock.calls[0]!;
    expect(restoredRef).toBe(ref);
    expect(body.commandId).toBeTruthy();
    await waitFor(() => expect(screen.queryAllByTestId("dismissed-work-restore")).toHaveLength(0));
    // The to-do the review returns to is 확인할 일's list, so that list is told to read again.
    expect(onRestored).toHaveBeenCalled();
    expect(screen.queryByText(/답변 완료/)).not.toBeInTheDocument();
  });

  it("pages with 더 보기 rather than hiding older set-aside items behind a cap", async () => {
    const a = item({ actionRef: "review:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" });
    const b = item({ actionRef: "review:bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" });
    const c = item({ actionRef: "review:cccccccc-cccc-cccc-cccc-cccccccccccc" });
    vi.spyOn(api, "getDismissedReplyWork")
      .mockResolvedValueOnce(dismissedView({ items: [a, b], hasMore: true, page: 0 }))
      .mockResolvedValueOnce(dismissedView({ items: [c], hasMore: false, page: 1 }));
    draw([account()]);
    await userEvent.click(await screen.findByTestId("dismissed-work-toggle"));
    await waitFor(() => expect(screen.getAllByTestId("dismissed-work-restore")).toHaveLength(2));
    await userEvent.click(screen.getByTestId("dismissed-work-more"));
    await waitFor(() => expect(screen.getAllByTestId("dismissed-work-restore")).toHaveLength(3));
    expect(screen.queryByTestId("dismissed-work-more")).not.toBeInTheDocument();
  });

  it("an unattributable scope declines — never a false 'nothing set aside'", async () => {
    vi.spyOn(api, "getDismissedReplyWork").mockResolvedValue(dismissedView({ coverage: "UNCERTAIN_MULTI_ACCOUNT", items: [] }));
    draw([account()]);
    await userEvent.click(await screen.findByTestId("dismissed-work-toggle"));
    expect(await screen.findByTestId("dismissed-work-coverage-uncertain")).toBeInTheDocument();
    expect(screen.queryByTestId("dismissed-work-empty")).not.toBeInTheDocument();
  });

  it("a dead recovery read never renders as an empty recovery list", async () => {
    vi.spyOn(api, "getDismissedReplyWork").mockRejectedValue(new Error("backend down"));
    draw([account()]);
    await userEvent.click(await screen.findByTestId("dismissed-work-toggle"));
    await waitFor(() => expect(screen.getByText(/제외한 작업을 불러오지 못했습니다/)).toBeInTheDocument());
    expect(screen.queryByTestId("dismissed-work-empty")).not.toBeInTheDocument();
  });
});
