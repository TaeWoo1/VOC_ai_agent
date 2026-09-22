// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ReviewRecord, rangeLabel } from "./ReviewRecord";
import { expectNoAxeViolations } from "../../test/axe";
import type { ChannelReviewDetailView, ChannelReviewPageView, ReviewRecordPageView } from "../../lib/types";
import type { ReviewAccount } from "../../lib/reviewAccounts";

const getChannelReviewsStrict = vi.fn();
const getChannelReviewStrict = vi.fn();
const getReplyWork = vi.fn();
const getReviewReplyPrep = vi.fn();
const recordBehavior = vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined);
const correctTriage = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const recordAction = vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined);
const withdrawCorrection = vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined);

vi.mock("../../lib/apiClient", () => ({
  api: {
    // The ONE record read; the fixtures below are written as the channel page they always were and served
    // through `asRecord` — the organisation's record over one channel is that channel's record (ReviewRecordIT).
    getReviewRecordStrict: async (params: unknown) => asRecord(await getChannelReviewsStrict("acc-1", params)),
    getReviewWorkspace: (reviewId: string) => getChannelReviewStrict("acc-1", reviewId),
    getReviewWorkStrict: async () => ({ attentionTotal: 0, attention: [], committed: [] }),
    getCustomerOperationsDecisions: async () => ({ total: 0, rows: [] }),
    startChannelReviewLocateRun: vi.fn(),
    recordChannelReviewTriageBehavior: (...args: unknown[]) => recordBehavior(...args),
    correctChannelReviewTriage: (...args: unknown[]) => correctTriage(...args),
    withdrawChannelReviewTriageCorrection: (...args: unknown[]) => withdrawCorrection(...args),
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
    sellerCorrection: null,
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
    sellerCorrection: null,
    },
  ],
};

/** A standing seller correction, as the read carries it. */
function correctionView(tier: "NEEDS_ATTENTION" | "WATCH" | "FYI") {
  return {
    reviewId: "r1",
    correctedTier: tier,
    reasonCode: null,
    systemTier: "NEEDS_ATTENTION" as const,
    systemSource: "RULES" as const,
    correctedAt: "2026-09-11T00:00:00Z",
    changeCount: 1,
  };
}

const DETAIL: ChannelReviewDetailView = {
  id: "r1",
  sellerAccountId: "acc-1",
  replyUnavailableReason: null,
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
  sellerCorrection: null,
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

const TARGETS = [
  { account: { id: "acc-1" }, channel: { code: "COUPANG", nameKo: "쿠팡" }, label: "쿠팡" },
] as unknown as ReviewAccount[];

/** A channel page, read as the organisation's record over that one channel. */
function asRecord(page: ChannelReviewPageView): ReviewRecordPageView {
  const code = page.channel.channelCode;
  return {
    page: page.page,
    size: page.size,
    total: page.total,
    newCount: page.newCount,
    aiPilotEnabled: page.aiPilotEnabled,
    channels: [code],
    triageSummary: page.triageSummary,
    items: page.items.map((review) => ({ channelCode: code, channelNameKo: null, review })),
    channelFacts: [
      {
        channelCode: code,
        channelNameKo: null,
        accountId: "acc-1",
        capability: page.channel,
        lastImportAt: page.lastImportAt,
        lastImportComplete: page.lastImportComplete,
      },
    ],
    outsideVisibleChannels: 0,
  };
}

function renderPage(path = "/reviews") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/reviews"
          element={
            <>
              <ReviewRecord targets={TARGETS} />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

/** The list and the detail side by side, as the record is drawn at 1200px and up. */
function stubWide(): () => void {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}

let restoreWide: () => void = () => undefined;
afterEach(() => restoreWide());

beforeEach(() => {
  vi.clearAllMocks();
  restoreWide = stubWide();
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
 * product's one reply cluster and the page OPENS with 내 답변 작업. Where it does not, nothing of the kind
 * renders — no control the server would refuse.
 *
 * <b>The placement assertion was rewritten, not weakened</b> (Approval Path v1 §2). It used to pin
 * 내 답변 작업 at the END of the page, which was the deliberate arrangement at the time — the worklist is
 * the record's follow-through, not a second list of what needs a look. On the live NAVER account that
 * measured as the seller's own committed work sitting six screens below the fold behind 4,455 rows they
 * did not come for. What it IS did not change; where it goes did.
 */
describe("reply work on the 리뷰 screen (A6)", () => {
  const NAVER_PAGE: ChannelReviewPageView = {
    ...PAGE,
    channel: { channelCode: "NAVER", aiTriage: true, originalLocate: "NONE", replySupported: true },
  };
  const NAVER_DETAIL: ChannelReviewDetailView = {
    ...DETAIL,
    replyWork: { actionRef: "review:r1", triageDisposition: null, hasReplyPreparation: false, channelReplyState: "PENDING" },
  };

  it("NAVER: the detail READS the decision and offers the door — it no longer records one", async () => {
    getChannelReviewsStrict.mockResolvedValue(NAVER_PAGE);
    getChannelReviewStrict.mockResolvedValue(NAVER_DETAIL);
    renderPage("/reviews?review=r1");

    const block = await screen.findByRole("region", { name: "판단과 조치" });
    // Who writes the answer — the channel's capability, said where the door is.
    expect(within(block).getByText(/올리는 일은 판매자센터에서 직접 합니다/)).toBeInTheDocument();
    // What stands, as facts. No control that writes: the record is a record.
    expect(within(block).getByText(/시스템 판단/)).toBeInTheDocument();
    expect(within(block).getByText("처리 상태 판단 전")).toBeInTheDocument();
    expect(within(block).queryByRole("button", { name: "대응 필요" })).toBeNull();
    expect(within(block).queryByRole("button", { name: "확인 필요" })).toBeNull();
    expect(within(block).queryByRole("heading", { name: "답변 준비" })).toBeNull();
    expect(getReviewReplyPrep).not.toHaveBeenCalled();
    // One door, to the one place the decision is made — and the way back to this record.
    expect(within(block).getByRole("link", { name: "이 리뷰 처리하기" }))
      .toHaveAttribute("href", "/reviews/reply/r1?from=record");

    // UI/UX v2 Phase 3 (product-owner decision): the reply to-do is 확인할 일's, not this record's. The
    // 「내 답변 작업」 area this record used to open with is gone, and its read is not made here.
    expect(screen.queryByRole("heading", { name: /내 답변 작업/ })).toBeNull();
    expect(getReplyWork).not.toHaveBeenCalled();
  });

  it("NAVER: a review already marked 대응 필요 opens no draft here — the panel lives in 리뷰 처리", async () => {
    getChannelReviewsStrict.mockResolvedValue(NAVER_PAGE);
    getChannelReviewStrict.mockResolvedValue({
      ...NAVER_DETAIL,
      replyWork: { actionRef: "review:r1", triageDisposition: "RESPONSE_NEEDED", hasReplyPreparation: true, channelReplyState: "PENDING" },
    });
    renderPage("/reviews?review=r1");

    const block = await screen.findByRole("region", { name: "판단과 조치" });
    // The decision is READ back, so the record still says where the review stands.
    expect(within(block).getByText("처리 상태 대응 필요")).toBeInTheDocument();
    // …and the draft is not mounted here. Two rooms preparing one reply is how they drift apart.
    expect(within(block).queryByRole("heading", { name: "답변 준비" })).toBeNull();
    expect(getReviewReplyPrep).not.toHaveBeenCalled();
  });

  it("Coupang: no decision, no preparation, no 내 답변 작업 — the channel has no reply flow", async () => {
    renderPage("/reviews?review=r1");
    const block = await screen.findByRole("region", { name: "판단과 조치" });
    expect(within(block).getByText(/reviewnary가 답변을 작성하지 않습니다/)).toBeInTheDocument();
    await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요. 다음에도 구매할게요.");
    expect(screen.queryByRole("region", { name: "답변" })).toBeNull();
    expect(screen.queryByRole("button", { name: "대응 필요" })).toBeNull();
    expect(screen.queryByRole("heading", { name: /내 답변 작업/ })).toBeNull();
    expect(getReplyWork).not.toHaveBeenCalled();
  });
});

describe("deep-link seams the home relies on", () => {
  it("?tier=NEEDS_ATTENTION opens the list under that filter — the same filter whose total the home tile shows", async () => {
    renderPage("/reviews?tier=NEEDS_ATTENTION");
    await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요");
    expect(getChannelReviewsStrict).toHaveBeenCalledWith("acc-1", expect.objectContaining({ tier: "NEEDS_ATTENTION" }));
  });

  it("ignores an unknown tier value rather than sending it to the server, and scrubs it from the URL", async () => {
    renderPage("/reviews?tier=WHATEVER");
    await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요");
    expect(getChannelReviewsStrict).toHaveBeenCalledWith("acc-1", expect.objectContaining({ tier: undefined }));
    expect(screen.getByTestId("location")).toHaveTextContent("/reviews");
    expect(screen.getByTestId("location").textContent).not.toContain("tier=");
  });

  it("the URL is the filter, both ways: a tier press writes ?tier and drops ?review; 전체 clears it", async () => {
    renderPage("/reviews?review=r1");
    await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요");
    await userEvent.click(screen.getByRole("button", { name: /^확인 필요 \d+$/ }));
    expect(screen.getByTestId("location")).toHaveTextContent("/reviews?tier=NEEDS_ATTENTION");
    expect(getChannelReviewsStrict).toHaveBeenLastCalledWith("acc-1", expect.objectContaining({ tier: "NEEDS_ATTENTION" }));
    await userEvent.click(screen.getByRole("button", { name: /^전체 \d+$/ }));
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/reviews$/);
  });

  it("the URL is the selection, both ways: a row press writes ?review", async () => {
    renderPage();
    await userEvent.click((await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요")).closest("a")!);
    expect(screen.getByTestId("location")).toHaveTextContent("/reviews?review=r1");
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
    renderPage("/reviews?review=r1");
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
    // One row came in with the last import — the list marks exactly that one.
    expect(within(screen.getByRole("region", { name: "목록" })).getAllByText("새 리뷰")).toHaveLength(1);
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
  it("says what it is, rather than implying reviewnary lost the text", async () => {
    getChannelReviewsStrict.mockResolvedValue({
      ...PAGE,
      items: [{ ...PAGE.items[0]!, preview: null, textless: true }],
    });
    renderPage();

    expect(await screen.findByText("별점만 남긴 리뷰")).toBeInTheDocument();
    expect(screen.queryByText(/표시할 수 있는 본문이 없습니다/)).toBeNull();
  });

  it("says the rating still counts, in the detail", async () => {
    getChannelReviewsStrict.mockResolvedValue({
      ...PAGE,
      items: [{ ...PAGE.items[0]!, preview: null, textless: true }],
    });
    getChannelReviewStrict.mockResolvedValue({ ...DETAIL, body: "", textless: true });
    renderPage();

    await userEvent.click(await screen.findByText("별점만 남긴 리뷰"));

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

    expect(await screen.findByText("아직 수집된 리뷰가 없습니다")).toBeInTheDocument();
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
    expect(rangeLabelOf({ ...LONG, page: 1 })).toBe("21–22번째 · 총 42개");
    // Derived from what the RESPONSE said, so a server that clamped the size cannot be misdescribed.
    expect(rangeLabelOf({ ...LONG, page: 0, size: 2 })).toBe("1–2번째 · 총 42개");
    expect(rangeLabelOf(null)).toBe("0개 표시 중");
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
    expect(rangeLabelOf({ ...LONG, page: 2 })).toBe("41–42번째 · 총 42개");
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
  it("says which tier a review is in on the row, and why in the review itself", async () => {
    // UI/UX v2 Phase 2–3: the row is three lines (state · stars · where; the sentence; the product). The rule's
    // reason and advice explain a decision, so they are read where the decision is looked at — in the detail.
    getChannelReviewStrict.mockResolvedValue({
      ...DETAIL,
      id: "r2",
      triage: PAGE.items[1].triage,
    });
    renderPage("/reviews?review=r2");
    const row = (await screen.findByText("생각보다 크기가 작아서 아쉬웠습니다")).closest("li")!;
    expect(within(row).getByText("확인 필요")).toBeInTheDocument();
    expect(await screen.findByText("1점 · 설치 · 같은 분류 11건")).toBeInTheDocument();
    expect(
      screen.getByText("같은 분류의 상품평이 반복됩니다. 상품·포장 상태를 확인해 보세요."),
    ).toBeInTheDocument();
  });

  it("offers a well-rated review no action rather than a reassuring sentence", async () => {
    // The 5★ review's detail carries its reason and its tier and NOTHING in the action slot.
    renderPage("/reviews?review=r1");
    const detail = await screen.findByLabelText("선택한 리뷰");
    expect(await within(detail).findByText("5점")).toBeInTheDocument();
    expect(within(detail).queryByText(/확인해 보세요/)).toBeNull();
    expect(within((screen.getByText("배송도 빠르고 포장도 꼼꼼했어요")).closest("li")!).getByText("참고")).toBeInTheDocument();
  });

  it("summarises the whole record above the list — as a record, not as work", async () => {
    renderPage();
    await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요");

    // The work count moved to 확인할 일 (UI/UX v2 Phase 3); what the record keeps is what its classification sees.
    expect(screen.getByText("같은 자동 분류가 많은 리뷰")).toBeInTheDocument();
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

    expect(await screen.findByText("확인 필요에 해당하는 리뷰가 없습니다")).toBeInTheDocument();
    expect(screen.queryByText("아직 수집된 리뷰가 없습니다")).toBeNull();
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
        sellerCorrection: null,
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
        sellerCorrection: null,
        },
      ],
    });
    renderPage();
    await screen.findByText("생각보다 크기가 작아서 아쉬웠습니다");

    const list = screen.getByRole("region", { name: "목록" });
    expect(within(list).getByText("참고")).toBeInTheDocument();
    expect(within(list).queryByText("확인 필요")).toBeNull();
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
    await userEvent.click(within(row).getByRole("link"));
    expect(await screen.findByText(/AI 분류가 판매자가 확인할 내용이 있다고 판단한/)).toBeInTheDocument();
  });

  it("an org NOT opted in gets the pre-pilot screen: no controls, no silver — even if a mark arrived", async () => {
    // The backend sends no marks for such an org; if one did arrive, the controls and the silver
    // must still be absent, because aiPilotEnabled — not the presence of marks — is the switch.
    getChannelReviewsStrict.mockResolvedValue({ ...PAGE, aiPilotEnabled: false });
    renderPage();
    await userEvent.click((await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요")).closest("a")!);
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
    await userEvent.click((await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요")).closest("a")!);
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

  it("records nothing — the record reads the decision and hands the seller the door", async () => {
    getChannelReviewsStrict.mockResolvedValue({ ...PAGE, aiPilotEnabled: true });
    renderPage();
    await userEvent.click((await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요")).closest("a")!);
    const block = await screen.findByRole("region", { name: "판단과 조치" });

    // Every mutation this panel used to own now lives on 리뷰 처리: the decision, the seller's own
    // tier, the recorded act, the draft. Two rooms for one decision is how a product gets two answers
    // — and it is also how ACTION_NOT_NEEDED and NO_ACTION both existed for the same sentence.
    expect(screen.queryByText("이 상품평, 판매자님 판단은 어떠신가요?")).toBeNull();
    expect(screen.queryByLabelText("판매자 판단")).toBeNull();
    expect(screen.queryByLabelText("조치 기록")).toBeNull();
    expect(screen.queryByRole("button", { name: "조치 완료" })).toBeNull();
    expect(screen.queryByRole("button", { name: "조치 불필요" })).toBeNull();
    expect(correctTriage).not.toHaveBeenCalled();
    expect(recordAction).not.toHaveBeenCalled();
    expect(within(block).getByRole("link", { name: "이 리뷰 처리하기" })).toBeInTheDocument();
    expect(within(block).getByText(/판단·조치·답변 준비는 리뷰 처리 화면에서 합니다/)).toBeInTheDocument();
  });

  it("offers no tier controls at all — choosing among the three is the workspace's job", async () => {
    // The three-way choice itself is unchanged and still pinned, on the surface that now owns it
    // (`ReviewReplyTask.test.tsx`). What moved is WHERE it is offered, not WHAT it offers.
    getChannelReviewsStrict.mockResolvedValue({ ...PAGE, aiPilotEnabled: true });
    renderPage();
    await userEvent.click((await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요")).closest("a")!);
    await screen.findByRole("region", { name: "판단과 조치" });
    expect(screen.queryByRole("button", { name: "지켜보기" })).toBeNull();
    expect(screen.queryByRole("button", { name: "수정 되돌리기" })).toBeNull();
  });

  it("reads the seller's standing answer whether or not the pilot is on — reading is not the pilot's either", async () => {
    getChannelReviewsStrict.mockResolvedValue({ ...PAGE, aiPilotEnabled: false });
    getChannelReviewStrict.mockResolvedValue({ ...DETAIL, sellerCorrection: correctionView("FYI") });
    renderPage();
    await userEvent.click((await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요")).closest("a")!);
    const block = await screen.findByRole("region", { name: "판단과 조치" });
    expect(within(block).getByText(/판매자 수정/)).toBeInTheDocument();
    expect(screen.queryByLabelText("판매자 판단")).toBeNull();
  });

  it("shows BOTH judgments as facts — the system's is not overwritten and the seller's is not lost", async () => {
    // Requirement 4, on the read side. The pressing half moved to 리뷰 처리; what the record owes the
    // seller is that a correction they made is visible here too, from the READ rather than a session.
    getChannelReviewStrict.mockResolvedValue({
      ...DETAIL,
      triage: { tier: "NEEDS_ATTENTION", reason: "낮은 별점", tags: [], recommendedAction: null },
      sellerCorrection: correctionView("FYI"),
    });
    renderPage();
    await userEvent.click((await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요")).closest("a")!);
    const block = await screen.findByRole("region", { name: "판단과 조치" });
    expect(correctTriage).not.toHaveBeenCalled();
    expect(within(block).getByText(/시스템 판단/)).toBeInTheDocument();
    expect(within(block).getByText(/판매자 수정/)).toBeInTheDocument();
    // Both words are on the line, and neither replaced the other.
    expect(within(block).getByText("확인 필요")).toBeInTheDocument();
    expect(within(block).getByText("참고")).toBeInTheDocument();
  });

  it("a corrected row says so in the queue, and does not move", async () => {
    // Requirement 6, on the list side. The chip is quiet on purpose: 확인 필요 is emphasised because
    // the worklist is ORDERED by it, and a correction reorders nothing.
    getChannelReviewsStrict.mockResolvedValue({
      ...PAGE,
      items: [{ ...PAGE.items[0], sellerCorrection: correctionView("FYI") }, PAGE.items[1]],
    });
    renderPage();
    await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요");
    expect(screen.getByText("판매자 수정 참고")).toBeInTheDocument();
    const rows = within(screen.getByRole("region", { name: "목록" })).getAllByRole("link").map((b) => b.textContent ?? "");
    expect(rows.findIndex((t) => t.includes("배송도 빠르고 포장도 꼼꼼했어요")))
      .toBeLessThan(rows.findIndex((t) => t.includes(PAGE.items[1].preview ?? "")));
  });

  it("offers no 되돌리기 — withdrawing is a write, and writes are the workspace's", async () => {
    getChannelReviewStrict.mockResolvedValue({ ...DETAIL, sellerCorrection: correctionView("WATCH") });
    renderPage();
    await userEvent.click((await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요")).closest("a")!);
    await screen.findByRole("region", { name: "판단과 조치" });
    expect(screen.queryByRole("button", { name: "수정 되돌리기" })).toBeNull();
    expect(withdrawCorrection).not.toHaveBeenCalled();
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

/** The record's range label, as the channel record's used to be tested — through the org page it is computed on. */
function rangeLabelOf(page: ChannelReviewPageView | null): string {
  return rangeLabel(page ? asRecord(page) : null);
}
