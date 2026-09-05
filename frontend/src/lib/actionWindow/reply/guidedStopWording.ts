/**
 * **What the seller is told when a guided reply run stops.**
 *
 * One sentence per blocker code, and each one names the repair the seller can actually perform. The code
 * itself never reaches the screen — `TARGET_NOT_FOUND` is our word for a locate that matched nothing, and
 * printing it would be handing the seller our vocabulary and calling it an explanation.
 *
 * The `TARGET_NOT_FOUND` sentence is the reason this file exists (live, 2026-09-05). A run swept the seller
 * center's review list to the end and matched nothing, because the list was showing a recent period and the
 * review was eight days old. "찾지 못했습니다" alone would say the review is gone, which is false, and would
 * leave the seller with nothing to do; what is true is that the list has to be showing that review's date.
 */
import type { ReplyBlockerCode } from "./replyRuntime";

/**
 * The sentence for one stop. `reviewDate` is the review's own KST date when the surface has it — naming it
 * turns "widen the period" into an instruction with a number in it.
 */
export function guidedStopSentence(code: ReplyBlockerCode | null, reviewDate?: string | null): string {
  switch (code) {
    case "TARGET_NOT_FOUND":
      return reviewDate != null
        ? `네이버 리뷰 목록에서 이 리뷰를 찾지 못했어요. 목록의 조회 기간에 이 리뷰의 작성일(${reviewDate})이 포함되도록 바꾼 뒤 다시 시도해 주세요.`
        : "네이버 리뷰 목록에서 이 리뷰를 찾지 못했어요. 목록의 조회 기간에 이 리뷰의 작성일이 포함되도록 바꾼 뒤 다시 시도해 주세요.";
    case "TARGET_AMBIGUOUS":
      return "화면에서 이 리뷰 하나만 고르지 못했어요. 네이버에서 직접 답변해 주세요.";
    case "LOGIN_REQUIRED":
      return "네이버 로그인이 필요해요. 열린 창에서 로그인한 뒤 다시 시도해 주세요.";
    case "SESSION_EXPIRED":
      return "네이버 로그인이 만료됐어요. 열린 창에서 다시 로그인한 뒤 시도해 주세요.";
    case "UNSUPPORTED_STATE":
      return "네이버 리뷰 목록 화면을 인식하지 못했어요. 판매자센터에서 리뷰 목록을 연 뒤 다시 시도해 주세요.";
    case "RUNTIME_FAULT":
      return "안내를 계속하지 못했어요. 다시 시도해 주세요.";
    default:
      // A stop we have no sentence for is still a stop: say that much, and never say nothing.
      return "안내가 중단됐어요. 다시 시도해 주세요.";
  }
}

/**
 * What the seller is told when the guided run is not on offer at all — as opposed to
 * {@link guidedStopSentence}, which explains a run that started and stopped.
 *
 * Both sentences name the next thing the seller can do, because both situations leave them holding an
 * approved reply. Neither prints the server's token, and neither uses the vocabulary the server decided
 * it with: a seller does not have to know what "provenance" is to understand that reviewnary can guide
 * the reviews it collected and not the ones it did not.
 */
export function guidedUnavailableSentence(reason: string | null | undefined): string | null {
  switch (reason) {
    case "SOURCE_NOT_EXECUTABLE":
      return "이 리뷰는 판매자센터 화면에서 찾아 드릴 수 없어요. 채널 연동으로 가져온 리뷰만 안내할 수 있습니다. 아래 답변을 복사해 판매자센터에서 직접 등록해 주세요.";
    case "CHANNEL_ALREADY_ANSWERED":
      // The screen's own long-standing sentence, moved here unchanged: the words were right, and the
      // only thing wrong was that the client re-derived the RULE behind them from `channelReplyState`.
      return "채널에 이미 답변이 등록된 리뷰예요. 같은 리뷰에 답변이 두 번 달리지 않도록 가이드형 답변은 제공하지 않아요.";
    default:
      // An unknown reason is not a sentence we can write. Say nothing rather than guess — the copy
      // control is on screen either way.
      return null;
  }
}
