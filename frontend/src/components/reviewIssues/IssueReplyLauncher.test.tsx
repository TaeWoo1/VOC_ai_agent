// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IssueReplyLauncher } from "./IssueReplyLauncher";
import { api } from "../../lib/apiClient";
import type { ReviewIssueReplyCandidate, ReviewIssueReplyCandidates } from "../../lib/types";

// The draft→approve→guided-reply machine has its own extensive tests; here it is a marker so this
// suite tests only the launcher's resolution/gating. The triage marker calls back to record
// 대응 필요, so the embed's "reply prep appears after RESPONSE_NEEDED" rule is exercised.
vi.mock("../VocItemTriageControl", () => ({
  VocItemTriageControl: (props: { onRecorded: (d: string) => void }) => (
    <button data-testid="triage-control" onClick={() => props.onRecorded("RESPONSE_NEEDED")}>
      mark-needed
    </button>
  ),
}));
vi.mock("../VocItemReplyPrep", () => ({
  VocItemReplyPrep: (props: { actionRef: string }) => (
    <div data-testid="reply-prep">{props.actionRef}</div>
  ),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function candidate(partial: Partial<ReviewIssueReplyCandidate> = {}): ReviewIssueReplyCandidate {
  return {
    reviewId: "rev-1",
    actionRef: "review:rev-1",
    unitOrdinal: 0,
    quote: "배송이 너무 늦었어요",
    rating: 2,
    productName: "합성 상품",
    reviewDate: "2026-07-25",
    channelReplyState: "PENDING",
    reportedSubmitted: false,
    selectable: true,
    accountId: "acc-1",
    accountAmbiguous: false,
    ...partial,
  };
}

function candidates(list: ReviewIssueReplyCandidate[]): ReviewIssueReplyCandidates {
  return {
    issueId: "issue-1",
    extractorKind: "RULE_BASED",
    thresholdsVersion: "review-issue/v1",
    selectableCount: list.filter((c) => c.selectable).length,
    candidates: list,
  };
}

function stub(list: ReviewIssueReplyCandidate[]) {
  return vi.spyOn(api, "getReviewIssueReplyCandidatesStrict").mockResolvedValue(candidates(list));
}

describe("IssueReplyLauncher", () => {
  it("labels the signal as an unverified DRAFT candidate with its thresholds version", async () => {
    stub([candidate()]);
    render(<IssueReplyLauncher issueId="issue-1" />);

    await waitFor(() => expect(screen.getByText(/배송이 너무 늦었어요/)).toBeInTheDocument());
    expect(screen.getByText(/후보 신호 · 아직 검증되지 않았습니다/)).toBeInTheDocument();
    expect(screen.getByText(/review-issue\/v1/)).toBeInTheDocument();
    // Never claims a confirmed problem or a channel result.
    expect(screen.queryByText(/완료/)).not.toBeInTheDocument();
  });

  it("offers a reply control only for a selectable review, and mounts the reuse pair on open", async () => {
    stub([candidate()]);
    render(<IssueReplyLauncher issueId="issue-1" />);

    const openButton = await screen.findByRole("button", { name: "이 리뷰에 답변하기" });
    await userEvent.click(openButton);

    // Step 1: triage. The reply prep only appears once RESPONSE_NEEDED is recorded.
    const triage = screen.getByTestId("triage-control");
    expect(screen.queryByTestId("reply-prep")).not.toBeInTheDocument();
    await userEvent.click(triage);

    const prep = screen.getByTestId("reply-prep");
    expect(prep).toHaveTextContent("review:rev-1");
  });

  it("excludes an already-answered review from selection but keeps it listed", async () => {
    stub([candidate({ channelReplyState: "ANSWERED", selectable: false })]);
    render(<IssueReplyLauncher issueId="issue-1" />);

    await waitFor(() => expect(screen.getByText(/이미 답변한 리뷰입니다/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "이 리뷰에 답변하기" })).not.toBeInTheDocument();
  });

  it("fails closed on an ambiguous account rather than guessing one", async () => {
    stub([candidate({ selectable: false, accountId: null, accountAmbiguous: true })]);
    render(<IssueReplyLauncher issueId="issue-1" />);

    await waitFor(() =>
      expect(screen.getByText(/판매 계정을 먼저 선택해야 합니다/)).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: "이 리뷰에 답변하기" })).not.toBeInTheDocument();
  });

  it("says so plainly when there is no unanswered review to reply to", async () => {
    stub([]);
    render(<IssueReplyLauncher issueId="issue-1" />);

    await waitFor(() =>
      expect(screen.getByText(/답변할 수 있는 미답변 리뷰가 없습니다/)).toBeInTheDocument(),
    );
  });

  it("surfaces a load failure with recovery copy instead of a blank panel", async () => {
    vi.spyOn(api, "getReviewIssueReplyCandidatesStrict").mockRejectedValue(new Error("boom"));
    render(<IssueReplyLauncher issueId="issue-1" />);

    await waitFor(() =>
      expect(screen.getByText(/답변 후보를 불러오지 못했습니다. 다시 시도해 주세요/)).toBeInTheDocument(),
    );
  });
});
