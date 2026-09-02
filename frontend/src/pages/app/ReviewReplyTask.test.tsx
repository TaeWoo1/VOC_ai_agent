// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ReviewReplyTask, ReviewReplyTaskEntry } from "./ReviewReplyTask";
import type { ChannelReviewDetailView, ReviewDetailResponse, ReviewReplyPrep } from "../../lib/types";
import { expectNoAxeViolations } from "../../test/axe";

const getChannelReviewStrict = vi.fn();
const getReviewDetailStrict = vi.fn();
const getReviewReplyPrep = vi.fn();

vi.mock("../../lib/apiClient", () => ({
  api: {
    getChannelReviewStrict: (...a: unknown[]) => getChannelReviewStrict(...a),
    getReviewDetailStrict: (...a: unknown[]) => getReviewDetailStrict(...a),
    getReviewReplyPrep: (...a: unknown[]) => getReviewReplyPrep(...a),
  },
}));

const ACCOUNT = "acc-1";
const REVIEW = "rev-1";

function detail(over: Partial<ChannelReviewDetailView> = {}): ChannelReviewDetailView {
  return {
    id: REVIEW,
    writtenOn: "2026-08-28",
    rating: 4,
    negative: false,
    body: "괜찮긴한데 자꾸 떨어져요",
    bodyRedacted: false,
    productName: "합성 전선몰딩",
    mediaCount: 0,
    textless: false,
    isNew: false,
    triage: { tier: "FYI", reason: "같은 분류가 늘어나는지 지켜보세요.", tags: ["설치"], recommendedAction: null },
    aiMark: null,
    locateTarget: { productId: null, vendorItemId: null, writtenOn: null, rating: null },
    replyWork: { actionRef: `review:${REVIEW}`, triageDisposition: "RESPONSE_NEEDED", hasReplyPreparation: true },
    ...over,
  };
}

function prep(over: Partial<ReviewReplyPrep> = {}): ReviewReplyPrep {
  return {
    actionRef: `review:${REVIEW}`,
    redactedBody: "괜찮긴한데 자꾸 떨어져요",
    bodyRedacted: false,
    triageDisposition: "RESPONSE_NEEDED",
    suggestion: {
      body: "합성 추천 문구",
      category: "positive_reply",
      providerKind: "RULE_BASED",
      providerName: "review-reply-template",
      providerVersion: "templates-v1",
    },
    draft: {
      version: 3,
      body: "판매자가 고쳐 쓴 합성 초안",
      contentFingerprint: "a".repeat(64),
      fingerprintAlgorithm: "review-reply-v1",
      createdAt: "2026-09-02T15:17:04Z",
    },
    approval: null,
    outcome: null,
    capabilities: { canSave: true, canApprove: true, canWithdraw: false, canCopy: false, canStartSubmissionRun: false },
    channelReplyState: "PENDING",
    productName: "합성 전선몰딩",
    reviewDate: "2026-08-28",
    rating: 4,
    ...over,
  };
}

function renderTask(search = "") {
  return render(
    <MemoryRouter initialEntries={[`/reviews/${ACCOUNT}/reply/${REVIEW}${search}`]}>
      <Routes>
        <Route path="/reviews/:accountId/reply/:reviewId" element={<ReviewReplyTask />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => vi.clearAllMocks());

/**
 * Approval Path v1 §§1·3·4 — one review, its draft, and the approve button, on one screen.
 *
 * The defect this page closes was not a missing capability: the reply panel already existed and the
 * seller could already approve. It was that the only way in was the channel's whole record, so what
 * these pin is REACHABILITY — that the exact review opens from its own address, that the customer's
 * sentence and the draft and 승인 are all present without any list in between, and that the approve
 * control is the page's primary rather than a tint beside 초안 저장.
 */
describe("답변 작업 — one review's reply task", () => {
  it("opens the exact review by its own address and shows the customer's words, the draft and 승인", async () => {
    getChannelReviewStrict.mockResolvedValue(detail());
    getReviewReplyPrep.mockResolvedValue(prep());
    renderTask();

    await waitFor(() => expect(screen.getByText("합성 전선몰딩")).toBeInTheDocument());
    expect(getChannelReviewStrict).toHaveBeenCalledWith(ACCOUNT, REVIEW);
    expect(await screen.findByText("괜찮긴한데 자꾸 떨어져요")).toBeInTheDocument();
    expect(await screen.findByDisplayValue("판매자가 고쳐 쓴 합성 초안")).toBeInTheDocument();
    const approve = await screen.findByRole("button", { name: "승인" });
    expect(approve).toHaveAttribute("aria-disabled", "false");
    // The primary, not a tint: the product's measured solid brand value.
    expect(approve.className).toContain("bg-brand-700");
    // ★4 · the date, so the seller can recognise the row they were sent to.
    expect(screen.getByText(/4점/)).toBeInTheDocument();
    expect(screen.getByText("2026-08-28")).toBeInTheDocument();
  });

  it("does not put a review list on the screen — there is exactly one review here", async () => {
    getChannelReviewStrict.mockResolvedValue(detail());
    getReviewReplyPrep.mockResolvedValue(prep());
    renderTask();
    await waitFor(() => expect(screen.getByText("합성 전선몰딩")).toBeInTheDocument());
    // The record's own furniture, none of which belongs on a task screen.
    expect(screen.queryByText(/총 \d+개/)).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "분류 필터" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "정렬" })).not.toBeInTheDocument();
  });

  it("folds the tier and the keyword classification below the work rather than above it", async () => {
    getChannelReviewStrict.mockResolvedValue(detail());
    getReviewReplyPrep.mockResolvedValue(prep());
    const { container } = renderTask();
    await waitFor(() => expect(screen.getByText("합성 전선몰딩")).toBeInTheDocument());

    const disclosure = container.querySelector("details");
    expect(disclosure).not.toBeNull();
    expect(disclosure!.open).toBe(false);
    expect(screen.getByText(/이 리뷰의 자동 분류/)).toBeInTheDocument();
    // Folded, not removed: the reason is still there for a seller who wants it.
    expect(screen.getByText("같은 분류가 늘어나는지 지켜보세요.")).toBeInTheDocument();
  });

  it("offers the way back to the conversation only when a conversation sent the seller here", async () => {
    getChannelReviewStrict.mockResolvedValue(detail());
    getReviewReplyPrep.mockResolvedValue(prep());
    const { unmount } = renderTask();
    await waitFor(() => expect(screen.getByText("합성 전선몰딩")).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: "대화로 돌아가기" })).not.toBeInTheDocument();
    unmount();

    getChannelReviewStrict.mockResolvedValue(detail());
    getReviewReplyPrep.mockResolvedValue(prep());
    renderTask("?from=chat");
    await waitFor(() => expect(screen.getByText("합성 전선몰딩")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "대화로 돌아가기" })).toHaveAttribute("href", "/");
  });

  it("says a channel with no reply flow has none, rather than rendering a dead panel", async () => {
    getChannelReviewStrict.mockResolvedValue(detail({ replyWork: null }));
    renderTask();
    await waitFor(() =>
      expect(screen.getByText(/이 채널에서는 reviewnary가 답변을 작성하지 않습니다/)).toBeInTheDocument(),
    );
    expect(getReviewReplyPrep).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "승인" })).not.toBeInTheDocument();
  });

  it("fails closed when the review cannot be read — never an invented review", async () => {
    getChannelReviewStrict.mockRejectedValue(new Error("nope"));
    renderTask();
    expect(await screen.findByText("이 리뷰를 불러오지 못했습니다")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "승인" })).not.toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    getChannelReviewStrict.mockResolvedValue(detail());
    getReviewReplyPrep.mockResolvedValue(prep());
    const { container } = renderTask();
    await waitFor(() => expect(screen.getByText("합성 전선몰딩")).toBeInTheDocument());
    await expectNoAxeViolations(container);
  });
});

/**
 * The id-only address. A conversation holds a review id and nothing else, so the account is resolved
 * here rather than becoming a second identifier on the wire.
 */
describe("답변 작업 — reached by the review alone", () => {
  function renderEntry(search = "") {
    return render(
      <MemoryRouter initialEntries={[`/reviews/reply/${REVIEW}${search}`]}>
        <Routes>
          <Route path="/reviews/reply/:reviewId" element={<ReviewReplyTaskEntry />} />
          <Route path="/reviews/:accountId/reply/:reviewId" element={<div>도착: 답변 작업</div>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  const resolved = (over: Partial<ReviewDetailResponse> = {}): ReviewDetailResponse => ({
    id: REVIEW,
    sellerAccountId: ACCOUNT,
    channelCode: "NAVER",
    channelNameKo: "네이버 스마트스토어",
    writtenOn: "2026-08-28",
    rating: 4,
    negative: false,
    body: "괜찮긴한데 자꾸 떨어져요",
    bodyRedacted: false,
    productId: null,
    productName: "합성 전선몰딩",
    replyState: "PENDING",
    executableIdentity: "MARKETPLACE",
    triageTier: "FYI",
    issues: [],
    ...over,
  });

  it("resolves the account from the review and lands on its task", async () => {
    getReviewDetailStrict.mockResolvedValue(resolved());
    renderEntry("?from=chat");
    expect(await screen.findByText("도착: 답변 작업")).toBeInTheDocument();
    expect(getReviewDetailStrict).toHaveBeenCalledWith(REVIEW);
  });

  it("says so when the review is not this org's, rather than routing somewhere that cannot load", async () => {
    getReviewDetailStrict.mockRejectedValue(new Error("404"));
    renderEntry();
    expect(await screen.findByText("이 리뷰를 찾지 못했습니다")).toBeInTheDocument();
  });

  it("says so when the review carries no account binding — the reply surface is account-scoped", async () => {
    getReviewDetailStrict.mockResolvedValue(resolved({ sellerAccountId: null }));
    renderEntry();
    expect(await screen.findByText("이 리뷰의 판매 계정을 확인하지 못했습니다")).toBeInTheDocument();
  });
});
