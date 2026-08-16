// @vitest-environment jsdom
//
// **`[쿠팡에서 보기]` on the 상품평 screen.**
//
// The interesting cases are the ones that are not a ring. A review that is not on the page the seller has up
// must not read as an error, an ambiguous match must say why nothing was outlined, and a run belonging to
// another review must not appear under the one currently selected. Each of those is a sentence a seller
// would otherwise misread as "SellerOps lost your review" or "SellerOps found it".
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ChannelReviews } from "./ChannelReviews";
import type { ActionWindowRunView } from "../../../../contracts/action-window/v2/index";
import type { ChannelReviewDetailView, ChannelReviewPageView } from "../../lib/types";
import type { ReviewLocateBinding } from "../../lib/actionWindow/locate/useReviewLocate";

const getChannelReviewsStrict = vi.fn();
const getChannelReviewStrict = vi.fn();
const startChannelReviewLocateRun = vi.fn();

vi.mock("../../lib/apiClient", () => ({
  api: {
    getChannelReviewsStrict: (accountId: string, params: unknown) => getChannelReviewsStrict(accountId, params),
    getChannelReviewStrict: (accountId: string, reviewId: string) => getChannelReviewStrict(accountId, reviewId),
    startChannelReviewLocateRun: (accountId: string, reviewId: string) =>
      startChannelReviewLocateRun(accountId, reviewId),
  },
  getToken: () => "token",
}));

const PAGE: ChannelReviewPageView = {
  page: 0,
  size: 20,
  total: 1,
  newCount: 0,
  lastImportAt: "2026-08-14T05:00:00Z",
  lastImportComplete: true,
  triageSummary: { needsAttention: 0, watch: 0, fyi: 1, repeatedCategories: [] },
  items: [
    {
      id: "r1",
      writtenOn: "2026-08-11",
      rating: 5,
      negative: false,
      preview: "배송도 빠르고 포장도 꼼꼼했어요",
      productName: "무선 이어폰",
      productId: "15411270785",
      vendorItemId: "81234567890",
      mediaCount: 0,
      textless: false,
      isNew: false,
      triage: { tier: "FYI", reason: "5점", tags: [], recommendedAction: null },
    },
  ],
};

const DETAIL: ChannelReviewDetailView = {
  id: "r1",
  writtenOn: "2026-08-11",
  rating: 5,
  negative: false,
  body: "배송도 빠르고 포장도 꼼꼼했어요. 다음에도 구매할게요.",
  bodyRedacted: false,
  productName: "무선 이어폰",
  mediaCount: 0,
  textless: false,
  isNew: false,
  triage: { tier: "FYI", reason: "5점", tags: [], recommendedAction: null },
  locateTarget: {
    productId: "15411270785",
    vendorItemId: "81234567890",
    writtenOn: "2026-08-11",
    rating: 5,
  },
};

function view(over: Partial<ActionWindowRunView> = {}): ActionWindowRunView {
  return {
    protocolVersion: 2,
    runId: "run_l1",
    revision: 3,
    channelCode: "coupang",
    runCopyKey: "actionWindow.reviewLocate.run",
    status: "COMPLETED",
    executionMode: "ACTION_WINDOW",
    intent: "REVIEW_LOCATE",
    guidanceEnabled: true,
    allowedCommands: [],
    progress: { completedSteps: 2, totalSteps: 2 },
    updatedAt: "2026-08-15T00:00:00.000Z",
    ...over,
  };
}

function binding(over: Partial<ReviewLocateBinding> = {}): ReviewLocateBinding {
  return {
    view: null,
    unavailable: null,
    starting: false,
    reviewId: null,
    locate: vi.fn(async () => undefined),
    send: vi.fn(),
    ...over,
  };
}

function renderPage(locateBinding: ReviewLocateBinding) {
  return render(
    <MemoryRouter initialEntries={["/connect/channels/acc-1/reviews"]}>
      <Routes>
        <Route
          path="/connect/channels/:accountId/reviews"
          element={<ChannelReviews locateBinding={locateBinding} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

/** Open the 상세 panel for the one review in the fixture. */
async function selectTheReview(): Promise<void> {
  await userEvent.click(await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요"));
  await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요. 다음에도 구매할게요.");
}

beforeEach(() => {
  vi.clearAllMocks();
  getChannelReviewsStrict.mockResolvedValue(PAGE);
  getChannelReviewStrict.mockResolvedValue(DETAIL);
});

describe("[쿠팡에서 보기]", () => {
  it("asks for the selected review, and says what it does to the marketplace", async () => {
    const locate = binding();
    renderPage(locate);
    await selectTheReview();

    await userEvent.click(screen.getByRole("button", { name: "쿠팡에서 보기" }));

    expect(locate.locate).toHaveBeenCalledWith("r1");
    expect(screen.getByText(/아무것도 눌리거나 입력되지 않습니다/)).toBeInTheDocument();
  });

  it("says the review was outlined, once it was", async () => {
    renderPage(binding({ reviewId: "r1", view: view() }));
    await selectTheReview();

    expect(await screen.findByText(/테두리를 그렸습니다/)).toBeInTheDocument();
  });

  /**
   * The most common non-ring outcome, and the one a wrong word would ruin: the review is simply on another
   * page. It must not read as a failure, and it must say that the run is still looking.
   */
  it("tells the seller to turn the page, and does not call that an error", async () => {
    renderPage(
      binding({
        reviewId: "r1",
        view: view({
          status: "WAITING_FOR_HUMAN",
          blocker: { code: "TARGET_NOT_FOUND", recoverable: true },
          allowedCommands: ["REQUEST_STEP_RECHECK", "CANCEL_RUN", "FIND_CURRENT_STEP"],
          currentStep: {
            stepId: "aw.review_locate_open_list",
            stepNumber: 1,
            totalSteps: 2,
            copyKey: "actionWindow.reviewLocate.openList",
            status: "AWAITING_USER",
          },
          progress: { completedSteps: 0, totalSteps: 2 },
        }),
      }),
    );
    await selectTheReview();

    expect(await screen.findByText(/페이지를 넘겨 보세요/)).toBeInTheDocument();
    expect(screen.queryByText(/버튼을 찾지 못했어요/)).not.toBeInTheDocument();
  });

  it("explains an ambiguous match instead of outlining one of them", async () => {
    renderPage(
      binding({
        reviewId: "r1",
        view: view({
          status: "WAITING_FOR_HUMAN",
          blocker: { code: "TARGET_AMBIGUOUS", recoverable: true },
          allowedCommands: ["REQUEST_STEP_RECHECK", "CANCEL_RUN", "FIND_CURRENT_STEP"],
          currentStep: {
            stepId: "aw.review_locate_open_list",
            stepNumber: 1,
            totalSteps: 2,
            copyKey: "actionWindow.reviewLocate.openList",
            status: "AWAITING_USER",
          },
          progress: { completedSteps: 0, totalSteps: 2 },
        }),
      }),
    );
    await selectTheReview();

    expect(await screen.findByText(/둘 이상 있어 어느 줄인지 가릴 수 없습니다/)).toBeInTheDocument();
  });

  it("says the agent is not running, rather than failing silently", async () => {
    renderPage(binding({ reviewId: "r1", unavailable: "unreachable" }));
    await selectTheReview();

    expect(await screen.findByText(/로컬 에이전트가 실행 중이 아닙니다/)).toBeInTheDocument();
  });

  /** A run belongs to the review it was pressed on. Showing it under another is a false claim. */
  it("shows nothing about a run that belongs to a different review", async () => {
    renderPage(binding({ reviewId: "r2", view: view() }));
    await selectTheReview();

    expect(screen.queryByText(/테두리를 그렸습니다/)).not.toBeInTheDocument();
  });

  it("offers 다시 확인 only when the run allows it", async () => {
    const locate = binding({
      reviewId: "r1",
      view: view({
        status: "WAITING_FOR_HUMAN",
        blocker: { code: "TARGET_NOT_FOUND", recoverable: true },
        allowedCommands: ["REQUEST_STEP_RECHECK", "CANCEL_RUN", "FIND_CURRENT_STEP"],
        currentStep: {
          stepId: "aw.review_locate_open_list",
          stepNumber: 1,
          totalSteps: 2,
          copyKey: "actionWindow.reviewLocate.openList",
          status: "AWAITING_USER",
        },
        progress: { completedSteps: 0, totalSteps: 2 },
      }),
    });
    renderPage(locate);
    await selectTheReview();

    await userEvent.click(await screen.findByRole("button", { name: "다시 확인" }));
    expect(locate.send).toHaveBeenCalledWith("REQUEST_STEP_RECHECK");
  });

  it("offers no run controls on a completed locate", async () => {
    renderPage(binding({ reviewId: "r1", view: view() }));
    await selectTheReview();

    await waitFor(() => expect(screen.getByText(/테두리를 그렸습니다/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "다시 확인" })).not.toBeInTheDocument();
  });
});
