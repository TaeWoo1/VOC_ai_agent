// @vitest-environment jsdom
// The 리뷰 surface: one workflow door over per-account review records. What it owns is the question
// "which channel's reviews?" — the record page underneath is tested in ChannelReviews.test.tsx.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Reviews } from "./Reviews";
import { expectNoAxeViolations } from "../../test/axe";
import type { ChannelResponse, ChannelReviewPageView, SellerAccountResponse } from "../../lib/types";

const getSellerAccountsStrict = vi.fn();
const getChannelsStrict = vi.fn();
const getChannelReviewsStrict = vi.fn();
const getProductReviews = vi.fn();

vi.mock("../../lib/apiClient", () => ({
  api: {
    getSellerAccountsStrict: () => getSellerAccountsStrict(),
    getChannelsStrict: () => getChannelsStrict(),
    getChannelReviewsStrict: (accountId: string, params: unknown) =>
      getChannelReviewsStrict(accountId, params),
    getChannelReviewStrict: vi.fn(),
    recordChannelReviewTriageBehavior: vi.fn(),
    getProductReviews: (productId: string, options: unknown) => getProductReviews(productId, options),
    // 내 답변 작업 mounts on a reply-capable (NAVER) account since A6; keep it empty and off the wire here.
    getReplyWork: async (accountId: string) => ({
      sellerAccountId: accountId,
      channel: "NAVER",
      coverage: "COVERED",
      todo: [],
      recentlyReported: [],
    }),
  },
  getToken: () => "token",
}));

function channel(id: string, code: string, nameKo: string): ChannelResponse {
  return {
    id,
    code,
    nameKo,
    status: "CONNECTED",
    dataBadges: [],
    lastSyncedAt: null,
    actionLabel: "연결 관리",
    support: {
      autoCollectSupported: false,
      autoCollectDataTypes: [],
      fileUploadSupported: true,
      fileUploadDataTypes: [],
      connectionCheckSupported: false,
      credentialSetupSupported: false, screenReadReviews: false,
    },
  } as ChannelResponse;
}

function account(id: string, channelId: string, channelNameKo: string): SellerAccountResponse {
  return {
    id,
    channelId,
    channelNameKo,
    alias: null,
    connectionStatus: "CONNECTED",
    lastSyncedAt: null,
    fileUpload: false,
  };
}

function page(code: string): ChannelReviewPageView {
  return {
    page: 0,
    size: 20,
    total: 0,
    newCount: 0,
    lastImportAt: null,
    lastImportComplete: true,
    aiPilotEnabled: false,
    channel: {
      channelCode: code,
      aiTriage: true,
      originalLocate: code === "COUPANG" ? "LOCATE_RUN" : "NONE",
      replySupported: code === "NAVER",
    },
    triageSummary: { needsAttention: 0, watch: 0, fyi: 0, aiAttention: 0, repeatedCategories: [] },
    items: [],
  } as ChannelReviewPageView;
}

const CHANNELS = [
  channel("cp", "COUPANG", "쿠팡"),
  channel("nv", "NAVER", "네이버 스마트스토어"),
  channel("c24", "CAFE24", "카페24 자사몰"),
];

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/reviews" element={<Reviews />} />
        <Route path="/reviews/:accountId" element={<Reviews />} />
        <Route path="/connect" element={<h1>채널 연결</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  /**
   * <b>Cleared HERE, not only in `afterEach` — this file's flake.</b> Caught 2026-09-04 with two
   * different test names on two runs (`points at 채널 연결 when no review-capable channel is connected`
   * failing with 「expected spy to not be called, but was called once」 for account `acc-nv`, which that
   * test's own fixture does not contain).
   *
   * The account came from the PREVIOUS test. `ChannelReviews` reads the accounts, and only in the
   * continuation of that promise does it read the record — so a test that finishes as soon as its own
   * assertion passes leaves that second read queued. RTL's `cleanup` unmounts the component but cannot
   * un-queue a `.then` that has already been scheduled, and the `active` guard inside it stops the
   * setState, not the call. The call therefore landed after `afterEach` had cleared the spies, i.e.
   * inside the next test, and WHICH test it landed in depended on scheduling — which is why the failing
   * name moved between runs and why it never reproduced in isolation.
   *
   * Clearing at the start of each test closes it: hooks are an async boundary, so a continuation queued
   * during teardown has run by the time this line executes. `afterEach` keeps its clear as well; the two
   * are not redundant — that one bounds what a failing test leaves behind.
   */
  vi.clearAllMocks();
  getChannelsStrict.mockResolvedValue(CHANNELS);
  getSellerAccountsStrict.mockResolvedValue([
    account("acc-cp", "cp", "쿠팡"),
    account("acc-nv", "nv", "네이버 스마트스토어"),
  ]);
  getChannelReviewsStrict.mockImplementation(async (accountId: string) =>
    page(accountId === "acc-cp" ? "COUPANG" : "NAVER"),
  );
  getProductReviews.mockResolvedValue({
    productId: "p-1",
    productName: "선바로 일체형 전선몰딩",
    total: 2,
    page: 0,
    size: 20,
    items: [
      {
        id: "rev-1",
        sellerAccountId: "acc-nv",
        channelCode: "NAVER",
        channelNameKo: "네이버 스마트스토어",
        writtenOn: "2026-08-14",
        rating: 1,
        negative: true,
        preview: "붙이는 부분이 떨어졌어요",
        productId: "p-1",
        productName: "선바로 일체형 전선몰딩",
        replyState: null,
        executableIdentity: "MARKETPLACE",
      },
      {
        id: "rev-2",
        sellerAccountId: "acc-cp",
        channelCode: "GMARKET",
        channelNameKo: "G마켓/옥션",
        writtenOn: "2025-07-10",
        rating: 5,
        negative: false,
        preview: null,
        productId: "p-1",
        productName: "선바로 일체형 전선몰딩",
        replyState: null,
        executableIdentity: "NONE",
      },
    ],
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("리뷰 — the workflow surface", () => {
  it("opens the first review-capable account in product order when no account is named", async () => {
    renderAt("/reviews");
    const nav = await screen.findByRole("navigation", { name: "리뷰 채널" });
    const current = within(nav).getByRole("link", { current: "page" });
    expect(current).toHaveTextContent("네이버 스마트스토어");
    expect(current).toHaveAttribute("href", "/reviews/acc-nv");
    // The record underneath is the named account's, and it speaks the product's word.
    expect(await screen.findByRole("heading", { level: 1, name: "리뷰" })).toBeInTheDocument();
    expect(getChannelReviewsStrict).toHaveBeenCalledWith("acc-nv", expect.anything());
  });

  it("switches channel by account; the h1 stays 리뷰 and the record heading names the channel", async () => {
    renderAt("/reviews/acc-cp");
    const nav = await screen.findByRole("navigation", { name: "리뷰 채널" });
    expect(within(nav).getAllByRole("link").map((l) => l.textContent)).toEqual([
      "네이버 스마트스토어",
      "쿠팡",
    ]);
    expect(within(nav).getByRole("link", { current: "page" })).toHaveTextContent("쿠팡");
    expect(screen.getByRole("heading", { level: 1, name: "리뷰" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { level: 2, name: "쿠팡" })).toBeInTheDocument();
    // One line, and it answers what the screen is — the tier chips below state the ordering.
    expect(screen.getByText("확인이 필요한 리뷰부터 봅니다.")).toBeInTheDocument();
  });

  it("keeps the tier filter and drops the review selection when switching channel", async () => {
    renderAt("/reviews/acc-cp?tier=NEEDS_ATTENTION&review=r9");
    const nav = await screen.findByRole("navigation", { name: "리뷰 채널" });
    expect(within(nav).getByRole("link", { name: "네이버 스마트스토어" })).toHaveAttribute(
      "href",
      "/reviews/acc-nv?tier=NEEDS_ATTENTION",
    );
  });

  it("names no channel that keeps no record, and no channel outside the product set", async () => {
    getChannelsStrict.mockResolvedValue([...CHANNELS, channel("gm", "GMARKET", "G마켓")]);
    getSellerAccountsStrict.mockResolvedValue([account("acc-gm", "gm", "G마켓"), account("acc-cp", "cp", "쿠팡"), account("acc-nv", "nv", "네이버 스마트스토어")]);
    renderAt("/reviews/acc-cp");
    const nav = await screen.findByRole("navigation", { name: "리뷰 채널" });
    expect(within(nav).queryByText("G마켓")).toBeNull();
    expect(within(nav).getByRole("link", { current: "page" })).toHaveTextContent("쿠팡");
  });

  it("shows no switcher for a single account — the record heading already names it", async () => {
    getSellerAccountsStrict.mockResolvedValue([account("acc-nv", "nv", "네이버 스마트스토어")]);
    renderAt("/reviews");
    expect(await screen.findByRole("heading", { level: 2, name: "네이버 스마트스토어" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "리뷰 채널" })).toBeNull();
  });

  it("points at 채널 연결 when no review-capable channel is connected", async () => {
    getSellerAccountsStrict.mockResolvedValue([]);
    renderAt("/reviews");
    expect(await screen.findByText("리뷰를 볼 채널이 아직 없습니다")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "채널 연결하기" })).toHaveAttribute("href", "/connect");
    expect(getChannelReviewsStrict).not.toHaveBeenCalled();
  });

  it("says so when the channel reads fail, and invents no list", async () => {
    getSellerAccountsStrict.mockRejectedValue(new Error("down"));
    renderAt("/reviews");
    expect(await screen.findByText("채널 정보를 불러오지 못했습니다")).toBeInTheDocument();
    expect(getChannelReviewsStrict).not.toHaveBeenCalled();
  });

  it("has no axe violations", async () => {
    const { container } = renderAt("/reviews/acc-nv");
    await screen.findByRole("navigation", { name: "리뷰 채널" });
    await screen.findByRole("heading", { level: 2, name: "네이버 스마트스토어" });
    await expectNoAxeViolations(container);
  });
});

/**
 * 리뷰, narrowed to a product — the door the 상품 screen's 리뷰 figure opens
 * (Product Operations Continuity v1 §1).
 *
 * What is pinned here is the promise of the door, not its decoration: the scope is stated, it can be
 * cleared, the account switcher is gone because a product's reviews are not one account's, and every
 * row opens the exact review rather than a filtered record the seller has to search again.
 */
describe("리뷰 — narrowed to one product", () => {
  it("states the scope, offers the way out, and drops the channel switcher", async () => {
    renderAt("/reviews?productId=p-1");
    expect(await screen.findByText(/의 리뷰만 보고 있습니다/)).toBeInTheDocument();
    // The product name arrives with the product-scoped record read, which resolves after the scope
    // sentence — awaited, because under load (two full suites running beside this one, 2026-09-04) the
    // synchronous lookup ran between the two renders and failed twice in a row while passing alone.
    expect(await screen.findByText("선바로 일체형 전선몰딩")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "전체 리뷰 보기" })).toHaveAttribute("href", "/reviews");
    expect(screen.queryByRole("navigation", { name: "리뷰 채널" })).toBeNull();
  });

  it("reads the product's own record — never an account's, and never the window read", async () => {
    renderAt("/reviews?productId=p-1");
    await screen.findByText(/의 리뷰만 보고 있습니다/);
    expect(getProductReviews).toHaveBeenCalledWith("p-1", expect.objectContaining({ page: 0 }));
    // The per-account record is the OTHER question; asking it here would answer a narrower one.
    expect(getChannelReviewsStrict).not.toHaveBeenCalled();
  });

  it("carries a row from a channel the switcher cannot show, and opens the exact review", async () => {
    renderAt("/reviews?productId=p-1");
    const first = await screen.findByRole("link", { name: /붙이는 부분이 떨어졌어요/ });
    expect(first).toHaveAttribute("href", "/reviews/reply/rev-1");
    // G마켓 is outside the seller-visible channel set, and the figure counted it, so it is here.
    expect(screen.getByText("G마켓/옥션")).toBeInTheDocument();
  });

  it("names a rating-only review rather than rendering an empty row", async () => {
    renderAt("/reviews?productId=p-1");
    expect(await screen.findByRole("link", { name: /별점 5점만 남긴 리뷰/ })).toBeInTheDocument();
  });
});
