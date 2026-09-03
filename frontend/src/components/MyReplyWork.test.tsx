// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { MyReplyWork } from "./MyReplyWork";
import { api } from "../lib/apiClient";
import type {
  OperatorDismissedReplyWorkView,
  OperatorReplyWorkView,
  OperatorVocItem,
} from "../lib/types";

// A queue row is a link to the review's reply work surface (/reviews/reply/{id}), so these render
// inside a router. The rows carry no reply panel of their own any more — see ReplyWorkRow.
const render = (ui: React.ReactElement) => {
  const result = rtlRender(<MemoryRouter>{ui}</MemoryRouter>);
  return { ...result, rerender: (next: React.ReactElement) => result.rerender(<MemoryRouter>{next}</MemoryRouter>) };
};

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

describe("MyReplyWork — what the seller is being asked to do (Approval Path v1 §2)", () => {
  it("leads with what one press finishes, and says how many of those there are", async () => {
    vi.spyOn(api, "getReplyWork").mockResolvedValue(
      view({
        todo: [
          item({ actionRef: "review:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", replyWorkState: "APPROVED", hasReplyPreparation: true }),
          item({ actionRef: "review:bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", replyWorkState: "DRAFT_NEEDED" }),
          item({ actionRef: "review:cccccccc-cccc-cccc-cccc-cccccccccccc", replyWorkState: "AWAITING_APPROVAL", hasReplyPreparation: true }),
        ],
      }),
    );

    render(<MyReplyWork accountId="acct-1" />);

    const todo = await screen.findByTestId("reply-work-todo");
    // CONTRACT CHANGED (Operational Workspace UX System v1): a queue row carries ONE state word from
    // `lib/workState.ts` and no sr-only disambiguating prefix, because there is no longer a row of
    // four chips to disambiguate it from. The ordering contract is unchanged and is what this asserts.
    const states = within(todo)
      .getAllByRole("listitem")
      .map((li) => (li.textContent ?? "").slice(0, 6));
    // 승인 대기 first; 승인됨 last, because its remaining step is outside this product.
    expect(states[0]).toContain("승인 대기");
    expect(states[1]).toContain("초안 필요");
    expect(states[2]).toContain("승인됨");
    // Only what a press finishes is counted — a heading over three rows saying 「3건」 would be a
    // number the seller cannot act on.
    expect(screen.getByTestId("reply-work-waiting")).toHaveTextContent("승인 대기 1건");
  });

  it("says nothing about a count when nothing is waiting", async () => {
    vi.spyOn(api, "getReplyWork").mockResolvedValue(
      view({ todo: [item({ replyWorkState: "DRAFT_NEEDED" })] }),
    );
    render(<MyReplyWork accountId="acct-1" />);
    await screen.findByTestId("reply-work-todo");
    expect(screen.queryByTestId("reply-work-waiting")).toBeNull();
  });
});

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

  it("작업에서 제외 asks first, explaining what it does and does NOT do — before any write", async () => {
    vi.spyOn(api, "getReplyWork").mockResolvedValue(view({ todo: [item()] }));
    const dismiss = vi.spyOn(api, "dismissReplyWork");

    render(<MyReplyWork accountId="acct-1" />);

    const button = await screen.findByTestId("reply-work-dismiss");
    await userEvent.click(button);

    // The confirmation states the facts that keep this from reading as a completion or a deletion:
    // it leaves ONLY this list, the draft/history survive, nothing is recorded as replied, and the
    // review can be recovered from 제외한 작업.
    const confirm = await screen.findByTestId("reply-work-dismiss-confirm");
    expect(confirm).toHaveTextContent("'내 답변 작업'");
    expect(confirm).toHaveTextContent("저장한 초안과 기록은 그대로");
    expect(confirm).toHaveTextContent(/답변한 것으로\s*기록되지 않습니다/);
    expect(confirm).toHaveTextContent(/'제외한 작업'에서 다시 확인하고 복원/);
    // The click OPENS the confirmation — it must not have written anything yet.
    expect(dismiss).not.toHaveBeenCalled();
  });

  it("취소 backs out of 작업에서 제외 with nothing written and the row still present", async () => {
    vi.spyOn(api, "getReplyWork").mockResolvedValue(view({ todo: [item()] }));
    const dismiss = vi.spyOn(api, "dismissReplyWork");

    render(<MyReplyWork accountId="acct-1" />);

    await userEvent.click(await screen.findByTestId("reply-work-dismiss"));
    await userEvent.click(await screen.findByTestId("reply-work-dismiss-cancel"));

    // No write, the confirmation is gone, and the row (its dismiss control) is still here.
    expect(dismiss).not.toHaveBeenCalled();
    expect(screen.queryByTestId("reply-work-dismiss-confirm")).not.toBeInTheDocument();
    expect(screen.getByTestId("reply-work-dismiss")).toBeInTheDocument();
    expect(screen.queryByTestId("reply-work-dismissed-notice")).not.toBeInTheDocument();
  });

  it("confirming 작업에서 제외 sets the row aside, feeds back success, and claims no completion", async () => {
    const firstRef = "review:11111111-1111-1111-1111-111111111111";
    const kept = item({ actionRef: "review:22222222-2222-2222-2222-222222222222", rating: 3 });
    const spy = vi
      .spyOn(api, "getReplyWork")
      .mockResolvedValueOnce(view({ todo: [item({ actionRef: firstRef }), kept] })) // before
      .mockResolvedValueOnce(view({ todo: [kept] })); // after the dismissal refetch
    const dismiss = vi
      .spyOn(api, "dismissReplyWork")
      .mockResolvedValue({ actionRef: firstRef, replayed: false });

    render(<MyReplyWork accountId="acct-1" />);

    const buttons = await screen.findAllByTestId("reply-work-dismiss");
    await userEvent.click(buttons[0]!);
    await userEvent.click(await screen.findByTestId("reply-work-dismiss-confirm-yes"));

    // It calls the dismiss endpoint (with an idempotency key), never an outcome/completion write.
    await waitFor(() => expect(dismiss).toHaveBeenCalledTimes(1));
    const [, ref, body] = dismiss.mock.calls[0]!;
    expect(ref).toBe(firstRef);
    expect(body.commandId).toBeTruthy();
    // Success is ACKNOWLEDGED, not silent — and the acknowledgement itself repeats that the draft
    // and record survive.
    const notice = await screen.findByTestId("reply-work-dismissed-notice");
    expect(notice).toHaveTextContent("제외했어요");
    expect(notice).toHaveTextContent("저장한 초안과 기록은 그대로");
    // The list refetched and the set-aside row is gone; the other remains.
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getAllByTestId("reply-work-dismiss")).toHaveLength(1),
    );
    // Never a completion word anywhere on the surface.
    expect(screen.queryByText(/답변 완료/)).not.toBeInTheDocument();
  });

  it("does not carry a dismissal success banner across an account switch", async () => {
    // 내 답변 작업 is reused, not remounted, when the seller switches channels on the multi-account
    // surface (the 리뷰 screen keeps one instance and swaps `accountId`). The success banner is
    // account-specific: a '제외했어요' acknowledgement from account A must never read as an action on
    // account B, where the seller set nothing aside.
    const ref = "review:11111111-1111-1111-1111-111111111111";
    vi.spyOn(api, "getReplyWork")
      .mockResolvedValueOnce(view({ todo: [item({ actionRef: ref })] })) // acct-1 initial
      .mockResolvedValueOnce(view({ todo: [] })) // acct-1 refetch after dismiss
      .mockResolvedValue(
        view({
          sellerAccountId: "acct-2",
          todo: [
            item({
              actionRef: "review:22222222-2222-2222-2222-222222222222",
              productName: "계정2-상품",
            }),
          ],
        }),
      ); // acct-2
    vi.spyOn(api, "dismissReplyWork").mockResolvedValue({ actionRef: ref, replayed: false });

    const { rerender } = render(<MyReplyWork accountId="acct-1" />);
    await userEvent.click(await screen.findByTestId("reply-work-dismiss"));
    await userEvent.click(await screen.findByTestId("reply-work-dismiss-confirm-yes"));
    await screen.findByTestId("reply-work-dismissed-notice");

    // Switch channels on the same instance, and wait until acct-2's worklist has actually rendered —
    // not the transient loading frame — before asserting the banner is gone.
    rerender(<MyReplyWork accountId="acct-2" />);
    await screen.findByText("계정2-상품");

    expect(screen.queryByTestId("reply-work-dismissed-notice")).not.toBeInTheDocument();
  });

  it("offers NO triage control — a queue row states the work, it does not re-decide it", async () => {
    // CONTRACT CHANGED (Operational Workspace UX System v1). This used to assert that the triage
    // DECISION was shown here as a read-only label. It is not shown here any more, and that is the
    // point: a row wore four state words at once (승인 대기 · 상태 미상 · 대응 필요 · 기타) and none of
    // them was the one a seller scanning a worklist asks for. The row keeps the WORK state; the
    // triage decision is read and edited on the surfaces that own it (the review detail, and the
    // reply work screen this row opens). The original assertion — no interactive triage affordance
    // here — is unchanged and is now true by construction.
    vi.spyOn(api, "getReplyWork").mockResolvedValue(view({ todo: [item()] }));

    render(<MyReplyWork accountId="acct-1" />);

    const todo = await screen.findByTestId("reply-work-todo");
    expect(todo).toHaveTextContent("초안 필요");
    expect(screen.queryByRole("group", { name: "처리 상태" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "지켜보기" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "조치 불필요" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "대응 필요" })).not.toBeInTheDocument();
  });

  it("opens the review's reply work surface — and reads nothing per row to do it", async () => {
    // CONTRACT CHANGED (Operational Workspace UX System v1). This used to assert that the reply
    // PANEL mounted inside the queue row. It mounted one per row, and four rows of work came to
    // ~2,300px — the review record itself began 4,000px down the page. The flow is not withheld; it
    // moved to the screen built for it, which is one viewport tall at every width and where the
    // approve control sits above the fold.
    vi.spyOn(api, "getReplyWork").mockResolvedValue(view({ todo: [item()] }));
    const prep = vi.spyOn(api, "getReviewReplyPrep");

    render(<MyReplyWork accountId="acct-1" />);

    const row = await screen.findByRole("link", { name: /합성 미리보기/ });
    expect(row).toHaveAttribute("href", "/reviews/reply/11111111-1111-1111-1111-111111111111");
    // The queue costs ONE read. A panel per row is a read per row.
    expect(prep).not.toHaveBeenCalled();
  });

  it("a row that is not a review record offers no door, and still reads", async () => {
    // A Cafe24 community article has no `reviews` row, so there is nothing to open. A capability
    // limit renders as the absence of an affordance, never as the absence of the row.
    vi.spyOn(api, "getReplyWork").mockResolvedValue(
      view({ todo: [item({ reviewId: null, safePreview: "문의글 미리보기" })] }),
    );

    render(<MyReplyWork accountId="acct-1" />);

    expect(await screen.findByText("문의글 미리보기")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /문의글 미리보기/ })).not.toBeInTheDocument();
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

// --- 제외한 작업 (recovery list + 복원) --------------------------------------------------------------

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

describe("MyReplyWork — 제외한 작업 (recovery)", () => {
  it("is LAZY — the recovery list is not read until the seller opens it", async () => {
    vi.spyOn(api, "getReplyWork").mockResolvedValue(view({ todo: [] }));
    const dismissed = vi.spyOn(api, "getDismissedReplyWork").mockResolvedValue(dismissedView());

    render(<MyReplyWork accountId="acct-1" />);

    // The toggle exists, but nothing was read on mount — the common load pays nothing for recovery.
    const toggle = await screen.findByTestId("dismissed-work-toggle");
    expect(dismissed).not.toHaveBeenCalled();

    await userEvent.click(toggle);

    await waitFor(() => expect(dismissed).toHaveBeenCalledTimes(1));
  });

  it("lists set-aside reviews and restores one — refetching the to-do, claiming no completion", async () => {
    const ref = "review:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const replyWork = vi.spyOn(api, "getReplyWork").mockResolvedValue(view({ todo: [] }));
    vi.spyOn(api, "getDismissedReplyWork")
      .mockResolvedValueOnce(dismissedView({ items: [item({ actionRef: ref })] })) // opened
      .mockResolvedValue(dismissedView({ items: [] })); // after the restore re-signals it
    const restore = vi
      .spyOn(api, "restoreReplyWork")
      .mockResolvedValue({ actionRef: ref, replayed: false });

    render(<MyReplyWork accountId="acct-1" />);
    await userEvent.click(await screen.findByTestId("dismissed-work-toggle"));

    const restoreBtn = await screen.findByTestId("dismissed-work-restore");
    await userEvent.click(restoreBtn);

    // It calls restore with an idempotency key — never an outcome/completion write.
    await waitFor(() => expect(restore).toHaveBeenCalledTimes(1));
    const [, restoredRef, body] = restore.mock.calls[0]!;
    expect(restoredRef).toBe(ref);
    expect(body.commandId).toBeTruthy();
    // The restored row leaves the recovery list, and the to-do refetches so it can reappear there.
    await waitFor(() => expect(screen.queryAllByTestId("dismissed-work-restore")).toHaveLength(0));
    expect(replyWork.mock.calls.length).toBeGreaterThan(1);
    // Never a completion word on the recovery surface.
    expect(screen.queryByText(/답변 완료/)).not.toBeInTheDocument();
  });

  it("pages with 더 보기 rather than hiding older set-aside items behind a cap", async () => {
    const a = item({ actionRef: "review:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" });
    const b = item({ actionRef: "review:bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" });
    const c = item({ actionRef: "review:cccccccc-cccc-cccc-cccc-cccccccccccc" });
    vi.spyOn(api, "getReplyWork").mockResolvedValue(view({ todo: [] }));
    vi.spyOn(api, "getDismissedReplyWork")
      .mockResolvedValueOnce(dismissedView({ items: [a, b], hasMore: true, page: 0 }))
      .mockResolvedValueOnce(dismissedView({ items: [c], hasMore: false, page: 1 }));

    render(<MyReplyWork accountId="acct-1" />);
    await userEvent.click(await screen.findByTestId("dismissed-work-toggle"));

    await waitFor(() =>
      expect(screen.getAllByTestId("dismissed-work-restore")).toHaveLength(2),
    );
    await userEvent.click(screen.getByTestId("dismissed-work-more"));

    // 더 보기 appended the next page — nothing was permanently hidden.
    await waitFor(() =>
      expect(screen.getAllByTestId("dismissed-work-restore")).toHaveLength(3),
    );
    expect(screen.queryByTestId("dismissed-work-more")).not.toBeInTheDocument();
  });

  it("an unattributable scope declines — never a false 'nothing set aside'", async () => {
    vi.spyOn(api, "getReplyWork").mockResolvedValue(view({ todo: [] }));
    vi.spyOn(api, "getDismissedReplyWork").mockResolvedValue(
      dismissedView({ coverage: "UNCERTAIN_MULTI_ACCOUNT", items: [] }),
    );

    render(<MyReplyWork accountId="acct-1" />);
    await userEvent.click(await screen.findByTestId("dismissed-work-toggle"));

    expect(await screen.findByTestId("dismissed-work-coverage-uncertain")).toBeInTheDocument();
    expect(screen.queryByTestId("dismissed-work-empty")).not.toBeInTheDocument();
  });

  it("a dead recovery read never renders as an empty recovery list", async () => {
    vi.spyOn(api, "getReplyWork").mockResolvedValue(view({ todo: [] }));
    vi.spyOn(api, "getDismissedReplyWork").mockRejectedValue(new Error("backend down"));

    render(<MyReplyWork accountId="acct-1" />);
    await userEvent.click(await screen.findByTestId("dismissed-work-toggle"));

    await waitFor(() =>
      expect(screen.getByText(/제외한 작업을 불러오지 못했습니다/)).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("dismissed-work-empty")).not.toBeInTheDocument();
  });
});
