// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ChannelReviews, shownRangeLabel } from "./ChannelReviews";
import { expectNoAxeViolations } from "../../test/axe";
import type { ChannelReviewDetailView, ChannelReviewPageView } from "../../lib/types";

const getChannelReviewsStrict = vi.fn();
const getChannelReviewStrict = vi.fn();

vi.mock("../../lib/apiClient", () => ({
  api: {
    getChannelReviewsStrict: (accountId: string, params: unknown) =>
      getChannelReviewsStrict(accountId, params),
    getChannelReviewStrict: (accountId: string, reviewId: string) =>
      getChannelReviewStrict(accountId, reviewId),
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
  triageSummary: {
    needsAttention: 1,
    watch: 0,
    fyi: 1,
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
  locateTarget: {
    productId: "15411270785",
    vendorItemId: "81234567890",
    writtenOn: "2026-08-11",
    rating: 5,
  },
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/connect/channels/acc-1/reviews"]}>
      <Routes>
        <Route path="/connect/channels/:accountId/reviews" element={<ChannelReviews />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getChannelReviewsStrict.mockResolvedValue(PAGE);
  getChannelReviewStrict.mockResolvedValue(DETAIL);
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

    expect(await screen.findByText("상품평을 불러오지 못했습니다")).toBeInTheDocument();
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
        },
      ],
    });
    renderPage();
    await screen.findByText("생각보다 크기가 작아서 아쉬웠습니다");

    expect(screen.getByText("참고")).toBeInTheDocument();
    expect(screen.queryByText("확인 필요")).toBeNull();
  });
});

describe("accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = renderPage();
    await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요");

    await expectNoAxeViolations(container);
  });
});
