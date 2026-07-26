// @vitest-environment jsdom
/**
 * **Which account this screen works on, and whether the seller can tell.**
 *
 * Both pinned because both failed live on 2026-07-26. The page defaulted to whichever connected account the
 * backend returned first — a **Coupang** one in the demo org — so the seller reached "이 기간으로 시작하기" with
 * 쿠팡 named on the card, while every step after it guides NAVER. And the account's own alias
 * ("라이브 2구간 테스트") hid the channel, so the one word that would have given it away was not on screen.
 *
 * The runtime now refuses a ticket whose channel is not the one it drives (`import-host.ts`), which is where that
 * rule belongs. These tests cover the other half: not sending the seller there in the first place.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { ReviewImportPage } from "./ReviewImportPage";
import { api } from "../../lib/apiClient";
import type { ChannelResponse, SellerAccountResponse } from "../../lib/types";

vi.mock("../../hooks/useBridge", () => ({
  useBridge: () => ({
    state: { phase: "unpaired", maybeNeedsLocalNetworkAccess: false },
    requestPairing: vi.fn(),
    revoke: vi.fn(),
    retry: vi.fn(),
  }),
}));

const channel = (id: string, code: string, nameKo: string): ChannelResponse =>
  ({ id, code, nameKo, status: "CONNECTED", dataBadges: [], lastSyncedAt: null, actionLabel: "", support: {} }) as
    unknown as ChannelResponse;

const account = (id: string, channelId: string, channelNameKo: string, alias: string | null): SellerAccountResponse => ({
  id,
  channelId,
  channelNameKo,
  alias,
  connectionStatus: "CONNECTED",
  lastSyncedAt: null,
  fileUpload: true,
});

const COUPANG = channel("ch-coupang", "COUPANG", "쿠팡");
const NAVER = channel("ch-naver", "NAVER", "네이버 스마트스토어");

beforeEach(() => {
  vi.spyOn(api, "getChannels").mockResolvedValue([COUPANG, NAVER]);
  vi.spyOn(api, "listReviewImportPlans").mockResolvedValue([]);
  vi.spyOn(api, "previewReviewImportRange").mockResolvedValue({
    start: "2026-06-01",
    end: "2026-07-26",
    segmentCount: 2,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ReviewImportPage — which account the guided import lands on", () => {
  /**
   * The regression. Coupang comes back FIRST — as it did in the demo org, because the seeder creates it first —
   * and the guided flow can only drive NAVER.
   */
  it("defaults to the NAVER account even when another channel is listed first", async () => {
    vi.spyOn(api, "getSellerAccountsStrict").mockResolvedValue([
      account("acc-coupang", COUPANG.id, "쿠팡", "쿠팡"),
      account("acc-naver", NAVER.id, "네이버 스마트스토어", "라이브 2구간 테스트"),
    ]);

    render(<ReviewImportPage />);

    await waitFor(() => expect(screen.getByTestId("guided-account")).toBeInTheDocument());
    expect(screen.getByTestId("guided-account")).toHaveTextContent("네이버 스마트스토어");
    expect(screen.getByTestId("guided-account")).not.toHaveTextContent("쿠팡");
  });

  /**
   * The alias is the seller's own nickname and says nothing about the marketplace. On the live run it was the only
   * label on screen, which is why the wrong channel went unnoticed.
   */
  it("names the channel alongside the alias, never the alias alone", async () => {
    vi.spyOn(api, "getSellerAccountsStrict").mockResolvedValue([
      account("acc-naver", NAVER.id, "네이버 스마트스토어", "라이브 2구간 테스트"),
    ]);

    render(<ReviewImportPage />);

    await waitFor(() => expect(screen.getByTestId("guided-account")).toBeInTheDocument());
    const label = screen.getByTestId("guided-account");
    expect(label).toHaveTextContent("라이브 2구간 테스트");
    expect(label).toHaveTextContent("네이버 스마트스토어");
  });

  /** A dead channel read must not blank the screen: it degrades to "no preference", the old behaviour. */
  it("still shows a card when the channel list cannot be read", async () => {
    vi.spyOn(api, "getChannels").mockRejectedValue(new Error("down"));
    vi.spyOn(api, "getSellerAccountsStrict").mockResolvedValue([
      account("acc-coupang", COUPANG.id, "쿠팡", null),
    ]);

    render(<ReviewImportPage />);
    await waitFor(() => expect(screen.getByTestId("guided-account")).toBeInTheDocument());
    expect(screen.getByTestId("guided-account")).toHaveTextContent("쿠팡");
  });

  /** With no NAVER account there is nothing to prefer, and the screen still works for the manual paths below it. */
  it("falls back to the first account when none is a guided channel", async () => {
    vi.spyOn(api, "getSellerAccountsStrict").mockResolvedValue([
      account("acc-coupang", COUPANG.id, "쿠팡", null),
    ]);

    render(<ReviewImportPage />);
    await waitFor(() => expect(screen.getByTestId("guided-account")).toBeInTheDocument());
    expect(screen.getByTestId("guided-account")).toHaveTextContent("쿠팡");
  });

  it("says the accounts read failed rather than claiming there are none", async () => {
    vi.spyOn(api, "getSellerAccountsStrict").mockRejectedValue(new Error("401"));
    render(<ReviewImportPage />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/불러오지 못했어요/));
    expect(screen.queryByText(/먼저 판매 채널 계정을 연결해/)).toBeNull();
  });
});
