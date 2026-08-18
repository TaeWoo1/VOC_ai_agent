// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ChannelReviews, shownRangeLabel } from "./ChannelReviews";
import { expectNoAxeViolations } from "../../test/axe";
import type { ChannelReviewDetailView, ChannelReviewPageView } from "../../lib/types";

const getChannelReviewsStrict = vi.fn();
const getChannelReviewStrict = vi.fn();
const getReplyWork = vi.fn();
const getReviewReplyPrep = vi.fn();
const recordBehavior = vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined);
const correctTriage = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const recordAction = vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined);

vi.mock("../../lib/apiClient", () => ({
  api: {
    getChannelReviewsStrict: (accountId: string, params: unknown) =>
      getChannelReviewsStrict(accountId, params),
    getChannelReviewStrict: (accountId: string, reviewId: string) =>
      getChannelReviewStrict(accountId, reviewId),
    recordChannelReviewTriageBehavior: (...args: unknown[]) => recordBehavior(...args),
    correctChannelReviewTriage: (...args: unknown[]) => correctTriage(...args),
    recordChannelReviewTriageAction: (...args: unknown[]) => recordAction(...args),
    getReplyWork: (...args: unknown[]) => getReplyWork(...args),
    getReviewReplyPrep: (...args: unknown[]) => getReviewReplyPrep(...args),
  },
  getToken: () => "token",
}));

const PAGE: ChannelReviewPageView = {
  page: 0,
  size: 20,
  total: 2,
  newCount: 1,
  lastImportAt: "2026-08-14T05:00:00Z",
  lastImportComplete: true,
  aiPilotEnabled: false,
  channel: { channelCode: "COUPANG", aiTriage: true, originalLocate: "LOCATE_RUN", replySupported: false },
  triageSummary: {
    needsAttention: 1,
    watch: 0,
    fyi: 1, aiAttention: 0,
    repeatedCategories: [{ category: "설치", count: 11 }],
  },
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
      mediaCount: 2,
      textless: false,
      isNew: true,
      triage: { tier: "FYI", reason: "5점", tags: [], recommendedAction: null },
    aiMark: null,
    },
    {
      id: "r2",
      writtenOn: "2026-08-01",
      rating: 1,
      negative: true,
      preview: "생각보다 크기가 작아서 아쉬웠습니다",
      productName: "무선 이어폰",
      productId: "15411270785",
      vendorItemId: null,
      mediaCount: 0,
      textless: false,
      isNew: false,
      triage: {
        tier: "NEEDS_ATTENTION",
        reason: "1점 · 설치 · 같은 분류 11건",
        tags: ["설치"],
        recommendedAction: "같은 분류의 상품평이 반복됩니다. 상품·포장 상태를 확인해 보세요.",
      },
    aiMark: null,
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
  mediaCount: 2,
  textless: false,
  isNew: true,
  triage: { tier: "FYI", reason: "5점", tags: [], recommendedAction: null },
  aiMark: null,
  locateTarget: {
    productId: "15411270785",
    vendorItemId: "81234567890",
    writtenOn: "2026-08-11",
    rating: 5,
  },

  replyWork: null,
};

/** Reports the router's current location so a test can assert what the URL says. */
function LocationProbe() {
  const { pathname, search } = useLocation();
  return <output data-testid="location">{`${pathname}${search}`}</output>;
}

function renderPage(path = "/reviews/acc-1") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/reviews/:accountId"
          element={
            <>
              <ChannelReviews />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getChannelReviewsStrict.mockResolvedValue(PAGE);
  getChannelReviewStrict.mockResolvedValue(DETAIL);
  getReplyWork.mockResolvedValue({
    sellerAccountId: "acc-1",
    channel: "NAVER",
    coverage: "COVERED",
    todo: [],
    recentlyReported: [],
  });
});

/**
 * Product assembly A6: review work starts on the 리뷰 screen. Where the server says the channel has a
 * reply flow (`replySupported`, and a server-minted `replyWork` on the detail), the detail carries the
 * product's one reply cluster and the page ends with 내 답변 작업. Where it does not, nothing of the kind
 * renders — no control the server would refuse.
 */
describe("reply work on the 리뷰 screen (A6)", () => {
  const NAVER_PAGE: ChannelReviewPageView = {
    ...PAGE,
    channel: { channelCode: "NAVER", aiTriage: true, originalLocate: "NONE", replySupported: true },
  };
  const NAVER_DETAIL: ChannelReviewDetailView = {
    ...DETAIL,
    replyWork: { actionRef: "review:r1", triageDisposition: null, hasReplyPreparation: false },
  };

  it("NAVER: the detail offers the decision (대응 필요 …) and the page ends with 내 답변 작업", async () => {
    getChannelReviewsStrict.mockResolvedValue(NAVER_PAGE);
    getChannelReviewStrict.mockResolvedValue(NAVER_DETAIL);
    renderPage("/reviews/acc-1?review=r1");

    // The workflow sentence says the screen prepares replies here — and that posting stays with the seller.
    expect(await screen.findByText(/여기서 답변을 준비합니다/)).toBeInTheDocument();
    const reply = await screen.findByRole("region", { name: "답변" });
    expect(within(reply).getByRole("button", { name: "대응 필요" })).toBeInTheDocument();
    // Undecided and no work yet: the preparation panel stays off (it would open a read for nothing).
    expect(within(reply).queryByRole("heading", { name: "답변 준비" })).toBeNull();
    expect(getReviewReplyPrep).not.toHaveBeenCalled();
    // The operator's committed work has its home on this page now, for this account.
    expect(await screen.findByRole("heading", { name: "내 답변 작업" })).toBeInTheDocument();
    expect(getReplyWork).toHaveBeenCalledWith("acc-1", expect.anything());
  });

  it("NAVER: a review already marked 대응 필요 mounts the preparation panel — the same flow, entered from here", async () => {
    getChannelReviewsStrict.mockResolvedValue(NAVER_PAGE);
    getChannelReviewStrict.mockResolvedValue({
      ...NAVER_DETAIL,
      replyWork: { actionRef: "review:r1", triageDisposition: "RESPONSE_NEEDED", hasReplyPreparation: false },
    });
    getReviewReplyPrep.mockResolvedValue({
      actionRef: "review:r1",
      redactedBody: "합성-리뷰-본문",
      bodyRedacted: false,
      triageDisposition: "RESPONSE_NEEDED",
      suggestion: {
        body: "합성-추천-초안",
        category: "delivery_reply",
        providerKind: "RULE_BASED",
        providerName: "review-reply-template",
        providerVersion: "templates-v1",
      },
      draft: null,
      approval: null,
      outcome: null,
      capabilities: { canSave: true, canApprove: false, canWithdraw: false, canCopy: false, canStartSubmissionRun: false },
      channelReplyState: "UNKNOWN",
      productName: "무선 이어폰",
      reviewDate: "2026-08-11",
      rating: 5,
    });
    renderPage("/reviews/acc-1?review=r1");

    const reply = await screen.findByRole("region", { name: "답변" });
    expect(await within(reply).findByRole("heading", { name: "답변 준비" })).toBeInTheDocument();
    expect(getReviewReplyPrep).toHaveBeenCalledWith("acc-1", "review:r1");
  });

  it("Coupang: no decision, no preparation, no 내 답변 작업 — the channel has no reply flow", async () => {
    renderPage("/reviews/acc-1?review=r1");
    await screen.findByText(/SellerOps가 답변을 작성하지 않습니다/);
    await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요. 다음에도 구매할게요.");
    expect(screen.queryByRole("region", { name: "답변" })).toBeNull();
    expect(screen.queryByRole("button", { name: "대응 필요" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "내 답변 작업" })).toBeNull();
    expect(getReplyWork).not.toHaveBeenCalled();
  });
});

describe("deep-link seams the home relies on", () => {
  it("?tier=NEEDS_ATTENTION opens the list under that filter — the same filter whose total the home tile shows", async () => {
    renderPage("/reviews/acc-1?tier=NEEDS_ATTENTION");
    await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요");
    expect(getChannelReviewsStrict).toHaveBeenCalledWith("acc-1", expect.objectContaining({ tier: "NEEDS_ATTENTION" }));
  });

  it("ignores an unknown tier value rather than sending it to the server, and scrubs it from the URL", async () => {
    renderPage("/reviews/acc-1?tier=WHATEVER");
    await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요");
    expect(getChannelReviewsStrict).toHaveBeenCalledWith("acc-1", expect.objectContaining({ tier: undefined }));
    expect(screen.getByTestId("location")).toHaveTextContent("/reviews/acc-1");
    expect(screen.getByTestId("location").textContent).not.toContain("tier=");
  });

  it("the URL is the filter, both ways: a tier press writes ?tier and drops ?review; 전체 clears it", async () => {
    renderPage("/reviews/acc-1?review=r1");
    await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요");
    await userEvent.click(screen.getByRole("button", { name: /^확인 필요 \d+$/ }));
    expect(screen.getByTestId("location")).toHaveTextContent("/reviews/acc-1?tier=NEEDS_ATTENTION");
    expect(getChannelReviewsStrict).toHaveBeenLastCalledWith("acc-1", expect.objectContaining({ tier: "NEEDS_ATTENTION" }));
    await userEvent.click(screen.getByRole("button", { name: /^전체 \d+$/ }));
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/reviews\/acc-1$/);
  });

  it("the URL is the selection, both ways: a row press writes ?review", async () => {
    renderPage();
    await userEvent.click((await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요")).closest("button")!);
    expect(screen.getByTestId("location")).toHaveTextContent("/reviews/acc-1?review=r1");
    expect(getChannelReviewStrict).toHaveBeenCalledWith("acc-1", "r1");
  });

  it("orders the filter as the workflow does — 확인 필요, 지켜보기, 참고, then 전체", async () => {
    renderPage();
    await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요");
    const group = screen.getByRole("group", { name: "분류 필터" });
    const labels = within(group).getAllByRole("button").map((b) => b.textContent?.replace(/\s*\d+$/, ""));
    expect(labels).toEqual(["확인 필요", "지켜보기", "참고", "전체"]);
  });

  it("?review=<id> opens that review's detail without a press", async () => {
    renderPage("/reviews/acc-1?review=r1");
    await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요. 다음에도 구매할게요.");
    expect(getChannelReviewStrict).toHaveBeenCalledWith("acc-1", "r1");
  });
});

describe("the channel review record", () => {
  it("lists what was collected, and marks what the last import brought in", async () => {
    renderPage();

    expect(await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요")).toBeInTheDocument();
    expect(screen.getByText("총 2개")).toBeInTheDocument();
    expect(screen.getByText("새로 들어온 1개")).toBeInTheDocument();
    expect(screen.getAllByText("새 상품평")).toHaveLength(1);
  });

  it("offers no way to reply, because the channel has none", async () => {
    renderPage();
    await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요");

    for (const label of ["답변", "답글", "초안", "등록하기"]) {
      expect(screen.queryByRole("button", { name: new RegExp(label) })).toBeNull();
    }
  });

  it("asks the backend for the complaints first when the seller chooses that order", async () => {
    renderPage();
    await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요");

    await userEvent.click(screen.getByRole("button", { name: "낮은 평점순" }));

    await waitFor(() =>
      expect(getChannelReviewsStrict).toHaveBeenLastCalledWith(
        "acc-1",
        expect.objectContaining({ sort: "lowest" }),
      ),
    );
  });

  it("opens one review in full when it is chosen", async () => {
    renderPage();
    await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요");

    await userEvent.click(screen.getByText("배송도 빠르고 포장도 꼼꼼했어요"));

    expect(await screen.findByText(/다음에도 구매할게요/)).toBeInTheDocument();
    expect(getChannelReviewStrict).toHaveBeenCalledWith("acc-1", "r1");
  });

  it("says so when the body it shows was redacted", async () => {
    getChannelReviewStrict.mockResolvedValue({ ...DETAIL, bodyRedacted: true });
    renderPage();
    await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요");

    await userEvent.click(screen.getByText("배송도 빠르고 포장도 꼼꼼했어요"));

    expect(await screen.findByText(/가려서 표시했습니다/)).toBeInTheDocument();
  });
});

describe("a review the buyer rated without writing", () => {
  it("says what it is, rather than implying SellerOps lost the text", async () => {
    getChannelReviewsStrict.mockResolvedValue({
      ...PAGE,
      items: [{ ...PAGE.items[0]!, preview: null, textless: true }],
    });
    renderPage();

    expect(await screen.findByText("별점만 남긴 상품평")).toBeInTheDocument();
    expect(screen.queryByText(/표시할 수 있는 본문이 없습니다/)).toBeNull();
  });

  it("says the rating still counts, in the detail", async () => {
    getChannelReviewsStrict.mockResolvedValue({
      ...PAGE,
      items: [{ ...PAGE.items[0]!, preview: null, textless: true }],
    });
    getChannelReviewStrict.mockResolvedValue({ ...DETAIL, body: "", textless: true });
    renderPage();

    await userEvent.click(await screen.findByText("별점만 남긴 상품평"));

    expect(await screen.findByText(/별점은 그대로 집계됩니다/)).toBeInTheDocument();
  });
});

describe("the page refuses to imply what it does not know", () => {
  it("warns in words when the last import did not reach the end of the list", async () => {
    getChannelReviewsStrict.mockResolvedValue({ ...PAGE, lastImportComplete: false });
    renderPage();

    expect(await screen.findByText(/목록 끝까지 확인되지 않은 상태로 끝났습니다/)).toBeInTheDocument();
  });

  it("does not warn when the import covered the list", async () => {
    renderPage();
    await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요");

    expect(screen.queryByText(/목록 끝까지 확인되지 않은/)).toBeNull();
  });

  it("shows nothing rather than an invented list when the read fails", async () => {
    getChannelReviewsStrict.mockRejectedValue(new Error("backend down"));
    renderPage();

    // Before a page has loaded there is no channel, so the product word (리뷰), not Coupang's.
    expect(await screen.findByText("리뷰를 불러오지 못했습니다")).toBeInTheDocument();
    expect(screen.queryByText("배송도 빠르고 포장도 꼼꼼했어요")).toBeNull();
  });

  it("says the record is empty and how to fill it, rather than looking broken", async () => {
    getChannelReviewsStrict.mockResolvedValue({ ...PAGE, total: 0, newCount: 0, items: [] });
    renderPage();

    expect(await screen.findByText("아직 수집된 상품평이 없습니다")).toBeInTheDocument();
  });
});

describe("no buyer appears, because none is stored", () => {
  it("renders nothing from a field it does not know about, even if one arrives", async () => {
    // The backend has no author field and refuses one on the wire; this is the last line of the same
    // rule — a page that spread its response into the DOM would render whatever turned up. The word
    // 구매자 in the page's own description is a descriptor, not a value, so the assertion is on the
    // VALUE a buyer field would carry.
    getChannelReviewsStrict.mockResolvedValue({
      ...PAGE,
      items: [{ ...PAGE.items[0], author: "김서연" }, PAGE.items[1]],
    });
    getChannelReviewStrict.mockResolvedValue({ ...DETAIL, author: "김서연" });
    renderPage();
    await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요");
    await userEvent.click(screen.getByText("배송도 빠르고 포장도 꼼꼼했어요"));
    await screen.findByText(/다음에도 구매할게요/);

    expect(document.body.textContent).not.toContain("김서연");
  });
});

/**
 * A seller with more 상품평 than one screenful used to be shown the first 20 under a "총 22개" chip, with
 * nothing on the page saying a second page existed and no control that could reach it.
 */
describe("a list longer than one screen can be walked", () => {
  const LONG = { ...PAGE, total: 42, size: 20 };

  it("says which slice of the list is on screen", () => {
    expect(shownRangeLabel({ ...LONG, page: 1 })).toBe("21–22번째 · 총 42개");
    // Derived from what the RESPONSE said, so a server that clamped the size cannot be misdescribed.
    expect(shownRangeLabel({ ...LONG, page: 0, size: 2 })).toBe("1–2번째 · 총 42개");
    expect(shownRangeLabel(null)).toBe("0개 표시 중");
  });

  it("asks the backend for the next page when the seller asks for it", async () => {
    getChannelReviewsStrict.mockResolvedValue(LONG);
    renderPage();
    await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요");

    await userEvent.click(screen.getByRole("button", { name: "다음" }));

    await waitFor(() =>
      expect(getChannelReviewsStrict).toHaveBeenLastCalledWith("acc-1", {
        // 확인 필요 우선 is the default as of Review Triage v1 — the question the seller opens this
        // screen with is "what first", and the newest row was answering a different one.
        sort: "attention",
        tier: undefined,
        page: 1,
        size: 20,
      }),
    );
  });

  it("offers no paging at all when the whole list already fits", async () => {
    getChannelReviewsStrict.mockResolvedValue(PAGE);
    renderPage();
    await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요");

    expect(screen.queryByRole("button", { name: "다음" })).toBeNull();
  });

  /**
   * Two controls now change the query, so two reads can be in flight; the slower one landing second used to
   * install rows that neither the pressed sort button nor the page label described.
   */
  it("ignores a superseded response, so the rows always match the controls", async () => {
    const slowPage3 = { ...LONG, page: 2, items: [{ ...PAGE.items[0]!, id: "stale", preview: "지나간 응답" }] };
    const fastLowest = { ...LONG, page: 0, items: [{ ...PAGE.items[1]!, id: "fresh", preview: "새 응답" }] };
    let releaseSlow: (v: unknown) => void = () => {};
    getChannelReviewsStrict
      .mockResolvedValueOnce(LONG)
      .mockImplementationOnce(() => new Promise((res) => { releaseSlow = () => res(slowPage3); }))
      .mockResolvedValueOnce(fastLowest);

    renderPage();
    await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요");
    await userEvent.click(screen.getByRole("button", { name: "다음" }));
    await userEvent.click(screen.getByRole("button", { name: "낮은 평점순" }));
    await screen.findByText("새 응답");
    releaseSlow(null);

    // The overtaken page-3 read resolves last and must write nothing.
    await waitFor(() => expect(screen.queryByText("지나간 응답")).toBeNull());
    expect(screen.getByText("새 응답")).toBeInTheDocument();
  });

  it("labels the page from the response, so the label cannot describe rows that are not there", () => {
    // The pager label and the range label are both read off the response; taken from local state the first
    // would advance the instant the button was pressed, over rows still describing the previous page.
    expect(shownRangeLabel({ ...LONG, page: 2 })).toBe("41–42번째 · 총 42개");
  });

  it("returns to the first page when the order changes, rather than keeping a position that no longer means the same thing", async () => {
    getChannelReviewsStrict.mockResolvedValue(LONG);
    renderPage();
    await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요");
    await userEvent.click(screen.getByRole("button", { name: "다음" }));
    await waitFor(() => expect(getChannelReviewsStrict).toHaveBeenLastCalledWith("acc-1", expect.objectContaining({ page: 1 })));

    await userEvent.click(screen.getByRole("button", { name: "낮은 평점순" }));

    await waitFor(() =>
      expect(getChannelReviewsStrict).toHaveBeenLastCalledWith("acc-1", {
        sort: "lowest",
        tier: undefined,
        page: 0,
        size: 20,
      }),
    );
  });
});

/**
 * Review Triage v1 — the list saying what to look at first, and why.
 *
 * The test that matters here is {@code the tags never re-rank anything}: the tier arrives from the
 * backend, and the frontend must render it rather than re-derive one from the tags beside it.
 * `contracts/review-eval/naver/v1/RUBRIC.md` §5 forbids surfacing an unmeasured text detector, and
 * the frontend is exactly where such a thing would be added by accident — a `tags.includes("파손")`
 * check that bumps a row's colour reads like polish and is the gated thing.
 */
describe("triage", () => {
  it("says which tier a review is in and why, on the row", async () => {
    renderPage();
    await screen.findByText("생각보다 크기가 작아서 아쉬웠습니다");

    expect(screen.getAllByText("확인 필요").length).toBeGreaterThan(0);
    expect(screen.getByText("1점 · 설치 · 같은 분류 11건")).toBeInTheDocument();
    expect(
      screen.getByText("같은 분류의 상품평이 반복됩니다. 상품·포장 상태를 확인해 보세요."),
    ).toBeInTheDocument();
  });

  it("offers a well-rated review no action rather than a reassuring sentence", async () => {
    renderPage();
    const praise = (await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요")).closest(
      "li",
    ) as HTMLElement;
    const complaint = (screen.getByText("생각보다 크기가 작아서 아쉬웠습니다")).closest(
      "li",
    ) as HTMLElement;

    // Scoped to each row, so this cannot pass on the other row's text. The 5★ row carries its
    // reason and its tier and NOTHING in the action slot; the 1★ row beside it carries one.
    expect(within(praise).getByText("참고")).toBeInTheDocument();
    expect(within(praise).getByText("5점")).toBeInTheDocument();
    expect(within(praise).queryByText(/확인해 보세요/)).toBeNull();
    expect(within(complaint).getByText(/확인해 보세요/)).toBeInTheDocument();
  });

  it("summarises the whole record above the list", async () => {
    renderPage();
    await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요");

    expect(screen.getByText(/지금 확인이 필요한 상품평/)).toBeInTheDocument();
    expect(screen.getByText(/설치 11건/)).toBeInTheDocument();
    // The tags are an unmeasured keyword classification and the surface says so.
    expect(screen.getAllByText(/자동 분류한 것이라 정확하지 않을 수 있습니다/).length).toBeGreaterThan(0);
  });

  it("asks the backend to narrow to a tier, and keeps that filter across a sort change", async () => {
    renderPage();
    await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요");

    await userEvent.click(screen.getByRole("button", { name: /^확인 필요 1$/ }));
    await waitFor(() =>
      expect(getChannelReviewsStrict).toHaveBeenLastCalledWith(
        "acc-1",
        expect.objectContaining({ tier: "NEEDS_ATTENTION", page: 0 }),
      ),
    );

    await userEvent.click(screen.getByRole("button", { name: "최신순" }));
    await waitFor(() =>
      expect(getChannelReviewsStrict).toHaveBeenLastCalledWith(
        "acc-1",
        // The filter must survive: a seller who narrowed and then re-sorted wants the newest of
        // what they narrowed to, not the filter silently dropped with its chip still lit.
        expect.objectContaining({ sort: "newest", tier: "NEEDS_ATTENTION" }),
      ),
    );
  });

  it("does not report an empty filter as an empty record", async () => {
    getChannelReviewsStrict.mockResolvedValue({
      ...PAGE,
      items: [],
      // The record still holds two reviews; the operator just narrowed to a tier holding none.
      triageSummary: { needsAttention: 0, watch: 0, fyi: 2, repeatedCategories: [] },
    });
    renderPage();
    await waitFor(() => expect(getChannelReviewsStrict).toHaveBeenCalled());

    await userEvent.click(screen.getByRole("button", { name: /^확인 필요 0$/ }));

    expect(await screen.findByText("확인 필요에 해당하는 상품평이 없습니다")).toBeInTheDocument();
    expect(screen.queryByText("아직 수집된 상품평이 없습니다")).toBeNull();
  });

  it("renders the rows in the order the backend sent them", async () => {
    // The chip test below covers the LABEL. This covers the ranking, which is the other half of
    // "must never be used here to re-rank" — a client-side `.sort()` on tag count passed the whole
    // suite before this existed. The fixture is built so tag-count order is the REVERSE of the
    // server's order, so any re-rank from body-derived material flips it.
    getChannelReviewsStrict.mockResolvedValue({
      ...PAGE,
      items: [
        { ...PAGE.items[0], id: "first", preview: "서버가 먼저 준 줄", triage: { ...PAGE.items[0].triage, tags: [] } },
        {
          ...PAGE.items[1],
          id: "second",
          preview: "서버가 나중에 준 줄",
          triage: { ...PAGE.items[1].triage, tags: ["설치", "품질", "배송"] },
        aiMark: null,
        },
      ],
    });
    renderPage();
    await screen.findByText("서버가 먼저 준 줄");

    const previews = screen
      .getAllByText(/서버가 (먼저|나중에) 준 줄/)
      .map((n) => n.textContent);
    expect(previews).toEqual(["서버가 먼저 준 줄", "서버가 나중에 준 줄"]);
  });

  it("counts the whole record in the header, even while a filter narrows the list", async () => {
    // page.total narrows with the filter; newCount and the tier counts stay channel-wide. Rendering
    // the filtered total beside them put "총 1개" next to "새로 들어온 1개" — two totals on one line.
    getChannelReviewsStrict.mockResolvedValue({
      ...PAGE,
      total: 1,
      newCount: 1,
      items: [PAGE.items[1]],
      triageSummary: { needsAttention: 1, watch: 3, fyi: 18, repeatedCategories: [] },
    });
    renderPage();
    await screen.findByText("생각보다 크기가 작아서 아쉬웠습니다");

    expect(screen.getByText("총 22개")).toBeInTheDocument();
    expect(screen.queryByText("총 1개")).toBeNull();
    // …and the range label under the list still describes the slice actually on screen.
    expect(screen.getByText("1–1번째 · 총 1개")).toBeInTheDocument();
  });

  it("renders the tier the backend sent, never one re-derived from the tags", async () => {
    // A 1★ row whose body-derived tags scream 파손, and whose tier says 참고. If the frontend ever
    // re-ranks from tags, this renders 확인 필요 and fails — which is the whole point.
    getChannelReviewsStrict.mockResolvedValue({
      ...PAGE,
      total: 1,
      triageSummary: { needsAttention: 0, watch: 0, fyi: 1, repeatedCategories: [] },
      items: [
        {
          ...PAGE.items[1],
          triage: {
            tier: "FYI" as const,
            reason: "1점 · 품질",
            tags: ["품질", "파손"],
            recommendedAction: null,
          },
        aiMark: null,
        },
      ],
    });
    renderPage();
    await screen.findByText("생각보다 크기가 작아서 아쉬웠습니다");

    expect(screen.getByText("참고")).toBeInTheDocument();
    expect(screen.queryByText("확인 필요")).toBeNull();
  });
});

describe("the AI pilot's mark and the feedback spine (RUBRIC v2 §13.7)", () => {
  const MARK = {
    classifierVersion: "llm-triage/v1+openai:gpt-5-2025-08-07+triage-prompt/v4+schema/v1+tdefault+out4000+effort:low+additive-guard/v1",
    reasonCode: "PRAISE_WITH_CONCESSION",
    predictedAt: "2026-08-17T00:00:00Z",
  };

  it("renders AI 확인 필요 BESIDE the rules tier, never in its place, and says what it is", async () => {
    getChannelReviewsStrict.mockResolvedValue({
      ...PAGE,
      aiPilotEnabled: true,
      triageSummary: { ...PAGE.triageSummary, needsAttention: 2, aiAttention: 1 },
      items: [{ ...PAGE.items[0], aiMark: MARK }, PAGE.items[1]],
    });
    getChannelReviewStrict.mockResolvedValue({ ...DETAIL, aiMark: MARK });
    renderPage();
    const row = (await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요")).closest("li")!;

    // Both chips on the same row: the rule's 참고 AND the pilot's AI 확인 필요.
    expect(within(row).getByText("참고")).toBeInTheDocument();
    expect(within(row).getByText("AI 확인 필요")).toBeInTheDocument();
    // And the disclosure once the detail is open — the rule did not call this 확인 필요, a classifier did.
    await userEvent.click(within(row).getByRole("button"));
    expect(await screen.findByText(/AI 분류가 판매자가 확인할 내용이 있다고 판단한/)).toBeInTheDocument();
  });

  it("an org NOT opted in gets the pre-pilot screen: no controls, no silver — even if a mark arrived", async () => {
    // The backend sends no marks for such an org; if one did arrive, the controls and the silver
    // must still be absent, because aiPilotEnabled — not the presence of marks — is the switch.
    getChannelReviewsStrict.mockResolvedValue({ ...PAGE, aiPilotEnabled: false });
    renderPage();
    await userEvent.click((await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요")).closest("button")!);
    await screen.findByText(/노출상품ID/);
    expect(screen.queryByText("이 상품평, 확인이 필요한가요?")).toBeNull();
    expect(screen.queryByLabelText("분류 피드백")).toBeNull();
    expect(recordBehavior).not.toHaveBeenCalled();
  });

  it("a channel outside the contract's three gets no controls and no silver, even with the org opted in", async () => {
    // Contract §1: the server has no route for such a channel, so the page has no control. The switch is
    // the channel row on the wire, not the channel's name and not the presence of marks.
    getChannelReviewsStrict.mockResolvedValue({
      ...PAGE,
      aiPilotEnabled: true,
      channel: { channelCode: "GMARKET", aiTriage: false, originalLocate: "NONE", replySupported: false },
      items: [{ ...PAGE.items[0], aiMark: MARK }, PAGE.items[1]],
    });
    renderPage();
    await userEvent.click((await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요")).closest("button")!);
    await screen.findByText(/원문 화면으로 바로 이동할 수 없습니다/);
    expect(screen.queryByText(/이 (상품평|리뷰), 확인이 필요한가요\?/)).toBeNull();
    expect(screen.queryByLabelText("분류 피드백")).toBeNull();
    expect(screen.queryByRole("button", { name: "쿠팡에서 보기" })).toBeNull();
    expect(recordBehavior).not.toHaveBeenCalled();
  });

  it("shows nothing about AI on a row without a mark", async () => {
    renderPage();
    await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요");
    expect(screen.queryByText("AI 확인 필요")).toBeNull();
    expect(screen.queryByText(/AI 분류가/)).toBeNull();
  });

  it("records a correction and an action, and changes nothing on screen — no tier moves, no row hides", async () => {
    correctTriage.mockResolvedValue({ reviewId: "r1", needsAttention: false, reasonCode: null, shownSource: "RULES" });
    getChannelReviewsStrict.mockResolvedValue({ ...PAGE, aiPilotEnabled: true });
    renderPage();
    await userEvent.click((await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요")).closest("button")!);
    await screen.findByText("이 상품평, 확인이 필요한가요?");

    await userEvent.click(screen.getByRole("button", { name: "확인할 필요 없어요" }));
    await waitFor(() => expect(correctTriage).toHaveBeenCalledWith("acc-1", "r1", { needsAttention: false, reasonCode: null }));
    // The answer is shown as pressed — and the row and the tier are exactly where they were.
    expect(screen.getByRole("button", { name: "확인할 필요 없어요" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("배송도 빠르고 포장도 꼼꼼했어요")).toBeInTheDocument();
    expect(screen.getAllByText("참고").length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole("button", { name: "조치 완료" }));
    await waitFor(() => expect(recordAction).toHaveBeenCalledWith("acc-1", "r1", "ACTION_COMPLETED"));
    // The copy says what happens: recorded, not applied, and nothing sent to a marketplace.
    expect(screen.getByText(/답변은 기록만 됩니다/)).toBeInTheDocument();
    expect(screen.getByText(/마켓플레이스에는 아무것도 전송되지 않습니다/)).toBeInTheDocument();
  });

  it("offers a binary answer only — no 지켜보기 / 참고 choice, because the pilot does not own that split", async () => {
    getChannelReviewsStrict.mockResolvedValue({ ...PAGE, aiPilotEnabled: true });
    renderPage();
    await userEvent.click((await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요")).closest("button")!);
    await screen.findByText("이 상품평, 확인이 필요한가요?");
    const feedback = screen.getByLabelText("분류 피드백");
    expect(within(feedback).queryByRole("button", { name: /지켜보기/ })).toBeNull();
    expect(within(feedback).queryByRole("button", { name: /^참고$/ })).toBeNull();
  });

  it("reports exposure and opening as silver, only for rows something raised, and never fails the list on it", async () => {
    recordBehavior.mockRejectedValue(new Error("down"));
    getChannelReviewsStrict.mockResolvedValue({
      ...PAGE,
      aiPilotEnabled: true,
      items: [{ ...PAGE.items[0], aiMark: MARK }, PAGE.items[1]],
    });
    renderPage();
    await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요");
    // Row 1 carries a mark → AI_ATTENTION_SHOWN (a claim the server verifies). Row 2 is a rules
    // 확인 필요 with no mark → nothing: a rendered rules row is not an event in contract v1.
    await waitFor(() => expect(recordBehavior).toHaveBeenCalledWith("acc-1", [
      { reviewId: "r1", kind: "AI_ATTENTION_SHOWN" },
    ]));
    // The recorder is DOWN, and the list is still there.
    expect(screen.getByText("배송도 빠르고 포장도 꼼꼼했어요")).toBeInTheDocument();
    expect(screen.queryByText(/불러오지 못했습니다/)).toBeNull();
  });
});

describe("accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = renderPage();
    await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요");

    await expectNoAxeViolations(container);
  });
});
