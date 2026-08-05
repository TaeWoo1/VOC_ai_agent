import { describe, expect, it } from "vitest";
import { channelCardAction, selectChannelAccount } from "./channelConnection";
import type { ChannelStatus, SellerAccountResponse } from "./types";

const cafe24 = { code: "CAFE24", status: "AVAILABLE" as ChannelStatus, actionLabel: "연결하기" };
const naver = { code: "NAVER", status: "AVAILABLE" as ChannelStatus, actionLabel: "연결하기" };
const fileChan = {
  code: "FILE_UPLOAD",
  status: "FILE_UPLOAD_SUPPORTED" as ChannelStatus,
  actionLabel: "파일 업로드",
};

const acc = (over: Partial<SellerAccountResponse> = {}): SellerAccountResponse => ({
  id: "acc-1",
  channelId: "ch-1",
  channelNameKo: "카페24",
  alias: null,
  connectionStatus: "CONNECTED",
  lastSyncedAt: null,
  fileUpload: false,
  ...over,
});

describe("channelCardAction — driven by real account status", () => {
  it("no Cafe24 account → 연결하기 (start OAuth)", () => {
    expect(channelCardAction(cafe24, null, false, false)).toEqual({
      label: "연결하기",
      intent: "connect-cafe24",
      disabled: false,
    });
  });

  it("PENDING → 연결 계속하기, enabled, routes through the OAuth flow (resume a stale attempt)", () => {
    const a = channelCardAction(cafe24, acc({ connectionStatus: "PENDING" }), false, false);
    expect(a).toEqual({ label: "연결 계속하기", intent: "reconnect", disabled: false });
    // "reconnect" is the intent Channels.tsx routes to /connect/cafe24, reusing the account.
    expect(a.disabled).toBe(false);
  });

  it("PENDING on a non-Cafe24 account → manage (no Cafe24 OAuth route)", () => {
    const a = channelCardAction(naver, acc({ connectionStatus: "PENDING" }), false, false);
    expect(a.label).toBe("연결 계속하기");
    expect(a.intent).toBe("manage");
    expect(a.disabled).toBe(false);
  });

  it("RECONNECT_REQUIRED (Cafe24) → 다시 연결하기 through the OAuth flow", () => {
    expect(
      channelCardAction(cafe24, acc({ connectionStatus: "RECONNECT_REQUIRED" }), false, false),
    ).toEqual({ label: "다시 연결하기", intent: "reconnect", disabled: false });
  });

  it("RECONNECT_REQUIRED (non-Cafe24) → manage (no Cafe24 OAuth route)", () => {
    const a = channelCardAction(naver, acc({ connectionStatus: "RECONNECT_REQUIRED" }), false, false);
    expect(a.label).toBe("다시 연결하기");
    expect(a.intent).toBe("manage");
  });

  it("CONNECTED → 연결 관리", () => {
    expect(channelCardAction(cafe24, acc({ connectionStatus: "CONNECTED" }), false, false)).toEqual({
      label: "연결 관리",
      intent: "manage",
      disabled: false,
    });
  });

  it("CONNECTED but collection failing → 재연결·테스트 (still manage, not an OAuth reconnect)", () => {
    expect(channelCardAction(cafe24, acc({ connectionStatus: "CONNECTED" }), false, true)).toEqual({
      label: "재연결·테스트",
      intent: "manage",
      disabled: false,
    });
  });

  it("connection state comes from the account, never the channel catalog status", () => {
    // Catalog says AVAILABLE, but the real account is RECONNECT_REQUIRED → reconnect wins.
    expect(
      channelCardAction(cafe24, acc({ connectionStatus: "RECONNECT_REQUIRED" }), false, false).label,
    ).toBe("다시 연결하기");
  });

  it("no account: upload channel → upload; NAVER → guided wizard; PREPARING → disabled", () => {
    expect(channelCardAction(fileChan, null, true, false).intent).toBe("upload");
    // First-time NAVER routes to the guided-connection wizard, not a passive notice.
    expect(channelCardAction(naver, null, false, false).intent).toBe("connect-naver");
    expect(channelCardAction({ ...naver, status: "PREPARING" }, null, false, false).disabled).toBe(
      true,
    );
  });

  it("no Coupang account → connect-coupang (the Coupang connection setup surface)", () => {
    const coupang = { code: "COUPANG", status: "AVAILABLE" as ChannelStatus, actionLabel: "연결하기" };
    expect(channelCardAction(coupang, null, false, false)).toEqual({
      label: "연결하기",
      intent: "connect-coupang",
      disabled: false,
    });
    // PREPARING disables the button like the other channels.
    expect(
      channelCardAction({ ...coupang, status: "PREPARING" }, null, false, false).disabled,
    ).toBe(true);
  });
});

describe("selectChannelAccount — picks the real API-mode connection", () => {
  it("null / no-match → null", () => {
    expect(selectChannelAccount(null, "ch-1")).toBeNull();
    expect(selectChannelAccount([acc({ channelId: "other" })], "ch-1")).toBeNull();
  });

  it("returns the API-mode account for the channel", () => {
    const a = acc({ id: "api-1", channelId: "ch-1", fileUpload: false });
    expect(selectChannelAccount([a], "ch-1")).toBe(a);
  });

  it("ignores a file-upload row and picks the API row (multiple-account edge)", () => {
    const file = acc({ id: "file-1", channelId: "ch-1", fileUpload: true });
    const api = acc({
      id: "api-1",
      channelId: "ch-1",
      fileUpload: false,
      connectionStatus: "RECONNECT_REQUIRED",
    });
    const chosen = selectChannelAccount([file, api], "ch-1");
    expect(chosen?.id).toBe("api-1");
    expect(chosen?.connectionStatus).toBe("RECONNECT_REQUIRED");
  });

  it("only a file-upload account → null (no API connection)", () => {
    expect(selectChannelAccount([acc({ channelId: "ch-1", fileUpload: true })], "ch-1")).toBeNull();
  });

  it("multiple API accounts → deterministic first; scoped to the channel id", () => {
    const a1 = acc({ id: "api-1", channelId: "ch-1" });
    const a2 = acc({ id: "api-2", channelId: "ch-1" });
    const other = acc({ id: "api-3", channelId: "ch-2" });
    expect(selectChannelAccount([a1, a2, other], "ch-1")?.id).toBe("api-1");
    expect(selectChannelAccount([a1, a2, other], "ch-2")?.id).toBe("api-3");
  });
});
