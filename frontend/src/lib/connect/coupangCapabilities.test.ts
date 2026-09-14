import { describe, expect, it } from "vitest";
import { apiCardOf, reviewCardOf, reviewCollectionPath } from "./coupangCapabilities";
import type { ChannelCapabilityOverview, ConnectionInfoView, ConnectionStatusView } from "../types";

const overview = (autoCollectSupported: boolean): ChannelCapabilityOverview => ({
  channelCode: "COUPANG",
  channelNameKo: "쿠팡",
  connectorClass: "API",
  autoCollectSupported,
  dataTypes: [],
  unsupportedScopes: [],
});

const info = { authType: "API_KEY" } as unknown as ConnectionInfoView;
const status = (state: string) => ({ state, consecutiveFailures: 0 }) as unknown as ConnectionStatusView;

describe("리뷰 수집 카드", () => {
  it("읽기 전에는 상태를 주장하지도, 무엇을 할 수 있다고 약속하지도 않는다", () => {
    const card = reviewCardOf(null);
    expect(card?.status.label).toBe("확인 중");
    expect(card?.primaryLabel).toBeNull();
  });

  it("이 방식이 없는 계정에는 카드가 없다", () => {
    expect(reviewCardOf({ state: "CHANNEL_NOT_SUPPORTED", channelCode: "NAVER" })).toBeNull();
    expect(reviewCardOf({ state: "FILE_UPLOAD_ACCOUNT", channelCode: "COUPANG" })).toBeNull();
  });

  it("준비된 계정의 다음 걸음은 수집이다", () => {
    const card = reviewCardOf({ state: "READY", channelCode: "COUPANG" });
    expect(card).toEqual({ status: { tone: "good", label: "연결됨" }, kind: "READY", primaryLabel: "지금 가져오기" });
  });

  it("도우미가 없든 스토어를 모르든, 카드가 내미는 다음 걸음은 하나다", () => {
    // 둘을 구별해 말하면 판매자는 두 가지 문제를 배우지만, 할 일은 어느 쪽이든 같다 — 셋업을 시작하는 것.
    for (const state of ["HELPER_NOT_LINKED", "STORE_IDENTITY_UNKNOWN"] as const) {
      expect(reviewCardOf({ state, channelCode: "COUPANG" })?.primaryLabel).toBe("리뷰 수집 연결하기");
    }
  });
});

describe("문의·주문 자동 수집 카드 — 돌지 않는 것은 설정하게 하지 않는다", () => {
  it("커넥터가 해석되지 않는 배포에는 카드도 자격 폼도 없다", () => {
    expect(apiCardOf(overview(false), null, null)).toBeNull();
  });

  it("확인하지 못했으면 권하지 않는다", () => {
    expect(apiCardOf(null, info, status("CONNECTED"))).toBeNull();
  });

  it("자격이 없으면 연결이 다음 걸음이다", () => {
    expect(apiCardOf(overview(true), null, null)).toMatchObject({ kind: "SETUP", primaryLabel: "API 연결하기" });
  });

  it("만료·끊김은 다시 연결이고, 그것은 처음 연결과 다른 문장이다", () => {
    for (const state of ["EXPIRED", "NEEDS_REAUTH", "DISCONNECTED"]) {
      expect(apiCardOf(overview(true), info, status(state))).toMatchObject({
        kind: "REAUTH",
        primaryLabel: "연결 정보 갱신",
      });
    }
  });

  it("살아 있는 연결의 다음 걸음은 수집이다", () => {
    expect(apiCardOf(overview(true), info, status("CONNECTED"))).toMatchObject({
      kind: "READY",
      primaryLabel: "지금 가져오기",
    });
  });
});

describe("경로", () => {
  it("카드와 라우트가 같은 한 정의를 쓴다", () => {
    expect(reviewCollectionPath("acc-1")).toBe("/connect/channels/acc-1/review-collection");
  });
});
