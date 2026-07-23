// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MyReplyWork } from "./MyReplyWork";
import { api } from "../lib/apiClient";
import type { OperatorReplyWorkView, OperatorVocItem } from "../lib/types";

// 내 답변 작업 — the operator's OWN committed reply work, with a home that survives a reload.
// These pin what the surface promises: the to-do is what is still theirs to do, a reported reply
// moves to its own honestly-labelled section (never 완료), and an unattributable scope declines
// rather than reading as "no work".

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
    actionRef: "review:11111111-1111-1111-1111-111111111111",
    triageDisposition: "RESPONSE_NEEDED",
    hasReplyPreparation: false,
    category: null,
    hasReportedSubmission: false,
    ...over,
  };
}

function view(over: Partial<OperatorReplyWorkView> = {}): OperatorReplyWorkView {
  return {
    sellerAccountId: "acct-1",
    channel: "네이버 스마트스토어",
    coverage: "COVERED",
    todo: [],
    recentlyReported: [],
    ...over,
  };
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("MyReplyWork — 내 답변 작업", () => {
  it("lists the reviews the operator committed to, and says the list persists", async () => {
    vi.spyOn(api, "getReplyWork").mockResolvedValue(
      view({ todo: [item(), item({ actionRef: "review:22222222-2222-2222-2222-222222222222", rating: 3 })] }),
    );

    render(<MyReplyWork accountId="acct-1" />);

    const todo = await screen.findByTestId("reply-work-todo");
    // Direct children only — a VocItemCard renders its own nested lists.
    expect(todo.querySelectorAll(":scope > li")).toHaveLength(2);
    // The persistence promise is stated to the seller, because it is the whole point of the surface.
    expect(screen.getByText(/화면을 새로 열어도 그대로 남아 있습니다/)).toBeInTheDocument();
  });

  it("is read WITHOUT a window — a commitment is not scoped to a date range", async () => {
    const spy = vi.spyOn(api, "getReplyWork").mockResolvedValue(view());

    render(<MyReplyWork accountId="acct-1" />);

    await waitFor(() => expect(spy).toHaveBeenCalled());
    const [, options] = spy.mock.calls[0]!;
    // No from/to anywhere: the read cannot be invalidated by a window change.
    expect(JSON.stringify(options ?? {})).not.toMatch(/from|to(?!doLimit)/);
  });

  it("a reported reply appears under its own section, labelled UNVERIFIED — never 완료", async () => {
    vi.spyOn(api, "getReplyWork").mockResolvedValue(
      view({
        todo: [item()],
        recentlyReported: [
          item({ actionRef: "review:33333333-3333-3333-3333-333333333333", hasReportedSubmission: true }),
        ],
      }),
    );

    render(<MyReplyWork accountId="acct-1" />);

    const recent = await screen.findByTestId("reply-work-recent");
    expect(recent).toHaveTextContent("최근에 기록한 답변");
    expect(recent).toHaveTextContent(/확인하지 않습니다|확인 안 함/);
    // The one word this surface may never use about a reported reply.
    expect(recent).not.toHaveTextContent("답변 완료");
  });

  it("says so plainly when the operator has committed to nothing yet", async () => {
    vi.spyOn(api, "getReplyWork").mockResolvedValue(view({ todo: [] }));

    render(<MyReplyWork accountId="acct-1" />);

    await screen.findByTestId("reply-work-todo-empty");
    // An empty to-do on a COVERED scope is an honest "you have not started anything".
    expect(screen.queryByTestId("reply-work-coverage-uncertain")).not.toBeInTheDocument();
  });

  it("an unattributable scope declines to answer — never 'no work'", async () => {
    vi.spyOn(api, "getReplyWork").mockResolvedValue(
      view({ coverage: "UNCERTAIN_MULTI_ACCOUNT", todo: [], recentlyReported: [] }),
    );

    render(<MyReplyWork accountId="acct-1" />);

    const notice = await screen.findByTestId("reply-work-coverage-uncertain");
    expect(notice).toHaveTextContent("안전하게 판단할 수 없어요");
    expect(screen.queryByTestId("reply-work-todo-empty")).not.toBeInTheDocument();
  });

  it("a dead read never renders as an empty worklist", async () => {
    vi.spyOn(api, "getReplyWork").mockRejectedValue(new Error("backend down"));

    render(<MyReplyWork accountId="acct-1" />);

    await waitFor(() =>
      expect(screen.getByText(/답변 작업을 불러오지 못했습니다/)).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("reply-work-todo-empty")).not.toBeInTheDocument();
  });
});
