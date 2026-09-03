// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ReplyApprovalArtifact } from "./ReplyApprovalArtifact";
import type { ApprovalRequiredArtifact } from "../../../lib/conversation/types";
import type { ReviewReplyPrep } from "../../../lib/types";

const getReviewReplyPrep = vi.fn();
const decideReviewReplyApproval = vi.fn();
vi.mock("../../../lib/apiClient", () => ({
  api: {
    getReviewReplyPrep: (...a: unknown[]) => getReviewReplyPrep(...a),
    decideReviewReplyApproval: (...a: unknown[]) => decideReviewReplyApproval(...a),
  },
  getToken: () => null,
}));

const ARTIFACT: ApprovalRequiredArtifact = {
  artifactId: "a-approval-required-rv-1",
  type: "APPROVAL_REQUIRED",
  title: "이 답변을 보내도 될까요?",
  objectKind: "REVIEW",
  reviewId: "rv-1",
  accountId: "acc-nv",
  actionRef: "ref-1",
  channelCode: "NAVER",
  channelNameKo: "네이버",
  productName: "전선몰딩",
  draftVersion: 3,
  contentFingerprint: "fp-3",
  execution: "GUIDED_BROWSER_EXECUTION",
  executableIdentity: "MARKETPLACE",
  to: "/reviews/reply/rv-1?from=chat",
};

function prep(over: Partial<ReviewReplyPrep> = {}): ReviewReplyPrep {
  return {
    actionRef: "ref-1",
    redactedBody: "포장이 찌그러져 왔어요",
    bodyRedacted: false,
    triageDisposition: "RESPONSE_NEEDED",
    suggestion: { body: "제안", category: "general_reply", providerKind: "RULE_BASED", providerName: "rule", providerVersion: "v1" },
    draft: { version: 3, body: "불편을 드려 죄송합니다. 포장을 보완하겠습니다.", contentFingerprint: "fp-3", fingerprintAlgorithm: "sha256", createdAt: "2026-09-03T00:00:00Z" },
    approval: null,
    outcome: null,
    capabilities: { canSave: true, canApprove: true, canWithdraw: false, canCopy: false, canStartSubmissionRun: false },
    channelReplyState: "PENDING",
    productName: "전선몰딩",
    reviewDate: "2026-08-28",
    rating: 4,
    ...over,
  } as ReviewReplyPrep;
}

const APPROVED = {
  state: "APPROVED" as const,
  approvedVersion: 3,
  approvedFingerprint: "fp-3",
  approvedBody: "불편을 드려 죄송합니다. 포장을 보완하겠습니다.",
  decidedAt: "2026-09-03T01:00:00Z",
};

beforeEach(() => {
  getReviewReplyPrep.mockReset();
  decideReviewReplyApproval.mockReset().mockResolvedValue({ state: "APPROVED", approvedVersion: 3 });
});

function draw() {
  return render(<MemoryRouter><ReplyApprovalArtifact artifact={ARTIFACT} /></MemoryRouter>);
}

describe("in-chat reply approval — §1: the seller approves the exact reply without leaving the thread", () => {
  it("shows the exact review, the draft in full and its version, and approves that version on a press", async () => {
    getReviewReplyPrep.mockResolvedValue(prep());
    draw();

    // What the seller must be able to read before deciding.
    expect(await screen.findByTestId("reply-approval-draft")).toHaveTextContent("불편을 드려 죄송합니다. 포장을 보완하겠습니다.");
    expect(screen.getByTestId("reply-approval-review")).toHaveTextContent("포장이 찌그러져 왔어요");
    const card = screen.getByTestId("reply-approval-artifact");
    expect(card.textContent).toContain("전선몰딩");
    expect(card.textContent).toContain("별점 4점");
    expect(card.textContent).toContain("초안 버전 3");
    // Approving is not sending, and the card says so where the button is.
    expect(card.textContent).toContain("승인해도 아직 등록되지 않습니다.");

    getReviewReplyPrep.mockResolvedValue(prep({ approval: APPROVED, capabilities: { canSave: false, canApprove: false, canWithdraw: true, canCopy: true, canStartSubmissionRun: true } }));
    await userEvent.click(screen.getByTestId("reply-approval-approve"));

    await waitFor(() =>
      expect(decideReviewReplyApproval).toHaveBeenCalledWith("acc-nv", "ref-1", expect.objectContaining({ state: "APPROVED", baseVersion: 3 })),
    );
    // §2: approval is confirmed HERE, and the one primary that follows is the guided lane.
    // The card's TITLE carries the sentence; the block under the draft carries the chip. One fact, once.
    await screen.findByTestId("reply-approval-approved");
    expect(screen.getByTestId("reply-approval-artifact")).toHaveTextContent("답변을 승인했습니다");
    expect(screen.getByText("승인함")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "네이버에 입력하기" })).toBeInTheDocument();
  });

  it("approves the version ON SCREEN, not the one the artifact was composed with", async () => {
    // The draft moved between the runtime writing the card and the seller reading it.
    getReviewReplyPrep.mockResolvedValue(prep({ draft: { version: 4, body: "다시 쓴 답변입니다.", contentFingerprint: "fp-4", fingerprintAlgorithm: "sha256", createdAt: "x" } }));
    draw();
    expect(await screen.findByTestId("reply-approval-draft")).toHaveTextContent("다시 쓴 답변입니다.");
    expect(screen.getByText(/그 사이 수정되었습니다/)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("reply-approval-approve"));
    await waitFor(() =>
      expect(decideReviewReplyApproval).toHaveBeenCalledWith("acc-nv", "ref-1", expect.objectContaining({ baseVersion: 4 })),
    );
  });

  it("§H — a STALE approval is not reusable: an approval bound to an older version offers no guided primary", async () => {
    getReviewReplyPrep.mockResolvedValue(
      prep({
        draft: { version: 4, body: "판매자가 고쳐 쓴 답변", contentFingerprint: "fp-4", fingerprintAlgorithm: "sha256", createdAt: "x" },
        approval: { ...APPROVED, approvedVersion: 3, approvedFingerprint: "fp-3" },
      }),
    );
    draw();
    await screen.findByTestId("reply-approval-draft");
    expect(screen.queryByTestId("reply-approval-approved")).toBeNull();
    expect(screen.queryByRole("button", { name: "네이버에 입력하기" })).toBeNull();
    // The seller's next move is to approve what is on screen.
    expect(screen.getByTestId("reply-approval-approve")).toBeInTheDocument();
  });

  it("an approval whose fingerprint does not match the head is stale too — a version number is not a sentence", async () => {
    getReviewReplyPrep.mockResolvedValue(prep({ approval: { ...APPROVED, approvedFingerprint: "fp-other" } }));
    draw();
    await screen.findByTestId("reply-approval-draft");
    expect(screen.queryByRole("button", { name: "네이버에 입력하기" })).toBeNull();
  });

  it("a review whose approval was already standing opens straight on the guided primary", async () => {
    getReviewReplyPrep.mockResolvedValue(prep({ approval: APPROVED, capabilities: { canSave: false, canApprove: false, canWithdraw: true, canCopy: true, canStartSubmissionRun: true } }));
    draw();
    expect(await screen.findByRole("button", { name: "네이버에 입력하기" })).toBeInTheDocument();
    expect(screen.queryByTestId("reply-approval-approve")).toBeNull();
    expect(decideReviewReplyApproval).not.toHaveBeenCalled();
  });

  it("a 409 says the answer moved and re-reads — it never retries the approval", async () => {
    getReviewReplyPrep.mockResolvedValue(prep());
    decideReviewReplyApproval.mockRejectedValue({ isAxiosError: true, response: { status: 409 } });
    draw();
    await screen.findByTestId("reply-approval-draft");
    await userEvent.click(screen.getByTestId("reply-approval-approve"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/그 사이 바뀌었습니다/);
    expect(decideReviewReplyApproval).toHaveBeenCalledTimes(1);
  });

  it("fails closed: a prep read that did not land approves nothing and offers no control", async () => {
    getReviewReplyPrep.mockRejectedValue(new Error("network"));
    draw();
    expect(await screen.findByText(/다시 읽지 못했습니다/)).toBeInTheDocument();
    expect(screen.queryByTestId("reply-approval-approve")).toBeNull();
    expect(screen.queryByRole("button", { name: "네이버에 입력하기" })).toBeNull();
  });

  it("§5 — every read and the write name THIS review's account and action ref, and nothing else", async () => {
    getReviewReplyPrep.mockResolvedValue(prep());
    draw();
    await screen.findByTestId("reply-approval-draft");
    await userEvent.click(screen.getByTestId("reply-approval-approve"));
    await waitFor(() => expect(decideReviewReplyApproval).toHaveBeenCalled());
    for (const call of [...getReviewReplyPrep.mock.calls, ...decideReviewReplyApproval.mock.calls]) {
      expect([call[0], call[1]]).toEqual(["acc-nv", "ref-1"]);
    }
  });
});
