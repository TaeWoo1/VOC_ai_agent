// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ReviewCaseView, ReviewReplyTask, ReviewReplyTaskLegacyEntry } from "./ReviewReplyTask";
import type {
  ChannelReviewDetailView,
  ReviewDecisionContext,
  ReviewDecisionLogEntry,
  ReviewReplyPrep,
} from "../../lib/types";
import { expectNoAxeViolations } from "../../test/axe";

const getReviewWorkspace = vi.fn();
const getReviewReplyPrep = vi.fn();
const getReviewDecisionContext = vi.fn();
const getReviewDecisionLog = vi.fn();
const recordReviewDecision = vi.fn();
const recordReviewTriageAction = vi.fn();
const correctReviewTriage = vi.fn();
const withdrawReviewTriageCorrection = vi.fn();
const dismissReplyWork = vi.fn();

vi.mock("../../lib/apiClient", () => ({
  api: {
    getReviewWorkspace: (...a: unknown[]) => getReviewWorkspace(...a),
    getReviewReplyPrep: (...a: unknown[]) => getReviewReplyPrep(...a),
    getReviewDecisionContext: (...a: unknown[]) => getReviewDecisionContext(...a),
    getReviewDecisionLog: (...a: unknown[]) => getReviewDecisionLog(...a),
    recordReviewDecision: (...a: unknown[]) => recordReviewDecision(...a),
    recordReviewTriageAction: (...a: unknown[]) => recordReviewTriageAction(...a),
    correctReviewTriage: (...a: unknown[]) => correctReviewTriage(...a),
    withdrawReviewTriageCorrection: (...a: unknown[]) => withdrawReviewTriageCorrection(...a),
    dismissReplyWork: (...a: unknown[]) => dismissReplyWork(...a),
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
    sellerAccountId: ACCOUNT,
    replyUnavailableReason: null,
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

function renderTask(search = "") {
  return render(
    <MemoryRouter initialEntries={[`/reviews/reply/${REVIEW}${search}`]}>
      <Routes>
        <Route path="/reviews/reply/:reviewId" element={<ReviewReplyTask />} />
      </Routes>
    </MemoryRouter>,
  );
}

// The workspace's second and third reads. Defaulted so a test that is not about them does not have to
// state them; the tests that ARE about them override these lines.
beforeEach(() => {
  getReviewDecisionContext.mockResolvedValue(context());
  getReviewDecisionLog.mockResolvedValue([] as ReviewDecisionLogEntry[]);
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
    getReviewWorkspace.mockResolvedValue(detail());
    getReviewReplyPrep.mockResolvedValue(prep());
    renderTask();

    await waitFor(() => expect(screen.getAllByText("합성 전선몰딩").length).toBeGreaterThan(0));
    // All three reads are addressed by the REVIEW. The account is not in any of them: it was never
    // the authorization, and a review no account acquired has none to send.
    expect(getReviewWorkspace).toHaveBeenCalledWith(REVIEW);
    expect(getReviewDecisionContext).toHaveBeenCalledWith(REVIEW);
    expect(getReviewDecisionLog).toHaveBeenCalledWith(REVIEW);

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
    getReviewWorkspace.mockResolvedValue(detail());
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
    getReviewWorkspace.mockResolvedValue(detail());
    getReviewReplyPrep.mockResolvedValue(prep());
    renderTask();
    await waitFor(() => expect(screen.getByText("괜찮긴한데 자꾸 떨어져요")).toBeInTheDocument());
    expect(screen.queryByText(/총 \d+개/)).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "분류 필터" })).not.toBeInTheDocument();
  });

  /* ── 3 · repeated signal ───────────────────────────────────────────── */

  it("names what repeats and shows what else said it, without inventing a count of its own", async () => {
    getReviewWorkspace.mockResolvedValue(detail());
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
    getReviewWorkspace.mockResolvedValue(detail());
    getReviewReplyPrep.mockResolvedValue(prep());
    renderTask();

    expect(await screen.findByText(/아직 반복 문제의 근거로 기록되지 않았습니다/)).toBeInTheDocument();
    expect(screen.queryByText(/반복된 적 없습니다/)).toBeNull();
  });

  it("keeps the decision available when the context read fails — it loses context, not the choice", async () => {
    getReviewWorkspace.mockResolvedValue(detail());
    getReviewReplyPrep.mockResolvedValue(prep());
    getReviewDecisionContext.mockRejectedValue(new Error("boom"));
    recordReviewDecision.mockResolvedValue({ disposition: "MONITOR", replayed: false });
    renderTask();

    const step = await screen.findByLabelText("조치 선택");
    await userEvent.click(within(step).getByRole("button", { name: /두고 보기/ }));
    await waitFor(() => expect(recordReviewDecision).toHaveBeenCalled());
    expect(recordReviewDecision.mock.calls[0][0]).toBe(REVIEW);
  });

  it("says nothing at all about repeats when the context read fails", async () => {
    getReviewWorkspace.mockResolvedValue(detail());
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
    getReviewWorkspace.mockResolvedValue(detail());
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
    getReviewWorkspace.mockResolvedValue(detail({ productName: null }));
    getReviewReplyPrep.mockResolvedValue(prep());
    getReviewDecisionContext.mockResolvedValue(context({ productId: null, productName: null, productSignal: null }));
    renderTask();

    expect(await screen.findByText("상품 미지정")).toBeInTheDocument();
    expect(screen.queryByText(/^리뷰 \d+건$/)).toBeNull();
  });

  /**
   * A browser-acquired review whose product this org does not hold yet. The channel DID name it, so the
   * screen names it too — without a product doorway, which would be a link to nothing, and without
   * 「상품 미지정」, which is this product's word for the shared bucket such rows must never be folded into.
   * And it says why the product figures are absent: not zero, not yet linked.
   */
  it("names the channel's product and says it is not linked yet, for a review the catalogue does not claim", async () => {
    getReviewWorkspace.mockResolvedValue(detail({ productName: "쿠팡 무선 이어폰" }));
    getReviewReplyPrep.mockResolvedValue(prep());
    getReviewDecisionContext.mockResolvedValue(
      context({ productId: null, productName: "쿠팡 무선 이어폰", productSignal: null }),
    );
    renderTask();

    expect(await screen.findAllByText("쿠팡 무선 이어폰")).not.toHaveLength(0);
    expect(screen.queryByText("상품 미지정")).toBeNull();
    expect(screen.queryByRole("link", { name: "상품 화면 열기" })).toBeNull();
    expect(screen.getByText(/아직 상품 목록의 상품과 연결되지 않아/)).toBeInTheDocument();
    expect(screen.queryByText(/^리뷰 \d+건$/)).toBeNull();
  });

  /* ── 5 · the seller's own judgment ─────────────────────────────────── */

  it("asks for the seller's judgment beside the system's, and records it without moving anything", async () => {
    getReviewWorkspace.mockResolvedValue(detail());
    getReviewReplyPrep.mockResolvedValue(prep());
    correctReviewTriage.mockResolvedValue({
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
      expect(correctReviewTriage).toHaveBeenCalledWith(REVIEW, {
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
    getReviewWorkspace.mockResolvedValue(detail());
    getReviewReplyPrep.mockResolvedValue(prep());
    renderTask();

    const block = await screen.findByLabelText("판매자 판단");
    expect(within(block).getByRole("button", { name: "확인 필요" })).toBeInTheDocument();
    expect(within(block).getByRole("button", { name: "지켜보기" })).toBeInTheDocument();
    expect(within(block).getByRole("button", { name: "참고" })).toBeInTheDocument();
  });

  it("reads a standing correction back from the store and shows BOTH judgments", async () => {
    getReviewWorkspace.mockResolvedValue(
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
    expect(correctReviewTriage).not.toHaveBeenCalled();
    expect(within(block).getByRole("button", { name: "참고" })).toHaveAttribute("aria-pressed", "true");
    expect(within(block).getByText("시스템 판단")).toBeInTheDocument();
    expect(within(block).getByText("판매자 수정")).toBeInTheDocument();
  });

  it("되돌리기 appears only once a correction stands, and clears the seller's half alone", async () => {
    getReviewWorkspace.mockResolvedValue(detail());
    getReviewReplyPrep.mockResolvedValue(prep());
    const { unmount } = renderTask();
    const none = await screen.findByLabelText("판매자 판단");
    expect(within(none).queryByRole("button", { name: "수정 되돌리기" })).toBeNull();
    unmount();

    getReviewWorkspace.mockResolvedValue(
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
    withdrawReviewTriageCorrection.mockResolvedValue(undefined);
    renderTask();

    const block = await screen.findByLabelText("판매자 판단");
    await userEvent.click(within(block).getByRole("button", { name: "수정 되돌리기" }));
    await waitFor(() => expect(withdrawReviewTriageCorrection).toHaveBeenCalledWith(REVIEW));
    // The system's judgment is untouched by a withdrawal — only the seller's half goes.
    expect(within(block).getByText("시스템 판단")).toBeInTheDocument();
  });

  it("asks for the seller's judgment with the AI pilot silent — the pilot is not permission to disagree", async () => {
    getReviewWorkspace.mockResolvedValue(detail({ aiMark: null }));
    getReviewReplyPrep.mockResolvedValue(prep());
    renderTask();

    const block = await screen.findByLabelText("판매자 판단");
    expect(within(block).getByRole("button", { name: "확인 필요" })).toBeInTheDocument();
    expect(within(block).queryByText("AI 확인 필요")).toBeNull();
  });

  /* ── 6 · 조치 선택 ─────────────────────────────────────────────────── */

  it("writes the decision against the review, and never against the reply's address", async () => {
    getReviewWorkspace.mockResolvedValue(
      detail({ replyWork: null, replyUnavailableReason: "CHANNEL_HAS_NO_REPLY_FLOW" }),
    );
    getReviewDecisionContext.mockResolvedValue(context({ currentDecision: null }));
    recordReviewDecision.mockResolvedValue({ disposition: "MONITOR", replayed: false });
    renderTask();

    const step = await screen.findByLabelText("조치 선택");
    await userEvent.click(within(step).getByRole("button", { name: /두고 보기/ }));

    await waitFor(() => expect(recordReviewDecision).toHaveBeenCalled());
    expect(recordReviewDecision.mock.calls[0][0]).toBe(REVIEW);
    // A channel with no reply flow still gets a decision, and is told plainly what it does NOT get.
    expect(within(step).getByText(/reviewnary가 답변을 작성하지 않습니다/)).toBeInTheDocument();
    expect(getReviewReplyPrep).not.toHaveBeenCalled();
  });

  it("offers 조치 완료 only once a decision stands, and never on 조치 불필요", async () => {
    getReviewWorkspace.mockResolvedValue(detail({ replyWork: null }));
    getReviewDecisionContext.mockResolvedValue(context({ currentDecision: null }));
    const { unmount } = renderTask();
    const undecided = await screen.findByLabelText("조치 선택");
    expect(within(undecided).queryByRole("button", { name: "조치 완료함" })).toBeNull();
    unmount();

    getReviewWorkspace.mockResolvedValue(detail({ replyWork: null }));
    getReviewDecisionContext.mockResolvedValue(context({ currentDecision: "NO_ACTION" }));
    const closed = renderTask();
    const closedStep = await screen.findByLabelText("조치 선택");
    expect(within(closedStep).queryByRole("button", { name: "조치 완료함" })).toBeNull();
    closed.unmount();

    getReviewWorkspace.mockResolvedValue(detail({ replyWork: null }));
    getReviewDecisionContext.mockResolvedValue(context({ currentDecision: "MONITOR" }));
    recordReviewTriageAction.mockResolvedValue(undefined);
    renderTask();
    const watching = await screen.findByLabelText("조치 선택");
    await userEvent.click(within(watching).getByRole("button", { name: "조치 완료함" }));
    await waitFor(() =>
      expect(recordReviewTriageAction).toHaveBeenCalledWith(REVIEW, "ACTION_COMPLETED"),
    );
    // 조치 불필요 is the DECISION's word; recording it here too would count one press twice.
    expect(within(watching).queryByRole("button", { name: "조치 불필요함" })).toBeNull();
  });

  /* ── 7 · the draft follows the choice ──────────────────────────────── */

  it("does not open a draft for a review the seller decided to watch", async () => {
    getReviewWorkspace.mockResolvedValue(
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
    getReviewWorkspace.mockResolvedValue(
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
    getReviewWorkspace.mockResolvedValue(detail({ replyWork: null }));
    renderTask();
    await waitFor(() =>
      expect(screen.getByText("이 채널에서는 reviewnary가 답변을 작성하지 않습니다.")).toBeInTheDocument(),
    );
    expect(getReviewReplyPrep).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "승인" })).not.toBeInTheDocument();
  });

  /* ── 8 · the log ───────────────────────────────────────────────────── */

  it("shows what was already decided, newest first, from the trails that already existed", async () => {
    getReviewWorkspace.mockResolvedValue(detail());
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
    getReviewWorkspace.mockResolvedValue(detail());
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
    getReviewWorkspace.mockResolvedValue(detail());
    getReviewReplyPrep.mockResolvedValue(prep());
    getReviewDecisionLog.mockRejectedValue(new Error("boom"));
    renderTask();

    await waitFor(() => expect(screen.getByText("괜찮긴한데 자꾸 떨어져요")).toBeInTheDocument());
    expect(screen.queryByLabelText("기록")).toBeNull();
  });

  /* ── the surrounding contract, unchanged ───────────────────────────── */

  it("offers the way back to the conversation only when a conversation sent the seller here", async () => {
    getReviewWorkspace.mockResolvedValue(detail());
    getReviewReplyPrep.mockResolvedValue(prep());
    const { unmount } = renderTask();
    await waitFor(() => expect(screen.getByText("괜찮긴한데 자꾸 떨어져요")).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: "대화로 돌아가기" })).not.toBeInTheDocument();
    unmount();

    getReviewWorkspace.mockResolvedValue(detail());
    getReviewReplyPrep.mockResolvedValue(prep());
    renderTask("?from=chat");
    await waitFor(() => expect(screen.getByText("괜찮긴한데 자꾸 떨어져요")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "대화로 돌아가기" })).toHaveAttribute("href", "/");
  });

  it("fails closed when the review cannot be read — never an invented review", async () => {
    getReviewWorkspace.mockRejectedValue(new Error("nope"));
    renderTask();
    expect(await screen.findByText("이 리뷰를 불러오지 못했습니다")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "승인" })).not.toBeInTheDocument();
  });

  it("says the channel already answered, before anyone decides anything", async () => {
    getReviewWorkspace.mockResolvedValue(
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
    getReviewWorkspace.mockResolvedValue(detail());
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
    getReviewWorkspace.mockResolvedValue(detail());
    getReviewReplyPrep.mockResolvedValue(prep());
    getReviewDecisionContext.mockResolvedValue(context({ productId: "prod-9" }));
    renderTask();

    const links = await screen.findAllByRole("link", { name: "합성 전선몰딩" });
    expect(links[0]).toHaveAttribute("href", "/products/prod-9");
  });
});

/**
 * <b>Agent-native Core Boundary v1</b> — the workspace on a review no account acquired.
 *
 * This is the shape a manual CSV upload and a seller-center export land in: `POST /api/uploads` is
 * addressed by channel and never by account, so the org holds the review and holds no account on its
 * channel. Before this package the page resolved an account first and, finding none, said
 * 「이 리뷰의 판매 계정을 확인하지 못했습니다」 — a dead end for a review that is entirely this org's.
 */
describe("리뷰 처리 — a review with no seller account", () => {
  const accountLess = () =>
    detail({ sellerAccountId: null, replyWork: null, replyUnavailableReason: "NO_SELLER_ACCOUNT" });

  it("opens, and offers the decision — the address is the review, so there is nothing to resolve", async () => {
    getReviewWorkspace.mockResolvedValue(accountLess());
    getReviewDecisionContext.mockResolvedValue(context({ currentDecision: null }));
    recordReviewDecision.mockResolvedValue({ disposition: "MONITOR", replayed: false });
    renderTask();

    expect(await screen.findByText("괜찮긴한데 자꾸 떨어져요")).toBeInTheDocument();
    const step = await screen.findByLabelText("조치 선택");
    await userEvent.click(within(step).getByRole("button", { name: /두고 보기/ }));
    await waitFor(() => expect(recordReviewDecision).toHaveBeenCalled());
    expect(recordReviewDecision.mock.calls[0][0]).toBe(REVIEW);
  });

  it("takes the seller's own judgment too — judging is not replying", async () => {
    getReviewWorkspace.mockResolvedValue(accountLess());
    correctReviewTriage.mockResolvedValue({
      reviewId: REVIEW,
      correctedTier: "WATCH",
      correctedReasonCode: null,
      systemTier: "FYI",
      systemSource: "RULES",
      correctedAt: "2026-09-13T00:00:00Z",
      changeCount: 1,
    });
    renderTask();

    const judgment = await screen.findByLabelText("판매자 판단");
    await userEvent.click(within(judgment).getByRole("button", { name: /지켜보기/ }));
    await waitFor(() => expect(correctReviewTriage).toHaveBeenCalledWith(REVIEW, expect.anything()));
  });

  it("says the ACCOUNT is missing, not that the channel has no reply feature", async () => {
    getReviewWorkspace.mockResolvedValue(accountLess());
    renderTask();

    expect(await screen.findByText(/연결된 판매 계정이 없어 답변을 준비할 수 없습니다/)).toBeInTheDocument();
    // The other sentence is a claim about the marketplace and would be false here.
    expect(screen.queryByText(/reviewnary가 답변을 작성하지 않습니다/)).toBeNull();
    expect(getReviewReplyPrep).not.toHaveBeenCalled();
  });

  it("offers no link into a channel record that does not exist for this review", async () => {
    getReviewWorkspace.mockResolvedValue(accountLess());
    renderTask();

    await screen.findByText("괜찮긴한데 자꾸 떨어져요");
    expect(screen.queryByRole("link", { name: "리뷰 기록에서 보기" })).toBeNull();
    // The way back is the index, which exists for every review.
    expect(screen.getByRole("link", { name: /리뷰 기록으로/ })).toHaveAttribute("href", "/reviews");
  });
});

/**
 * The account-scoped address this screen used to live at.
 *
 * It is a redirect now, and keeping ONE live copy is the point: the account was never part of the
 * authorization, so two addresses rendering the workspace would be two screens that eventually
 * disagree about what a review is.
 */
describe("리뷰 처리 — the account-scoped address still lands", () => {
  function renderLegacy(search = "") {
    return render(
      <MemoryRouter initialEntries={[`/reviews/${ACCOUNT}/reply/${REVIEW}${search}`]}>
        <Routes>
          <Route path="/reviews/:accountId/reply/:reviewId" element={<ReviewReplyTaskLegacyEntry />} />
          <Route path="/reviews/reply/:reviewId" element={<div>도착: 리뷰 처리</div>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("redirects to the review's own address and reads nothing to do it", async () => {
    renderLegacy();
    expect(await screen.findByText("도착: 리뷰 처리")).toBeInTheDocument();
    // No resolving read: the account segment carried no information the destination needs.
    expect(getReviewWorkspace).not.toHaveBeenCalled();
  });

  it("keeps the query string, so a link from the conversation still knows where it came from", async () => {
    const { container } = renderLegacy("?from=chat");
    await screen.findByText("도착: 리뷰 처리");
    expect(container).toBeTruthy();
  });
});

/**
 * 「작업에서 제외」 — moved here from the 리뷰 screen's 「내 답변 작업」 with the work it takes out (UI/UX v2 Phase 3).
 * Ported from `MyReplyWork.test.tsx`: it asks first and says what it does and does NOT do, 취소 writes nothing, and
 * confirming sets the review aside with an idempotency key and claims no completion.
 */
describe("리뷰 처리 — 작업에서 제외", () => {
  beforeEach(() => {
    getReviewWorkspace.mockResolvedValue(detail());
    getReviewReplyPrep.mockResolvedValue(prep());
  });

  it("asks first, explaining what it does and does NOT do — before any write", async () => {
    renderTask();
    await userEvent.click(await screen.findByTestId("reply-work-dismiss"));
    const confirm = await screen.findByTestId("reply-work-dismiss-confirm");
    expect(confirm).toHaveTextContent("저장한 초안과 기록은 그대로 남고");
    expect(confirm).toHaveTextContent("답변한 것으로 기록되지 않습니다");
    expect(dismissReplyWork).not.toHaveBeenCalled();
  });

  it("취소 backs out with nothing written", async () => {
    renderTask();
    await userEvent.click(await screen.findByTestId("reply-work-dismiss"));
    await userEvent.click(within(await screen.findByTestId("reply-work-dismiss-confirm")).getByRole("button", { name: "취소" }));
    expect(screen.queryByTestId("reply-work-dismiss-confirm")).toBeNull();
    expect(dismissReplyWork).not.toHaveBeenCalled();
  });

  it("confirming sets the review aside through the review's own account and ref, and claims no completion", async () => {
    dismissReplyWork.mockResolvedValue({ actionRef: `review:${REVIEW}`, replayed: false });
    renderTask();
    await userEvent.click(await screen.findByTestId("reply-work-dismiss"));
    await userEvent.click(within(await screen.findByTestId("reply-work-dismiss-confirm")).getByRole("button", { name: "제외하기" }));
    await waitFor(() => expect(dismissReplyWork).toHaveBeenCalledTimes(1));
    const [accountId, ref, body] = dismissReplyWork.mock.calls[0]!;
    expect(accountId).toBe(ACCOUNT);
    expect(ref).toBe(`review:${REVIEW}`);
    expect((body as { commandId: string }).commandId).toBeTruthy();
    const notice = await screen.findByTestId("reply-work-dismissed-notice");
    expect(notice).toHaveTextContent("저장한 초안과 기록은 그대로 있습니다");
    expect(notice).not.toHaveTextContent("완료");
  });
});


/**
 * <b>Review preview, reference-based v1</b> — the pane on 오늘 is a Peek, not a settings rail.
 *
 * <p>Held against Linear's Peek preview and Zendesk's ticket context panel at 1440×900, the pane was the second
 * of the two: a label column with values down it, a bold heading over a rule for each group, and 「아직 …없습니다」
 * four times at the weight of the customer's own sentence. Linear's card has <b>no headings, no rules and no
 * labels</b> — an identifier, a title, metadata flowing, a paragraph, a footnote.
 *
 * <p>Nothing here is a new fact, a new recommendation or a new control. The full case is untouched and keeps
 * every sentence and every block this reading merges.
 */
/** The labels of whatever this render put behind a fold. */
function folds(container: HTMLElement): string[] {
  return [...container.querySelectorAll("summary")].map((s) => (s.textContent ?? "").trim());
}

function renderPreview(depth: "preview" | "full" = "preview") {
  return render(
    <MemoryRouter>
      <ReviewCaseView reviewId={REVIEW} variant="pane" depth={depth} />
    </MemoryRouter>,
  );
}

describe("리뷰 미리보기 — 고객 원문 → 왜 → 근거 → 판단 → 한 가지 행동", () => {
  it("answers 「왜 확인해야 하는가」 with a state and a sentence, behind no fold and under no heading", async () => {
    getReviewWorkspace.mockResolvedValue(detail());
    getReviewReplyPrep.mockResolvedValue(prep());
    const { container } = renderPreview();

    // The tier, the reason and what to do — on screen, with no press.
    await waitFor(() => expect(screen.getByText("같은 분류가 늘어나는지 지켜보세요.")).toBeTruthy());
    expect(folds(container)).not.toContain("왜 올라왔나요");
    // …and with no heading over them: the question is the panel's, not a section's.
    expect(screen.queryByText("왜 올라왔나요")).toBeNull();
  });

  it("keeps the fold in the FULL pane, where it buys the decision forms their place", async () => {
    getReviewWorkspace.mockResolvedValue(detail());
    getReviewReplyPrep.mockResolvedValue(prep());
    const { container } = renderPreview("full");

    await waitFor(() => expect(screen.getByText("왜 올라왔나요")).toBeTruthy());
    expect(folds(container)).toContain("왜 올라왔나요");
  });

  it("draws no bold section heading, no rule and no label column", async () => {
    getReviewWorkspace.mockResolvedValue(detail());
    getReviewReplyPrep.mockResolvedValue(prep());
    const { container } = renderPreview();

    await waitFor(() => expect(screen.getByText("근거")).toBeTruthy());
    // Two eyebrows name the two groups that need naming; nothing is drawn as a heading.
    const visibleHeadings = [...container.querySelectorAll("h1,h2,h3")].filter(
      (h) => !h.className.includes("sr-only"),
    );
    // The only thing drawn as a heading is the customer's own sentence.
    expect(visibleHeadings.map((h) => h.textContent?.trim())).toEqual(["괜찮긴한데 자꾸 떨어져요"]);
    // No rules between the groups: the air is the separation.
    expect(container.querySelectorAll("[class*='border-t'],[class*='border-b']")).toHaveLength(0);
    // The old label column is gone with them.
    expect(screen.queryByText("처리 방법")).toBeNull();
    expect(screen.queryByText("기록")).toBeNull();
    expect(screen.queryByText("반복 신호")).toBeNull();
  });

  it("says where the review stands as state tokens — the decision and how far the trail goes", async () => {
    getReviewWorkspace.mockResolvedValue(detail());
    getReviewReplyPrep.mockResolvedValue(prep());
    getReviewDecisionLog.mockResolvedValue([
      { kind: "ACTION_CHOSEN", at: "2026-09-02T01:00:00Z", from: null, to: "RESPONSE_NEEDED" },
      { kind: "REPLY_APPROVAL", at: "2026-09-01T01:00:00Z", from: null, to: "APPROVED" },
    ] as never);
    renderPreview();

    const judgment = await screen.findByLabelText("현재 판단");
    // Both facts, as tokens: what is decided, when the newest record was, and that the trail is longer
    // (reference-based hierarchy v2, 2026-09-26). The entry's own SENTENCE is the full case's — `DecisionLog`
    // prints the whole trail there — and this preview's one action is what opens it.
    await waitFor(() => expect(judgment).toHaveTextContent("대응 필요"));
    expect(judgment).toHaveTextContent("최근 기록 2026-09-02");
    expect(judgment).toHaveTextContent("외 1건");
    // The prose it replaced, in either direction.
    expect(judgment).not.toHaveTextContent("정해 두셨습니다");
    expect(judgment).not.toHaveTextContent("가장 최근 기록은");
  });

  it("says nothing about the record when the record could not be read", async () => {
    getReviewWorkspace.mockResolvedValue(detail());
    getReviewReplyPrep.mockResolvedValue(prep());
    getReviewDecisionLog.mockRejectedValue(new Error("down"));
    renderPreview();

    const judgment = await screen.findByLabelText("현재 판단");
    // The decision alone. A log that could not be read is not an empty log, so the preview claims neither.
    await waitFor(() => expect(judgment).toHaveTextContent("대응 필요"));
    expect(judgment).not.toHaveTextContent("판단 기록 없음");
    expect(judgment).not.toHaveTextContent("최근 기록");
  });

  /**
   * <b>One line, and it is the one a seller checks before recording anything</b> (product-owner decision,
   * 2026-09-26). The channel-capability half — that reviewnary does not write here and the seller acts — is a
   * fact about the channel whose place is beside the draft area it explains, and the full case renders it in two
   * places. A preview has no draft area.
   */
  it("says the boundary once, at the foot, in one line", async () => {
    getReviewWorkspace.mockResolvedValue(
      detail({ replyWork: null, replyUnavailableReason: "CHANNEL_HAS_NO_REPLY_FLOW" }),
    );
    getReviewReplyPrep.mockResolvedValue(prep());
    renderPreview();

    await waitFor(() => expect(screen.getByLabelText("현재 판단")).toBeTruthy());
    const note = screen.getByText("마켓플레이스로는 아무것도 전송되지 않습니다.");
    expect(note).toBeTruthy();
    // Said once — not the pair it used to print one block apart, and not twice over.
    expect(screen.getAllByText(/마켓플레이스/)).toHaveLength(1);
    expect(screen.queryByText(/마켓플레이스에는 아무것도 전송되지 않습니다/)).toBeNull();
    expect(screen.queryByText(/여기에는 무엇으로 정했는지만 기록됩니다/)).toBeNull();
  });

  /**
   * <b>Five figures and the way to them</b> (reference-based hierarchy v2, 2026-09-26). The flowing line this
   * replaces put four counts, an absence sentence and a 76-character footnote at 15px/400 — the same weight as
   * the customer's sentence — so one band of type carried eight kinds of information. The figure is the heavy
   * thing now and its noun is the small one, which is Linear Peek's shape and the opposite of Zendesk's rail
   * (label column left, values right).
   */
  it("states the evidence as figures, each with the noun it counts", async () => {
    getReviewWorkspace.mockResolvedValue(detail());
    getReviewReplyPrep.mockResolvedValue(prep());
    renderPreview();

    const evidence = await screen.findByLabelText("근거");
    const cell = (label: string) => within(evidence).getByText(label).parentElement;
    expect(cell("리뷰")).toHaveTextContent("12");
    expect(cell("부정 리뷰")).toHaveTextContent("3");
    expect(cell("상품 지식")).toHaveTextContent("0");
    expect(cell("회사 운영 기준")).toHaveTextContent("0");
    // <b>「기록」 carries what a sentence used to</b>: the claim is about this repository's records, never about
    // the world, and that is exactly why the label is not 「반복 문제」.
    expect(cell("반복 문제 기록")).toHaveTextContent("0");
    // The figure is heavier than the noun beside it — that is the whole of the redesign, so it is asserted.
    const figure = within(evidence).getByText("12");
    expect(figure.className).toContain("font-bold");
    expect(within(evidence).getByText("리뷰").className).toContain("text-muted");
    // The links leave the panel and nothing above them does, so they stand in a row of their own.
    expect(within(evidence).getByRole("link", { name: /답변 기준 보기/ })).toHaveAttribute("href", "/knowledge");
    // The product name is not said twice: the panel header already prints it.
    expect(within(evidence).queryByText("합성 전선몰딩")).toBeNull();
    // <b>The explanations moved, they were not dropped.</b> The full case renders every one of them; this is
    // the assertion that they are no longer between one fact and the next.
    expect(evidence).not.toHaveTextContent("같은 문제를 말한 리뷰가 쌓이면");
    expect(evidence).not.toHaveTextContent("여기 있는 숫자는 등록된 자료의 수입니다.");
  });

  it("counts open asks only when there are any, and says a missing figure is not a zero", async () => {
    getReviewWorkspace.mockResolvedValue(detail());
    getReviewReplyPrep.mockResolvedValue(prep());
    getReviewDecisionContext.mockResolvedValue(
      context({ productId: null, productSignal: null, knowledge: { productSources: 2, orgSources: 1, productTitles: [], openAsks: 4 } }),
    );
    renderPreview();

    const evidence = await screen.findByLabelText("근거");
    expect(within(evidence).getByText("답 없는 확인 필요").parentElement).toHaveTextContent("4");
    // A review whose product this catalogue does not hold has no figure to print — and a 0 would answer a
    // question nobody asked. The dash keeps the row's baseline and the full case explains why it is there.
    expect(within(evidence).getByText("상품 미연결").parentElement).toHaveTextContent("—");
    expect(within(evidence).queryByText("리뷰")).toBeNull();
    // No product, so no way to its screen — a link that cannot be honest is not drawn.
    expect(within(evidence).queryByRole("link", { name: /상품 화면 열기/ })).toBeNull();
  });

  it("counts the repeated problems it DID find — the rows and the quotes are the full case's", async () => {
    getReviewWorkspace.mockResolvedValue(detail());
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
              { reviewId: "rev-2", occurredOn: "2026-08-20", rating: 1, quote: "이틀만에 떨어졌어요", productName: "합성 전선몰딩", sameProduct: true },
            ],
          },
        ],
      }),
    );
    renderPreview();

    const evidence = await screen.findByLabelText("근거");
    expect(within(evidence).getByText("반복 문제 기록").parentElement).toHaveTextContent("1");
    // <b>A repeated problem does not make the preview longer.</b> Its title, its org-wide evidence count and the
    // customer sentences that back it are what the full case is for; here the answer to 「is there any」 is a
    // digit, and it is in the same place whether the digit is 0 or 3.
    expect(within(evidence).queryByRole("link", { name: /접착 탈락/ })).toBeNull();
    expect(within(evidence).queryByText("근거 18건")).toBeNull();
    expect(within(evidence).queryByText("「이틀만에 떨어졌어요」")).toBeNull();
  });
});
