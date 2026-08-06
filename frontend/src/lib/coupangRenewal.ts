// Coupang guided-renewal — pure state engine (no React, no api, no I/O).
//
// Entered from an ALREADY-CONNECTED Coupang account whose credential is expiring. It drives the renewal
// UI: a guided WING walkthrough (highlight 유효기간 + 재발급, human checkpoint before 재발급) — or the
// agent-free manual text path — hands off to a masked credential REPLACE form, which calls the backend's
// atomic replace endpoint; on success the connection is re-verified and the flow is done (the existing
// account / orders / cursor are KEPT — the FE creates no new account), on failure the old credential is
// preserved (backend rollback) and a safe reason lets the operator retry.
//
// This engine owns ONLY the renewal sub-flow phase; the guided/manual sub-mode lives inside the
// walkthrough component (like issuance), and the secrets never enter this reducer — they flow straight
// from the form to the replace endpoint.

/** The renewal engine phase. */
export type CoupangRenewalPhase =
  | "guide" // the guided WING renewal walkthrough (or the agent-free text path)
  | "replace" // the masked credential REPLACE form (new secrets + confirmed expiry date)
  | "replacing" // the replace endpoint call is in flight
  | "done" // replace SUCCEEDED and the connection re-verified — account/orders kept
  | "replace_error"; // replace FAILED (old credential kept via backend rollback) — retry / re-enter

export interface CoupangRenewalState {
  phase: CoupangRenewalPhase;
  /** The replace endpoint's safe reason code (replace_error only). null = no known reason. */
  reasonCode: string | null;
}

export type CoupangRenewalEvent =
  | { type: "WALKTHROUGH_DONE" } // guided walk finished, or "이미 새 키가 있어요" (guide → replace)
  | { type: "SUBMIT" } // the replace form was submitted (→ replacing)
  | { type: "REPLACE_RESULT"; status: "SUCCESS" | "FAILED"; reasonCode: string | null }
  | { type: "REENTER" }; // re-open the replace form from the error screen (→ replace)

/** A guided renewal always starts at the walkthrough. */
export const INITIAL_COUPANG_RENEWAL_STATE: CoupangRenewalState = { phase: "guide", reasonCode: null };

/** Pure reducer. Ignores events that do not apply to the current phase (fail-safe, no throw). */
export function coupangRenewalReducer(
  state: CoupangRenewalState,
  event: CoupangRenewalEvent,
): CoupangRenewalState {
  switch (event.type) {
    case "WALKTHROUGH_DONE":
      if (state.phase !== "guide") return state;
      return { phase: "replace", reasonCode: null };

    case "SUBMIT":
      if (state.phase !== "replace" && state.phase !== "replace_error") return state;
      return { phase: "replacing", reasonCode: null };

    case "REPLACE_RESULT":
      if (state.phase !== "replacing") return state;
      return event.status === "SUCCESS"
        ? { phase: "done", reasonCode: null }
        : { phase: "replace_error", reasonCode: event.reasonCode };

    case "REENTER":
      if (state.phase !== "replace_error") return state;
      return { phase: "replace", reasonCode: null };

    default:
      return state;
  }
}

/** Static copy for the renewal surface (all seller-facing, Korean). The guided/manual walkthrough copy is
 *  the FE-owned `actionWindow.coupangRenewal.*` registry in `lib/actionWindow/copy.ts`; this is the copy
 *  the renewal PAGE (form / result / done) owns. */
export const COUPANG_RENEWAL_COPY = {
  pageTitle: "쿠팡 API 키 갱신",
  pageIntro:
    "현재 연결된 쿠팡 키의 유효기간이 다가오고 있어요. 쿠팡 윙에서 키를 재발급한 뒤, 새 키로 교체하면 주문 연동이 끊기지 않고 이어집니다. 기존 주문과 수집 기록은 그대로 유지됩니다.",
  loadError: "갱신 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.",
  back: "돌아가기",

  // guide phase
  guideIntro:
    "쿠팡 윙에서 새 키를 재발급하도록 화면으로 안내해 드릴게요. 재발급 버튼은 반드시 직접 누르시면 됩니다.",

  // replace phase — the masked credential form
  replaceTitle: "새 키로 교체",
  replaceBody:
    "재발급한 액세스 키·시크릿 키·업체 코드를 입력하면 기존 키를 안전하게 교체합니다. 교체에 실패하면 기존 키가 그대로 유지돼요 — 연결이 끊기지 않습니다.",
  replaceHeading: "새 쿠팡 Open API 키 입력",
  replaceSubmitting: "교체하는 중…",

  // expiry-date confirmation (operator-confirm; never auto-estimated)
  expiryConfirmTitle: "새 키의 만료일 확인",
  expiryConfirmBody:
    "재발급 화면에 표시된 새 키의 유효기간(만료일)을 확인해 그대로 입력해 주세요. SellerOps는 만료일을 임의로 추정하지 않습니다.",
  expiryConfirmLabel: "만료일을 확인해 입력",
  expiryConfirmOptional: "만료일을 아직 확인하지 못했다면 비워 두어도 교체는 진행됩니다.",

  // replacing / result
  replacingBody: "새 키로 연결을 확인하는 중이에요…",
  doneTitle: "키 교체가 완료됐어요",
  doneBody:
    "새 키로 연결이 확인됐습니다. 기존 주문과 수집 기록은 그대로 유지되고, 주문 연동이 이어집니다.",
  doneCta: "연결 상태 보기",

  // replace error
  errorRetryCta: "다시 교체",
  errorReenterCta: "키 다시 입력",
} as const;
