import type { ConnectionState } from "../connectionState";
import type { ScreenReadReadinessState } from "../acquisitionReadiness";

/**
 * <b>한 채널 행이 무엇을 말하는가 — capability의 사실로.</b>
 *
 * <p>이 행은 오랫동안 <b>API 연결 하나</b>만 읽었다(`connectionStatus`와 그 연결의 `lastSyncedAt`). 브라우저
 * 상품평 수집은 그 둘 중 어느 것도 쓰지 않으므로, 상품평 9건을 방금 가져온 판매자의 행이 이렇게 보였다
 * (실측 2026-09-14):
 *
 * <pre>쿠팡 · 연결 중 · 수집 이력 없음 · 상품평 9개 보기 · [연결 계속하기]</pre>
 *
 * <p>진행 중인 것은 없고, 20분 전에 9건을 수집했고, primary는 판매자를 API 키 화면으로 돌려보낸다 — 그리고
 * 바로 옆의 「상품평 9개 보기」가 같은 행을 반박한다. <b>한 capability가 죽어 있다고 채널 전체를 미완성으로
 * 부르지 않는다</b>(product-owner decision, First External Seller Gate).
 *
 * <p>순수 함수다. 읽기도 렌더도 하지 않고, 두 lane의 사실을 받아 행이 말할 것을 정한다.
 */

/** 이 행이 아는 두 lane의 사실. */
export interface ChannelRowInput {
  /** API 연결에서 파생된 상태(기존 `connectionState`). */
  api: ConnectionState;
  /** 이 채널의 리뷰가 판매자 화면에서 오는가 — 채널 사실(계정이 없어도 참일 수 있다). */
  screenReadReviews: boolean;
  /** 이 계정의 브라우저 수집 준비 상태. `null` = 계정이 없거나 아직 읽지 못했다. */
  reviewReadiness: ScreenReadReadinessState | null;
  /** 화면 수집의 마지막 성공 시각(ISO). `null`이면 그 사실을 말하지 않는다. */
  lastScreenReadAt: string | null;
  /** 이 org에 이 채널의 계정 행이 있는가. */
  hasAccount: boolean;
}

export type ChannelRowPrimary =
  /** 채널 관리 화면으로. 이미 쓸 수 있는 채널의 다음 걸음은 「고치기」가 아니라 「보기」다. */
  | { kind: "MANAGE"; label: string }
  /** 브라우저 상품평 수집을 시작한다 — 계정이 없으면 만들고 나서. */
  | { kind: "REVIEW_SETUP"; label: string }
  /** 이 행이 스스로 정하지 않는다: 기존 `channelCardAction`이 답한다. */
  | { kind: "DEFER" };

export interface ChannelRowView {
  /** 행의 한 단어. `null`이면 기존 `connectionState`의 단어를 쓴다. */
  state: ConnectionState | null;
  /** 리뷰 lane에 대한 한 줄. `null`이면 렌더하지 않는다. */
  reviewLine: string | null;
  /**
   * API lane의 「마지막 수집 …/수집 이력 없음」 줄을 그려도 되는가.
   *
   * <b>false가 되는 경우는 하나다</b> — 브라우저 lane이 살아 있고 API lane은 연결된 적이 없을 때. 그때 그
   * 줄은 아무 lane에 대해서도 참이 아니면서 채널 전체를 「수집 이력 없음」이라고 부른다.
   */
  showApiCollectionLine: boolean;
  primary: ChannelRowPrimary;
}

const REVIEW_LANE_READY: ConnectionState = { key: "CONNECTED", label: "연결됨", tone: "good" };
const REVIEW_LANE_SETUP: ConnectionState = { key: "NEEDS_CONNECT", label: "연결 필요", tone: "warn" };

/** API lane이 실제로 서 있는가 — 「연결됨」이거나 고칠 것이 있는 상태(둘 다 그 lane에 대한 참이다). */
function apiLaneStands(api: ConnectionState): boolean {
  return api.key === "CONNECTED" || api.key === "RECONNECT" || api.key === "ERROR";
}

/**
 * 두 lane의 사실 → 한 행.
 *
 * 순서가 규칙이다. 브라우저 lane이 <b>쓸 수 있으면</b> 그것이 이 채널에 대한 참이고, API lane이 꺼져 있다는
 * 사실이 그것을 덮지 못한다. 브라우저 lane이 아직 준비되지 않았고 API lane도 서 있지 않으면, 판매자에게
 * 필요한 다음 걸음은 <b>키 발급이 아니라 상품평 수집 연결</b>이다.
 */
export function channelRowOf(input: ChannelRowInput): ChannelRowView {
  const { api, screenReadReviews, reviewReadiness, lastScreenReadAt, hasAccount } = input;
  if (!screenReadReviews) {
    return { state: null, reviewLine: null, showApiCollectionLine: true, primary: { kind: "DEFER" } };
  }

  if (reviewReadiness === "READY") {
    return {
      // API lane이 스스로 할 말이 있으면(연결됨·재연결 필요·오류) 그 단어를 지우지 않는다 — 그것도 참이다.
      state: apiLaneStands(api) ? null : REVIEW_LANE_READY,
      reviewLine: lastScreenReadAt ? "리뷰 수집 · 마지막 수집" : "리뷰 수집 · 연결됨",
      showApiCollectionLine: apiLaneStands(api),
      primary: apiLaneStands(api) ? { kind: "DEFER" } : { kind: "MANAGE", label: "관리" },
    };
  }

  // 브라우저 lane이 아직 준비되지 않았다. API lane이 서 있으면 그 행은 그 lane의 것이다.
  if (apiLaneStands(api)) {
    return { state: null, reviewLine: null, showApiCollectionLine: true, primary: { kind: "DEFER" } };
  }

  // 어느 lane도 서 있지 않다: 이 채널에서 판매자가 가장 먼저 할 수 있는 일은 상품평 수집 연결이다.
  // 계정이 없어도 마찬가지다 — 계정은 그 press가 만든다(자격은 받지 않는다).
  return {
    state: REVIEW_LANE_SETUP,
    reviewLine: null,
    // 계정도 없고 수집한 적도 없는 채널에 「수집 이력 없음」은 사실이지만 할 일을 말해 주지 않는다.
    showApiCollectionLine: hasAccount,
    primary: { kind: "REVIEW_SETUP", label: "리뷰 수집 연결하기" },
  };
}
