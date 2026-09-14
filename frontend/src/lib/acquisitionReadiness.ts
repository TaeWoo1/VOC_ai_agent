/**
 * <b>이 계정이 화면에서 상품평을 가져올 수 있는가 — backend의 닫힌 토큰.</b>
 *
 * 세 가지 독립된 사실 중 <b>계정의 것</b>이고, 나머지 둘은 다른 곳이 답한다: 이 PC의 도우미는
 * {@link import("./helper/helperStatus").HelperState}가, 마켓플레이스 로그인은 <b>아무도</b> —
 * 그것을 묻는 데는 판매자의 세션으로 마켓플레이스를 읽는 비용이 들고, 화면을 꾸미려고 그 비용을 쓰지
 * 않는다. run이 직접 만나 자기 실패 단어로 보고한다.
 *
 * <b>이 토큰이 문장이 되는 곳은 하나다</b> — `lib/connect/reviewCollection.ts`. 예전에는 이 파일이
 * 자기 문장표를 들고 있었고, 그 문장들은 채널 화면에서 run 패널·확인 카드의 문장과 나란히 서서 같은
 * 사실을 세 가지 말투로 말했다(라이브 2026-09-14). 표를 옮긴 것이 그 세 겹을 끝낸 방법이다.
 */
export type ScreenReadReadinessState =
  | "READY"
  | "CHANNEL_NOT_SUPPORTED"
  | "FILE_UPLOAD_ACCOUNT"
  | "HELPER_NOT_LINKED"
  | "STORE_IDENTITY_UNKNOWN";

export interface AcquisitionReadinessView {
  state: ScreenReadReadinessState;
  channelCode: string;
}
