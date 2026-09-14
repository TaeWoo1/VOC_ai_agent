import type { HelperState } from "./helper/helperStatus";

/**
 * <b>Can this seller press 지금 동기화 right now, and if not, what is the one thing to do.</b>
 *
 * There are three independent facts behind that question and they fail in different places, so this
 * module keeps them apart and joins them in one order:
 *
 *  1. **the account** — `ScreenReadReadiness` from the backend: does this channel have a screen-read
 *     path at all, is this an account with a marketplace session, has a helper ever been linked to it;
 *  2. **the machine** — whether the 도우미 is installed, running and paired, which only the seller's own
 *     browser can answer and which {@link HelperState} already answers for the 도우미 card;
 *  3. **the marketplace login** — which nobody can answer without reading the marketplace.
 *
 * **(3) is deliberately never guessed.** Asking it costs a marketplace request, and a panel that spent
 * one every time a page rendered would be using the seller's session to decorate a screen. So this
 * module never claims the run will succeed: the strongest thing it says is 시작할 수 있습니다, the panel
 * says in plain words what must be open before pressing, and a login that is missing is discovered by
 * the run and reported as its own closed failure word. Fail closed, never bypassed.
 *
 * The account state is the backend's closed token and this is the only place it becomes a sentence —
 * the same posture `helperStatus.ts` takes for the helper and `CollectionHistorySection` takes for the
 * failure words. No provider, carrier, port or token word appears here or may.
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

/** What the panel may do, and what it says while it cannot do it. */
export interface AcquisitionReadiness {
  /** Whether 지금 동기화 may be pressed at all. */
  canStart: boolean;
  /** The blocking sentence, or null when nothing blocks. */
  blockedKo: string | null;
  /** Where the seller goes to unblock it, or null when the sentence is the whole answer. */
  action: { to: string; label: string } | null;
}

const ACCOUNT_BLOCKERS: Record<Exclude<ScreenReadReadinessState, "READY">, string> = {
  // Not a failure — a statement about the channel. Cafe24 has an API and NAVER's reviews arrive as an
  // export the seller downloads; neither has a screen to read here.
  CHANNEL_NOT_SUPPORTED: "이 채널은 화면에서 상품평을 가져오는 방식이 아닙니다.",
  FILE_UPLOAD_ACCOUNT: "파일로 올린 계정에는 읽어올 판매자 화면이 없습니다.",
  HELPER_NOT_LINKED: "이 판매 계정이 아직 내 PC의 도우미와 연결되지 않았습니다.",
  // Ours, not theirs. Live on 2026-09-14 this arrived mid-run as 「어느 판매자 계정인지 확인하지
  // 못했어요 … 판매자 화면이 정상적으로 열려 있는지 확인한 뒤 다시 시도해 주세요」 — while the seller's
  // screen was open and its store label was read successfully. The missing half was our record of
  // which store this account is.
  //
  // It names the missing FACT, not a place to go and get it. It used to send the seller to the Coupang
  // OpenAPI wizard, because the vendor code could only be told to us inside a credential form — the
  // requirement this package removed. The next step is now the field under this sentence.
  STORE_IDENTITY_UNKNOWN:
    "어느 스토어인지 아직 알려주지 않으셔서, 화면에 열린 스토어가 이 계정의 것인지 대조할 수 없습니다.",
};

/**
 * Join the two answerable facts.
 *
 * **The account is asked first, and that order is the point.** A seller whose channel has no screen read
 * at all should not be sent to install a 도우미 that would change nothing — the helper is a precondition
 * of a capability this account does not have. `null` readiness means the read has not answered yet, and
 * an unanswered read blocks the press rather than permitting it: a button that fails is worse than one
 * that is briefly disabled.
 */
export function acquisitionReadinessOf(
  readiness: AcquisitionReadinessView | null,
  helper: HelperState | null,
): AcquisitionReadiness {
  if (!readiness || !helper) {
    return { canStart: false, blockedKo: null, action: null };
  }
  if (readiness.state !== "READY") {
    return {
      canStart: false,
      blockedKo: ACCOUNT_BLOCKERS[readiness.state],
      // The only one of the three the seller can act on from here. The other two are facts about the
      // channel and the account, and offering a next step for them would be offering a way to change
      // something that is not changeable.
      // STORE_IDENTITY_UNKNOWN deliberately has none: the field that answers it is drawn directly under
      // this sentence, and a button beside it would be a second way to do the same thing — pointing, in
      // the old case, at an API-key wizard the seller does not need.
      action:
        readiness.state === "HELPER_NOT_LINKED"
          ? { to: "/connect/helper", label: "도우미 연결하기" }
          : null,
    };
  }
  if (helper.key !== "CONNECTED") {
    return {
      canStart: false,
      // **Not the helper's diagnosis again.** The card that owns it is drawn directly above with its
      // own word, its own sentence and its own next step; repeating them here put the same sentence on
      // screen twice and offered a second button to the same page. What this line adds is the only
      // thing the card cannot say — that this is what the press is waiting on.
      blockedKo: "도우미가 준비되면 지금 동기화를 시작할 수 있습니다.",
      action: null,
    };
  }
  return { canStart: true, blockedKo: null, action: null };
}
