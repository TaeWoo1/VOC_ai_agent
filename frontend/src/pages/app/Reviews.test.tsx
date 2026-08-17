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

vi.mock("../../lib/apiClient", () => ({
  api: {
    getSellerAccountsStrict: () => getSellerAccountsStrict(),
    getChannelsStrict: () => getChannelsStrict(),
    getChannelReviewsStrict: (accountId: string, params: unknown) =>
      getChannelReviewsStrict(accountId, params),
    getChannelReviewStrict: vi.fn(),
    recordChannelReviewTriageBehavior: vi.fn(),
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
      credentialSetupSupported: false,
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
  getChannelsStrict.mockResolvedValue(CHANNELS);
  getSellerAccountsStrict.mockResolvedValue([
    account("acc-cp", "cp", "쿠팡"),
    account("acc-nv", "nv", "네이버 스마트스토어"),
  ]);
  getChannelReviewsStrict.mockImplementation(async (accountId: string) =>
    page(accountId === "acc-cp" ? "COUPANG" : "NAVER"),
  );
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

  it("switches channel by account and lets the record speak the channel's own word", async () => {
    renderAt("/reviews/acc-cp");
    const nav = await screen.findByRole("navigation", { name: "리뷰 채널" });
    expect(within(nav).getAllByRole("link").map((l) => l.textContent)).toEqual([
      "네이버 스마트스토어",
      "쿠팡",
    ]);
    expect(within(nav).getByRole("link", { current: "page" })).toHaveTextContent("쿠팡");
    expect(await screen.findByRole("heading", { level: 1, name: "상품평" })).toBeInTheDocument();
  });

  it("names no channel that keeps no record, and no channel outside the product set", async () => {
    getChannelsStrict.mockResolvedValue([...CHANNELS, channel("gm", "GMARKET", "G마켓")]);
    getSellerAccountsStrict.mockResolvedValue([account("acc-gm", "gm", "G마켓"), account("acc-cp", "cp", "쿠팡")]);
    renderAt("/reviews");
    const nav = await screen.findByRole("navigation", { name: "리뷰 채널" });
    expect(within(nav).queryByText("G마켓")).toBeNull();
    expect(within(nav).getByRole("link", { current: "page" })).toHaveTextContent("쿠팡");
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
    await screen.findByRole("heading", { level: 1, name: "리뷰" });
    await expectNoAxeViolations(container);
  });
});
