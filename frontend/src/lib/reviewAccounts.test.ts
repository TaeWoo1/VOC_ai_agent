import { describe, expect, it } from "vitest";
import { reviewAccounts } from "./reviewAccounts";
import type { ChannelResponse, SellerAccountResponse } from "./types";

function channel(id: string, code: string, nameKo: string): ChannelResponse {
  return {
    id,
    code,
    nameKo,
    status: "AVAILABLE",
    dataBadges: [],
    lastSyncedAt: null,
    actionLabel: "연결하기",
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

function account(id: string, channelId: string, over: Partial<SellerAccountResponse> = {}): SellerAccountResponse {
  return {
    id,
    channelId,
    channelNameKo: "",
    alias: null,
    connectionStatus: "CONNECTED",
    lastSyncedAt: null,
    fileUpload: false,
    ...over,
  };
}

const CHANNELS = [
  channel("cp", "COUPANG", "쿠팡"),
  channel("nv", "NAVER", "네이버 스마트스토어"),
  channel("c24", "CAFE24", "카페24 자사몰"),
  channel("gm", "GMARKET", "G마켓/옥션"),
];

describe("reviewAccounts — the accounts the 리뷰 surface can open", () => {
  it("keeps product channels with a review record, in product order (NAVER, COUPANG, CAFE24)", () => {
    const out = reviewAccounts(
      [account("a-cp", "cp"), account("a-c24", "c24"), account("a-nv", "nv"), account("a-gm", "gm")],
      CHANNELS,
    );
    expect(out.map((r) => r.account.id)).toEqual(["a-nv", "a-cp", "a-c24"]);
    expect(out.map((r) => r.label)).toEqual(["네이버 스마트스토어", "쿠팡", "카페24 자사몰"]);
  });

  it("includes file-upload accounts — a review export lands on one", () => {
    const out = reviewAccounts([account("a-nv", "nv", { fileUpload: true })], CHANNELS);
    expect(out.map((r) => r.account.id)).toEqual(["a-nv"]);
  });

  it("disambiguates by alias only when one channel has several accounts", () => {
    const out = reviewAccounts(
      [account("a1", "nv", { alias: "본점" }), account("a2", "nv", { alias: "2호점" })],
      CHANNELS,
    );
    expect(out.map((r) => r.label)).toEqual(["네이버 스마트스토어 · 본점", "네이버 스마트스토어 · 2호점"]);
  });

  it("is empty until both reads have landed", () => {
    expect(reviewAccounts(null, CHANNELS)).toEqual([]);
    expect(reviewAccounts([account("a", "nv")], null)).toEqual([]);
  });
});
