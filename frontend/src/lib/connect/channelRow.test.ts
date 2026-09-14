import { describe, expect, it } from "vitest";
import { channelRowOf, type ChannelRowInput } from "./channelRow";
import type { ConnectionState } from "../connectionState";

const API: Record<string, ConnectionState> = {
  none: { key: "NEEDS_CONNECT", label: "연결 필요", tone: "warn" },
  pending: { key: "PENDING", label: "연결 중", tone: "warn" },
  connected: { key: "CONNECTED", label: "연결됨", tone: "good" },
  reconnect: { key: "RECONNECT", label: "재연결 필요", tone: "bad" },
  error: { key: "ERROR", label: "오류", tone: "bad" },
};

function row(over: Partial<ChannelRowInput> = {}) {
  return channelRowOf({
    api: API.pending!,
    screenReadReviews: true,
    reviewReadiness: "READY",
    lastScreenReadAt: "2026-09-14T12:00:00Z",
    hasAccount: true,
    ...over,
  });
}

describe("채널 행 — 한 capability가 죽어 있다고 채널 전체를 미완성으로 부르지 않는다", () => {
  it("브라우저 수집이 살아 있으면 행은 그것을 말한다 — 「연결 중」도, 「수집 이력 없음」도, 「연결 계속하기」도 아니다", () => {
    // 실측된 그 행: 상품평 9건을 가져온 계정인데 API 자격이 없어 PENDING이었다.
    const v = row();
    expect(v.state?.label).toBe("연결됨");
    expect(v.reviewLine).toBe("리뷰 수집 · 마지막 수집");
    expect(v.showApiCollectionLine).toBe(false);
    expect(v.primary).toEqual({ kind: "MANAGE", label: "관리" });
  });

  it("가져온 적이 없으면 시각을 지어내지 않는다", () => {
    const v = row({ lastScreenReadAt: null });
    expect(v.reviewLine).toBe("리뷰 수집 · 연결됨");
  });

  it("API lane이 스스로 할 말이 있으면 그 단어를 지우지 않는다", () => {
    for (const api of [API.connected!, API.reconnect!, API.error!]) {
      const v = row({ api });
      // 행의 단어는 API lane의 것으로 남고(그것도 참이다), 리뷰 lane은 자기 줄을 갖는다.
      expect(v.state).toBeNull();
      expect(v.reviewLine).not.toBeNull();
      expect(v.showApiCollectionLine).toBe(true);
      expect(v.primary).toEqual({ kind: "DEFER" });
    }
  });

  it("어느 lane도 서 있지 않으면 다음 걸음은 키 발급이 아니라 상품평 수집 연결이다", () => {
    const v = row({ reviewReadiness: "HELPER_NOT_LINKED", api: API.pending!, lastScreenReadAt: null });
    expect(v.state?.label).toBe("연결 필요");
    expect(v.primary).toEqual({ kind: "REVIEW_SETUP", label: "리뷰 수집 연결하기" });
  });

  it("계정이 아직 없는 판매자에게도 같은 걸음을 내민다 — 계정은 그 press가 만든다", () => {
    const v = row({ hasAccount: false, reviewReadiness: null, api: API.none!, lastScreenReadAt: null });
    expect(v.primary).toEqual({ kind: "REVIEW_SETUP", label: "리뷰 수집 연결하기" });
    // 계정도 수집도 없는 채널에 「수집 이력 없음」은 사실이지만 할 일을 말해 주지 않는다.
    expect(v.showApiCollectionLine).toBe(false);
  });

  it("브라우저 수집이 준비 안 됐고 API가 서 있으면 그 행은 API lane의 것이다", () => {
    const v = row({ reviewReadiness: "STORE_IDENTITY_UNKNOWN", api: API.connected! });
    expect(v.state).toBeNull();
    expect(v.primary).toEqual({ kind: "DEFER" });
    expect(v.showApiCollectionLine).toBe(true);
  });

  it("화면 수집이 없는 채널의 행은 한 글자도 바뀌지 않는다", () => {
    const v = row({ screenReadReviews: false, reviewReadiness: null });
    expect(v).toEqual({ state: null, reviewLine: null, showApiCollectionLine: true, primary: { kind: "DEFER" } });
  });

  it("준비 상태를 읽지 못한 계정은 아무것도 주장하지 않는다", () => {
    const v = row({ reviewReadiness: null, api: API.pending!, lastScreenReadAt: null });
    // 읽지 못한 것은 「준비됨」이 아니다 — 행은 셋업을 내밀되 연결됐다고 말하지 않는다.
    expect(v.state?.label).toBe("연결 필요");
    expect(v.reviewLine).toBeNull();
  });
});
