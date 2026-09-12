// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ReviewReplyTask, ReviewReplyTaskEntry } from "./ReviewReplyTask";
import type {
  ChannelReviewDetailView,
  ReviewDecisionContext,
  ReviewDecisionLogEntry,
  ReviewDetailResponse,
  ReviewReplyPrep,
} from "../../lib/types";
import { expectNoAxeViolations } from "../../test/axe";

const getChannelReviewStrict = vi.fn();
const getReviewDetailStrict = vi.fn();
const getReviewReplyPrep = vi.fn();
const getReviewDecisionContext = vi.fn();
const getReviewDecisionLog = vi.fn();
const recordVocItemTriage = vi.fn();
const recordChannelReviewTriageAction = vi.fn();
const correctChannelReviewTriage = vi.fn();
const withdrawChannelReviewTriageCorrection = vi.fn();

vi.mock("../../lib/apiClient", () => ({
  api: {
    getChannelReviewStrict: (...a: unknown[]) => getChannelReviewStrict(...a),
    getReviewDetailStrict: (...a: unknown[]) => getReviewDetailStrict(...a),
    getReviewReplyPrep: (...a: unknown[]) => getReviewReplyPrep(...a),
    getReviewDecisionContext: (...a: unknown[]) => getReviewDecisionContext(...a),
    getReviewDecisionLog: (...a: unknown[]) => getReviewDecisionLog(...a),
    recordVocItemTriage: (...a: unknown[]) => recordVocItemTriage(...a),
    recordChannelReviewTriageAction: (...a: unknown[]) => recordChannelReviewTriageAction(...a),
    correctChannelReviewTriage: (...a: unknown[]) => correctChannelReviewTriage(...a),
    withdrawChannelReviewTriageCorrection: (...a: unknown[]) => withdrawChannelReviewTriageCorrection(...a),
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
    sellerCorrection: null,
    locateTarget: { productId: null, vendorItemId: null, writtenOn: null, rating: null },
    replyWork: {
      actionRef: `review:${REVIEW}`,
      triageDisposition: "RESPONSE_NEEDED",
      hasReplyPreparation: true,
      channelReplyState: "PENDING",
    },
    ...over,
  };
}

function context(over: Partial<ReviewDecisionContext> = {}): ReviewDecisionContext {
  return {
    reviewId: REVIEW,
    decisionRef: `review:${REVIEW}`,
    currentDecision: "RESPONSE_NEEDED",
    channelCode: "NAVER",
    productId: null,
    productName: "합성 전선몰딩",
    repeatedProblems: [],
    productSignal: { reviews: 12, negativeReviews: 3 },
    knowledge: { productSources: 0, orgSources: 0, productTitles: [], openAsks: 0 },
    ...over,
  };
}

function prep(over: Partial<ReviewReplyPrep> = {}): ReviewReplyPrep {
  return {
    actionRef: `review:${REVIEW}`,
    redactedBody: "괜찮긴한데 자꾸 떨어져요",
    bodyRedacted: false,
    triageDisposition: "RESPONSE_NEEDED",
    draftAuthorKind: null,
    draftEvidence: [],
    draftAnswerBasis: null,
    draftAnswerBasisNote: null,
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

/** The read the id-only entry resolves an account with — the workspace itself no longer makes it. */
function reviewDetail(over: Partial<ReviewDetailResponse> = {}): ReviewDetailResponse {
  return {
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

// The workspace's second and third reads. Defaulted so a test that is not about them does not have to
// state them; the tests that ARE about them override these lines.
beforeEach(() => {
  getReviewDecisionContext.mockResolvedValue(context());
  getReviewDecisionLog.mockResolvedValue([] as ReviewDecisionLogEntry[]);
  getReviewDetailStrict.mockResolvedValue(reviewDetail());
});
afterEach(() => vi.clearAllMocks());

/**
 * <b>Review Decision Workspace v1</b> — one review, decided.
 *
 * What these pin is the ORDER and the HONESTY of the screen, not new capability: every write behind it
 * existed before and is unchanged. So the assertions are about what the seller can see before they
 * decide (the customer's words, why the review is ranked, whether anyone said it before, what a reply
 * would stand on), that their own judgment stands beside the system's rather than over it, that the
 * draft follows the chosen action rather than preceding it, and that nothing about any of it is
 * invented when a read does not return.
 */
describe("리뷰 처리 — the decision workspace", () => {
  it("opens the exact review and leads with the customer's words, not with the draft", async () => {
    getChannelReviewStrict.mockResolvedValue(detail());
    getReviewReplyPrep.mockResolvedValue(prep());
    renderTask();

    await waitFor(() => expect(screen.getAllByText("합성 전선몰딩").length).toBeGreaterThan(0));
    expect(getChannelReviewStrict).toHaveBeenCalledWith(ACCOUNT, REVIEW);
    expect(getReviewDecisionContext).toHaveBeenCalledWith(ACCOUNT, REVIEW);
    expect(getReviewDecisionLog).toHaveBeenCalledWith(ACCOUNT, REVIEW);

    // The customer's sentence is on the page and NOT behind a fold — the defect this screen closes.
    const body = await screen.findByText("괜찮긴한데 자꾸 떨어져요");
    expect(body.closest("details")).toBeNull();
    // And the reason the review is ranked stands with it rather than under 「자동 분류」.
    expect(screen.getByText("같은 분류가 늘어나는지 지켜보세요.")).toBeInTheDocument();
    // The tier chip is on the problem card; 판매자 판단 names it again on purpose, as the thing
    // the seller is agreeing or disagreeing with.
    expect(screen.getAllByText("참고").length).toBeGreaterThan(0);

    // The work still ends where it used to: the draft, and the approve control as the page's primary.
    expect(await screen.findByDisplayValue("판매자가 고쳐 쓴 합성 초안")).toBeInTheDocument();
    const approve = await screen.findByRole("button", { name: "승인" });
    expect(approve.className).toContain("bg-brand-700");
  });

  it("folds only the keyword classification, whose accuracy is unmeasured", async () => {
    getChannelReviewStrict.mockResolvedValue(detail());
    getReviewReplyPrep.mockResolvedValue(prep());
    const { container } = renderTask();
    await waitFor(() => expect(screen.getByText("괜찮긴한데 자꾸 떨어져요")).toBeInTheDocument());

    const fold = container.querySelector("details");
    expect(fold).not.toBeNull();
    expect(fold!.open).toBe(false);
    expect(within(fold!).getByText("자동 분류")).toBeInTheDocument();
    expect(within(fold!).getByText(/정확하지 않을 수 있습니다/)).toBeInTheDocument();
  });

  it("does not put a review list on the screen — there is exactly one review here", async () => {
    getChannelReviewStrict.mockResolvedValue(detail());
    getReviewReplyPrep.mockResolvedValue(prep());
    renderTask();
    await waitFor(() => expect(screen.getByText("괜찮긴한데 자꾸 떨어져요")).toBeInTheDocument());
    expect(screen.queryByText(/총 \d+개/)).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "분류 필터" })).not.toBeInTheDocument();
  });

  /* ── 3 · repeated signal ───────────────────────────────────────────── */

  it("names what repeats and shows what else said it, without inventing a count of its own", async () => {
    getChannelReviewStrict.mockResolvedValue(detail());
    getReviewReplyPrep.mockResolvedValue(prep());
    getReviewDecisionContext.mockResolvedValue(
      context({
        repeatedProblems: [
          {
            issueId: "iss-1",
            title: "접착 탈락",
            severity: "HIGH",
            lifecycleState: "OBSERVING",
            evidenceCount: 18,
            firstEvidenceOn: "2026-07-01",
            lastEvidenceOn: "2026-08-28",
            dismissed: false,
            similar: [
              {
                reviewId: "rev-2",
                occurredOn: "2026-08-20",
                rating: 1,
                quote: "이틀만에 떨어졌어요",
                productName: "합성 전선몰딩",
                sameProduct: true,
              },
            ],
          },
        ],
      }),
    );
    renderTask();

    const link = await screen.findByRole("link", { name: /접착 탈락/ });
    expect(link).toHaveAttribute("href", "/memory/iss-1");
    // The count is the one the read returned, org-wide and all-time — not a figure composed here.
    expect(screen.getByText("근거 18건")).toBeInTheDocument();
    expect(screen.getByText("「이틀만에 떨어졌어요」")).toBeInTheDocument();
    // Same product as the review being decided: naming it on every line would repeat one fact.
    expect(screen.queryAllByText("합성 전선몰딩").some((n) => n.textContent === "합성 전선몰딩")).toBe(true);
  });

  it("says our records hold no repeated problem — never that it has never happened", async () => {
    getChannelReviewStrict.mockResolvedValue(detail());
    getReviewReplyPrep.mockResolvedValue(prep());
    renderTask();

    expect(await screen.findByText(/아직 반복 문제의 근거로 기록되지 않았습니다/)).toBeInTheDocument();
    expect(screen.queryByText(/반복된 적 없습니다/)).toBeNull();
  });

  it("keeps the decision available when the context read fails — it loses context, not the choice", async () => {
    getChannelReviewStrict.mockResolvedValue(detail());
    getReviewReplyPrep.mockResolvedValue(prep());
    getReviewDecisionContext.mockRejectedValue(new Error("boom"));
    recordVocItemTriage.mockResolvedValue({ disposition: "MONITOR", replayed: false });
    renderTask();

    const step = await screen.findByLabelText("조치 선택");
    await userEvent.click(within(step).getByRole("button", { name: /지켜보기/ }));
    await waitFor(() => expect(recordVocItemTriage).toHaveBeenCalled());
    expect(recordVocItemTriage.mock.calls[0][1]).toBe(`review:${REVIEW}`);
  });

  it("says nothing at all about repeats when the context read fails", async () => {
    getChannelReviewStrict.mockResolvedValue(detail());
    getReviewReplyPrep.mockResolvedValue(prep());
    getReviewDecisionContext.mockRejectedValue(new Error("boom"));
    renderTask();

    // The reply work is unaffected: the context read is separate for exactly this reason.
    await waitFor(() => expect(screen.getByText("괜찮긴한데 자꾸 떨어져요")).toBeInTheDocument());
    expect(screen.queryByText("반복 신호")).toBeNull();
    expect(screen.queryByText(/기록되지 않았습니다/)).toBeNull();
    expect(await screen.findByDisplayValue("판매자가 고쳐 쓴 합성 초안")).toBeInTheDocument();
  });

  /* ── 4 · what a reply would stand on ───────────────────────────────── */

  it("says what is registered for this product, and that the draft's own citations are elsewhere", async () => {
    getChannelReviewStrict.mockResolvedValue(detail());
    getReviewReplyPrep.mockResolvedValue(prep());
    getReviewDecisionContext.mockResolvedValue(
      context({
        productId: "prod-9",
        knowledge: { productSources: 2, orgSources: 5, productTitles: ["부착 안내", "규격표"], openAsks: 3 },
      }),
    );
    renderTask();

    expect(await screen.findByText("등록된 상품 지식 2건")).toBeInTheDocument();
    expect(screen.getByText("회사 운영 기준 5건")).toBeInTheDocument();
    expect(screen.getByText("부착 안내 · 규격표")).toBeInTheDocument();
    expect(screen.getByText(/확인 필요가 3건 있습니다/)).toBeInTheDocument();
    expect(screen.getByText(/초안이 실제로 무엇을 근거로 썼는지는/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "답변 기준 보기" })).toHaveAttribute("href", "/knowledge");
  });

  it("prints no product counts for a review bound to no product", async () => {
    getChannelReviewStrict.mockResolvedValue(detail({ productName: null }));
    getReviewReplyPrep.mockResolvedValue(prep());
    getReviewDecisionContext.mockResolvedValue(context({ productId: null, productName: null, productSignal: null }));
    renderTask();

    expect(await screen.findByText("상품 미지정")).toBeInTheDocument();
    expect(screen.queryByText(/^리뷰 \d+건$/)).toBeNull();
  });

  /* ── 5 · the seller's own judgment ─────────────────────────────────── */

  it("asks for the seller's judgment beside the system's, and records it without moving anything", async () => {
    getChannelReviewStrict.mockResolvedValue(detail());
    getReviewReplyPrep.mockResolvedValue(prep());
    correctChannelReviewTriage.mockResolvedValue({
      reviewId: REVIEW,
      correctedTier: "NEEDS_ATTENTION",
      reasonCode: null,
      systemTier: "FYI",
      systemSource: "RULES",
      correctedAt: "2026-09-12T00:00:00Z",
      changeCount: 1,
    });
    renderTask();

    const judgment = await screen.findByLabelText("판매자 판단");
    expect(within(judgment).getByText("시스템 판단")).toBeInTheDocument();
    await userEvent.click(within(judgment).getByRole("button", { name: "확인 필요" }));

    await waitFor(() =>
      expect(correctChannelReviewTriage).toHaveBeenCalledWith(ACCOUNT, REVIEW, {
        tier: "NEEDS_ATTENTION",
        reasonCode: null,
      }),
    );
    expect(within(judgment).getByText(/덮어쓰지 않고 함께 기록됩니다/)).toBeInTheDocument();
  });

  /**
   * Migrated from the record screen when the workspace became the canonical mutation surface. The
   * contract is unchanged — three values, read back from the store, withdrawable, and available with
   * no AI pilot — only the surface that owns it moved.
   */
  it("offers all three tiers — 지켜보기 and 참고 are the seller's to choose, not the rule's to derive", async () => {
    getChannelReviewStrict.mockResolvedValue(detail());
    getReviewReplyPrep.mockResolvedValue(prep());
    renderTask();

    const block = await screen.findByLabelText("판매자 판단");
    expect(within(block).getByRole("button", { name: "확인 필요" })).toBeInTheDocument();
    expect(within(block).getByRole("button", { name: "지켜보기" })).toBeInTheDocument();
    expect(within(block).getByRole("button", { name: "참고" })).toBeInTheDocument();
  });

  it("reads a standing correction back from the store and shows BOTH judgments", async () => {
    getChannelReviewStrict.mockResolvedValue(
      detail({
        triage: { tier: "NEEDS_ATTENTION", reason: "낮은 별점", tags: [], recommendedAction: null },
        sellerCorrection: {
          reviewId: REVIEW,
          correctedTier: "FYI",
          reasonCode: null,
          systemTier: "NEEDS_ATTENTION",
          systemSource: "RULES",
          correctedAt: "2026-09-11T00:00:00Z",
          changeCount: 1,
        },
      }),
    );
    getReviewReplyPrep.mockResolvedValue(prep());
    renderTask();

    const block = await screen.findByLabelText("판매자 판단");
    // Nothing was pressed in this session — this is the stored answer, rendered from the read.
    expect(correctChannelReviewTriage).not.toHaveBeenCalled();
    expect(within(block).getByRole("button", { name: "참고" })).toHaveAttribute("aria-pressed", "true");
    expect(within(block).getByText("시스템 판단")).toBeInTheDocument();
    expect(within(block).getByText("판매자 수정")).toBeInTheDocument();
  });

  it("되돌리기 appears only once a correction stands, and clears the seller's half alone", async () => {
    getChannelReviewStrict.mockResolvedValue(detail());
    getReviewReplyPrep.mockResolvedValue(prep());
    const { unmount } = renderTask();
    const none = await screen.findByLabelText("판매자 판단");
    expect(within(none).queryByRole("button", { name: "수정 되돌리기" })).toBeNull();
    unmount();

    getChannelReviewStrict.mockResolvedValue(
      detail({
        sellerCorrection: {
          reviewId: REVIEW,
          correctedTier: "WATCH",
          reasonCode: null,
          systemTier: "FYI",
          systemSource: "RULES",
          correctedAt: "2026-09-11T00:00:00Z",
          changeCount: 1,
        },
      }),
    );
    getReviewReplyPrep.mockResolvedValue(prep());
    withdrawChannelReviewTriageCorrection.mockResolvedValue(undefined);
    renderTask();

    const block = await screen.findByLabelText("판매자 판단");
    await userEvent.click(within(block).getByRole("button", { name: "수정 되돌리기" }));
    await waitFor(() => expect(withdrawChannelReviewTriageCorrection).toHaveBeenCalledWith(ACCOUNT, REVIEW));
    // The system's judgment is untouched by a withdrawal — only the seller's half goes.
    expect(within(block).getByText("시스템 판단")).toBeInTheDocument();
  });

  it("asks for the seller's judgment with the AI pilot silent — the pilot is not permission to disagree", async () => {
    getChannelReviewStrict.mockResolvedValue(detail({ aiMark: null }));
    getReviewReplyPrep.mockResolvedValue(prep());
    renderTask();

    const block = await screen.findByLabelText("판매자 판단");
    expect(within(block).getByRole("button", { name: "확인 필요" })).toBeInTheDocument();
    expect(within(block).queryByText("AI 확인 필요")).toBeNull();
  });

  /* ── 6 · 조치 선택 ─────────────────────────────────────────────────── */

  it("writes the decision against the address the server minted, not the reply's", async () => {
    getChannelReviewStrict.mockResolvedValue(detail({ replyWork: null }));
    getReviewDecisionContext.mockResolvedValue(context({ currentDecision: null, decisionRef: "review:rev-1" }));
    recordVocItemTriage.mockResolvedValue({ disposition: "MONITOR", replayed: false });
    renderTask();

    const step = await screen.findByLabelText("조치 선택");
    await userEvent.click(within(step).getByRole("button", { name: /지켜보기/ }));

    await waitFor(() => expect(recordVocItemTriage).toHaveBeenCalled());
    expect(recordVocItemTriage.mock.calls[0][0]).toBe(ACCOUNT);
    expect(recordVocItemTriage.mock.calls[0][1]).toBe("review:rev-1");
    // A channel with no reply flow still gets a decision, and is told plainly what it does NOT get.
    expect(within(step).getByText(/reviewnary가 답변을 작성하지 않습니다/)).toBeInTheDocument();
    expect(getReviewReplyPrep).not.toHaveBeenCalled();
  });

  it("offers 조치 완료 only once a decision stands, and never on 조치 불필요", async () => {
    getChannelReviewStrict.mockResolvedValue(detail({ replyWork: null }));
    getReviewDecisionContext.mockResolvedValue(context({ currentDecision: null }));
    const { unmount } = renderTask();
    const undecided = await screen.findByLabelText("조치 선택");
    expect(within(undecided).queryByRole("button", { name: "조치 완료함" })).toBeNull();
    unmount();

    getChannelReviewStrict.mockResolvedValue(detail({ replyWork: null }));
    getReviewDecisionContext.mockResolvedValue(context({ currentDecision: "NO_ACTION" }));
    const closed = renderTask();
    const closedStep = await screen.findByLabelText("조치 선택");
    expect(within(closedStep).queryByRole("button", { name: "조치 완료함" })).toBeNull();
    closed.unmount();

    getChannelReviewStrict.mockResolvedValue(detail({ replyWork: null }));
    getReviewDecisionContext.mockResolvedValue(context({ currentDecision: "MONITOR" }));
    recordChannelReviewTriageAction.mockResolvedValue(undefined);
    renderTask();
    const watching = await screen.findByLabelText("조치 선택");
    await userEvent.click(within(watching).getByRole("button", { name: "조치 완료함" }));
    await waitFor(() =>
      expect(recordChannelReviewTriageAction).toHaveBeenCalledWith(ACCOUNT, REVIEW, "ACTION_COMPLETED"),
    );
    // 조치 불필요 is the DECISION's word; recording it here too would count one press twice.
    expect(within(watching).queryByRole("button", { name: "조치 불필요함" })).toBeNull();
  });

  /* ── 7 · the draft follows the choice ──────────────────────────────── */

  it("does not open a draft for a review the seller decided to watch", async () => {
    getChannelReviewStrict.mockResolvedValue(
      detail({
        replyWork: {
          actionRef: `review:${REVIEW}`,
          triageDisposition: "MONITOR",
          hasReplyPreparation: false,
          channelReplyState: "PENDING",
        },
      }),
    );
    getReviewDecisionContext.mockResolvedValue(context({ currentDecision: "MONITOR" }));
    renderTask();

    await screen.findByLabelText("조치 선택");
    expect(screen.queryByText("답변 준비")).toBeNull();
    expect(getReviewReplyPrep).not.toHaveBeenCalled();
  });

  it("keeps existing reply work reachable after the seller moves the review to 지켜보기", async () => {
    getChannelReviewStrict.mockResolvedValue(
      detail({
        replyWork: {
          actionRef: `review:${REVIEW}`,
          triageDisposition: "MONITOR",
          hasReplyPreparation: true,
          channelReplyState: "PENDING",
        },
      }),
    );
    getReviewDecisionContext.mockResolvedValue(context({ currentDecision: "MONITOR" }));
    getReviewReplyPrep.mockResolvedValue(prep({ triageDisposition: "MONITOR" }));
    renderTask();

    // A draft that exists must stay readable and any approval withdrawable — otherwise an approved
    // reply is stranded where the seller can neither see nor take it back.
    expect(await screen.findByDisplayValue("판매자가 고쳐 쓴 합성 초안")).toBeInTheDocument();
  });

  it("says a channel with no reply flow has none, rather than rendering a dead panel", async () => {
    getChannelReviewStrict.mockResolvedValue(detail({ replyWork: null }));
    renderTask();
    await waitFor(() =>
      expect(screen.getByText("이 채널에서는 reviewnary가 답변을 작성하지 않습니다.")).toBeInTheDocument(),
    );
    expect(getReviewReplyPrep).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "승인" })).not.toBeInTheDocument();
  });

  /* ── 8 · the log ───────────────────────────────────────────────────── */

  it("shows what was already decided, newest first, from the trails that already existed", async () => {
    getChannelReviewStrict.mockResolvedValue(detail());
    getReviewReplyPrep.mockResolvedValue(prep());
    getReviewDecisionLog.mockResolvedValue([
      { kind: "REPLY_APPROVAL", from: null, to: "APPROVED", at: "2026-09-10T01:00:00Z" },
      { kind: "ACTION_CHOSEN", from: null, to: "RESPONSE_NEEDED", at: "2026-09-09T01:00:00Z" },
      { kind: "SELLER_JUDGMENT_SET", from: null, to: "NEEDS_ATTENTION", at: "2026-09-08T01:00:00Z" },
    ]);
    renderTask();

    const log = await screen.findByLabelText("기록");
    const rows = within(log).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("답변을 승인");
    expect(rows[1]).toHaveTextContent("조치를 대응 필요(으)로 정함");
    expect(rows[2]).toHaveTextContent("판매자 판단을 확인 필요(으)로 기록");
    expect(within(log).getByText(/마켓플레이스에는 아무것도 전송되지 않습니다/)).toBeInTheDocument();
  });

  it("draws no row for an entry this build cannot name", async () => {
    getChannelReviewStrict.mockResolvedValue(detail());
    getReviewReplyPrep.mockResolvedValue(prep());
    getReviewDecisionLog.mockResolvedValue([
      { kind: "ACTION_RECORDED", from: null, to: "SOMETHING_NEW", at: "2026-09-10T01:00:00Z" },
    ] as unknown as ReviewDecisionLogEntry[]);
    renderTask();

    const log = await screen.findByLabelText("기록");
    expect(within(log).queryByText(/SOMETHING_NEW/)).toBeNull();
    expect(within(log).getByText("아직 이 리뷰에 기록된 판단이 없습니다.")).toBeInTheDocument();
  });

  it("says nothing about history when the log read fails", async () => {
    getChannelReviewStrict.mockResolvedValue(detail());
    getReviewReplyPrep.mockResolvedValue(prep());
    getReviewDecisionLog.mockRejectedValue(new Error("boom"));
    renderTask();

    await waitFor(() => expect(screen.getByText("괜찮긴한데 자꾸 떨어져요")).toBeInTheDocument());
    expect(screen.queryByLabelText("기록")).toBeNull();
  });

  /* ── the surrounding contract, unchanged ───────────────────────────── */

  it("offers the way back to the conversation only when a conversation sent the seller here", async () => {
    getChannelReviewStrict.mockResolvedValue(detail());
    getReviewReplyPrep.mockResolvedValue(prep());
    const { unmount } = renderTask();
    await waitFor(() => expect(screen.getByText("괜찮긴한데 자꾸 떨어져요")).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: "대화로 돌아가기" })).not.toBeInTheDocument();
    unmount();

    getChannelReviewStrict.mockResolvedValue(detail());
    getReviewReplyPrep.mockResolvedValue(prep());
    renderTask("?from=chat");
    await waitFor(() => expect(screen.getByText("괜찮긴한데 자꾸 떨어져요")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "대화로 돌아가기" })).toHaveAttribute("href", "/");
  });

  it("fails closed when the review cannot be read — never an invented review", async () => {
    getChannelReviewStrict.mockRejectedValue(new Error("nope"));
    renderTask();
    expect(await screen.findByText("이 리뷰를 불러오지 못했습니다")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "승인" })).not.toBeInTheDocument();
  });

  it("says the channel already answered, before anyone decides anything", async () => {
    getChannelReviewStrict.mockResolvedValue(
      detail({
        replyWork: {
          actionRef: `review:${REVIEW}`,
          triageDisposition: null,
          hasReplyPreparation: false,
          channelReplyState: "ANSWERED",
        },
      }),
    );
    getReviewDecisionContext.mockResolvedValue(context({ currentDecision: null }));
    renderTask();

    expect(await screen.findByText("채널에 이미 답변이 등록된 리뷰입니다")).toBeInTheDocument();
    // The channel's statement is NOT the seller's decision: the choice is still open, and nothing
    // claims the review has been handled.
    expect(screen.getByRole("button", { name: /대응 필요/ })).toBeInTheDocument();
    expect(screen.queryByText(/처리 완료/)).toBeNull();
  });

  it("has no accessibility violations", async () => {
    getChannelReviewStrict.mockResolvedValue(detail());
    getReviewReplyPrep.mockResolvedValue(prep());
    getReviewDecisionContext.mockResolvedValue(
      context({
        productId: "prod-9",
        knowledge: { productSources: 1, orgSources: 1, productTitles: ["부착 안내"], openAsks: 1 },
        repeatedProblems: [
          {
            issueId: "iss-1",
            title: "접착 탈락",
            severity: "HIGH",
            lifecycleState: "OBSERVING",
            evidenceCount: 18,
            firstEvidenceOn: "2026-07-01",
            lastEvidenceOn: "2026-08-28",
            dismissed: false,
            similar: [],
          },
        ],
      }),
    );
    getReviewDecisionLog.mockResolvedValue([
      { kind: "ACTION_CHOSEN", from: null, to: "RESPONSE_NEEDED", at: "2026-09-09T01:00:00Z" },
    ]);
    const { container } = renderTask();
    await waitFor(() => expect(screen.getByText("괜찮긴한데 자꾸 떨어져요")).toBeInTheDocument());
    await expectNoAxeViolations(container);
  });

  it("opens the product only once a product id is actually resolved", async () => {
    getChannelReviewStrict.mockResolvedValue(detail());
    getReviewReplyPrep.mockResolvedValue(prep());
    getReviewDecisionContext.mockResolvedValue(context({ productId: "prod-9" }));
    renderTask();

    const links = await screen.findAllByRole("link", { name: "합성 전선몰딩" });
    expect(links[0]).toHaveAttribute("href", "/products/prod-9");
  });
});

/**
 * The id-only address. A conversation holds a review id and nothing else, so the account is resolved
 * here rather than becoming a second identifier on the wire.
 */
describe("리뷰 처리 — reached by the review alone", () => {
  function renderEntry(search = "") {
    return render(
      <MemoryRouter initialEntries={[`/reviews/reply/${REVIEW}${search}`]}>
        <Routes>
          <Route path="/reviews/reply/:reviewId" element={<ReviewReplyTaskEntry />} />
          <Route path="/reviews/:accountId/reply/:reviewId" element={<div>도착: 리뷰 처리</div>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("resolves the account from the review and lands on its workspace", async () => {
    getReviewDetailStrict.mockResolvedValue(reviewDetail());
    renderEntry("?from=chat");
    expect(await screen.findByText("도착: 리뷰 처리")).toBeInTheDocument();
    expect(getReviewDetailStrict).toHaveBeenCalledWith(REVIEW);
  });

  it("says so when the review is not this org's, rather than routing somewhere that cannot load", async () => {
    getReviewDetailStrict.mockRejectedValue(new Error("404"));
    renderEntry();
    expect(await screen.findByText("이 리뷰를 찾지 못했습니다")).toBeInTheDocument();
  });

  it("says so when the review carries no account binding — every endpoint here is account-scoped", async () => {
    getReviewDetailStrict.mockResolvedValue(reviewDetail({ sellerAccountId: null }));
    renderEntry();
    expect(await screen.findByText("이 리뷰의 판매 계정을 확인하지 못했습니다")).toBeInTheDocument();
  });
});
