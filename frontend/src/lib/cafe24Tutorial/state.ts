// Pure state machine + copy for the Cafe24 first-connection tutorial. Kept free of React/DOM
// (except the guarded sessionStorage helpers) so the transitions and the callback/capability
// interpreters are unit-testable in the node-environment Vitest setup. This is a NEW, Cafe24-
// scoped module — it intentionally does NOT extend the ratified NAVER guidedConnection enums.

import type { Cafe24CapabilityView } from "../types";
import type { Cafe24ResultStatus } from "../cafe24Connect";

/** The seven tutorial steps, in order, plus the terminal failure state. */
export type TutorialPhase =
  | "intro"
  | "mall_confirm"
  | "permissions"
  | "consent"
  | "verify"
  | "first_sync"
  | "done"
  | "failed";

/** Fail-closed causes, each with its own retry guidance. */
export type TutorialFailure =
  | "invalid_request" // OAuth state expired or redirect/callback mismatch (backend: invalid)
  | "reconnect_required" // credential/auth could not authorize; also covers decrypt failure
  | "credential_decrypt" // reserved: surfaced as reconnect_required by the backend today
  | "board_mapping" // review/inquiry board mapping mismatch
  | "first_sync_failed" // ORDER_SUMMARY first sync failed
  | "verify_unavailable" // capability endpoint unreachable (flag off / network)
  | "start_failed"; // could not begin the OAuth flow

export interface TutorialState {
  phase: TutorialPhase;
  mallId: string | null;
  accountId: string | null;
  failure: TutorialFailure | null;
  /** A transient provider error on the verify step — retry, do not fail. */
  verifyRetryable: boolean;
  /** Bumped to re-fire the verify effect for an in-place retry (never persisted). */
  verifyNonce: number;
}

export const INITIAL_STATE: TutorialState = {
  phase: "intro",
  mallId: null,
  accountId: null,
  failure: null,
  verifyRetryable: false,
  verifyNonce: 0,
};

/** Ordered steps for the progress rail (the failure state is not a step). */
export const STEP_ORDER: TutorialPhase[] = [
  "intro",
  "mall_confirm",
  "permissions",
  "consent",
  "verify",
  "first_sync",
  "done",
];

export type TutorialEvent =
  | { type: "START" }
  | { type: "MALL_CONFIRMED"; mallId: string }
  | { type: "PERMISSIONS_ACK" }
  | { type: "CONSENT_STARTED"; accountId: string }
  | { type: "CONSENT_START_FAILED" }
  | { type: "CALLBACK"; status: Cafe24ResultStatus; accountId: string | null }
  | { type: "VERIFIED" }
  | { type: "VERIFY_RETRYABLE" }
  | { type: "VERIFY_RETRY" }
  | { type: "VERIFY_FAILED"; failure: TutorialFailure }
  | { type: "SYNC_RESULT"; ok: boolean }
  | { type: "RETRY" }
  | { type: "RESTORE"; state: TutorialState };

/**
 * Total reducer: unmodeled (phase, event) pairs are deliberate no-ops so the flow can never
 * skip a step or advance from a stale event.
 */
export function tutorialReducer(prev: TutorialState, event: TutorialEvent): TutorialState {
  switch (event.type) {
    case "START":
      return prev.phase === "intro" ? { ...prev, phase: "mall_confirm" } : prev;
    case "MALL_CONFIRMED":
      return prev.phase === "mall_confirm"
        ? { ...prev, phase: "permissions", mallId: event.mallId }
        : prev;
    case "PERMISSIONS_ACK":
      return prev.phase === "permissions" ? { ...prev, phase: "consent" } : prev;
    case "CONSENT_STARTED":
      return prev.phase === "consent"
        ? { ...prev, accountId: event.accountId }
        : prev;
    case "CONSENT_START_FAILED":
      return prev.phase === "consent"
        ? { ...prev, phase: "failed", failure: "start_failed" }
        : prev;
    case "CALLBACK": {
      // A callback return can arrive at any point after the flow left for consent.
      if (event.status === "connected") {
        return {
          ...prev,
          phase: "verify",
          accountId: event.accountId ?? prev.accountId,
          failure: null,
          verifyRetryable: false,
        };
      }
      const failure: TutorialFailure =
        event.status === "reconnect_required" ? "reconnect_required" : "invalid_request";
      return { ...prev, phase: "failed", failure };
    }
    case "VERIFIED":
      return prev.phase === "verify"
        ? { ...prev, phase: "first_sync", failure: null, verifyRetryable: false }
        : prev;
    case "VERIFY_RETRYABLE":
      return prev.phase === "verify" ? { ...prev, verifyRetryable: true } : prev;
    case "VERIFY_RETRY":
      // In-place re-verify (e.g. after a transient provider error): stay on verify and bump
      // the nonce so the verify effect re-fires. Never resets the wizard or drops accountId.
      return prev.phase === "verify"
        ? { ...prev, verifyRetryable: false, failure: null, verifyNonce: prev.verifyNonce + 1 }
        : prev;
    case "VERIFY_FAILED":
      return prev.phase === "verify"
        ? { ...prev, phase: "failed", failure: event.failure }
        : prev;
    case "SYNC_RESULT":
      if (prev.phase !== "first_sync") {
        return prev;
      }
      return event.ok
        ? { ...prev, phase: "done", failure: null }
        : { ...prev, phase: "failed", failure: "first_sync_failed" };
    case "RETRY":
      return retryTarget(prev);
    case "RESTORE":
      return event.state;
    default:
      return prev;
  }
}

/** Where a retry goes, per failure cause. */
function retryTarget(prev: TutorialState): TutorialState {
  switch (prev.failure) {
    case "first_sync_failed":
      return { ...prev, phase: "first_sync", failure: null };
    case "board_mapping":
    case "reconnect_required":
    case "credential_decrypt":
    case "verify_unavailable":
      // Re-run verification when we still have the account; otherwise restart the connect.
      return prev.accountId
        ? { ...prev, phase: "verify", failure: null, verifyRetryable: false }
        : { ...INITIAL_STATE, phase: "mall_confirm", mallId: prev.mallId };
    case "invalid_request":
    case "start_failed":
    default:
      return { ...INITIAL_STATE, phase: "mall_confirm", mallId: prev.mallId };
  }
}

/** Interpret a sanitized OAuth callback status into a tutorial event. Pure. */
export function interpretCallback(
  status: Cafe24ResultStatus,
  accountId: string | null,
): TutorialEvent {
  return { type: "CALLBACK", status, accountId };
}

export type CapabilityInterpretation =
  | { kind: "verified" }
  | { kind: "retry" }
  | { kind: "failed"; failure: TutorialFailure };

/**
 * Interpret a capability view. Pure so the mapping from backend reason codes to tutorial
 * failure causes is exhaustively testable. A transient provider error is a retry, never a
 * hard failure; a board-mapping mismatch and an auth/credential problem are distinct causes.
 */
export function interpretCapability(view: Cafe24CapabilityView): CapabilityInterpretation {
  if (view.connectionVerified) {
    return { kind: "verified" };
  }
  if (view.reason === "PROVIDER_ERROR") {
    return { kind: "retry" };
  }
  if (
    view.reason === "RECONNECT_REQUIRED" ||
    view.reason === "CREDENTIAL_MISSING" ||
    view.reason === "NOT_CONNECTED" ||
    view.reason === "CONNECTION_INCOMPLETE"
  ) {
    return { kind: "failed", failure: "reconnect_required" };
  }
  const boardBad = view.features.some(
    (f) =>
      (f.feature === "REVIEW_COLLECT" || f.feature === "INQUIRY_COLLECT") &&
      f.reason === "BOARD_MAPPING_MISMATCH",
  );
  if (boardBad) {
    return { kind: "failed", failure: "board_mapping" };
  }
  return { kind: "failed", failure: "reconnect_required" };
}

// ---- copy (FE owns all final copy) ----

export const PHASE_COPY: Record<TutorialPhase, { title: string; body: string }> = {
  intro: {
    title: "카페24 연결 안내",
    body: "쇼핑몰을 안전하게 연결하고, 어떤 정보가 읽기 전용으로 수집되는지 단계별로 확인합니다.",
  },
  mall_confirm: {
    title: "쇼핑몰 확인",
    body: "쇼핑몰 주소 또는 Mall ID를 입력하면 정규화된 Mall ID를 확인시켜 드립니다.",
  },
  permissions: {
    title: "요청 권한 안내",
    body: "카페24에는 읽기 전용 권한만 요청합니다. 주문·문의·리뷰를 읽어오며, 글쓰기/답변 권한은 요청하지 않습니다.",
  },
  consent: {
    title: "카페24 동의",
    body: "카페24 공식 동의 화면으로 이동합니다. 동의를 마치면 이 화면으로 돌아옵니다.",
  },
  verify: {
    title: "연결 검증",
    body: "자격 증명과 쇼핑몰 식별, 게시판 매핑을 읽기 전용으로 검증하고 있습니다.",
  },
  first_sync: {
    title: "첫 동기화",
    body: "주문 요약을 읽기 전용으로 한 번 동기화해 연결을 확인합니다.",
  },
  done: {
    title: "연결 완료",
    body: "연결이 완료되었습니다. 사용 가능한 기능을 아래에서 확인하세요.",
  },
  failed: {
    title: "연결을 마치지 못했습니다",
    body: "원인을 확인하고 다시 시도해 주세요.",
  },
};

export const STEP_LABELS: Record<TutorialPhase, string> = {
  intro: "소개",
  mall_confirm: "쇼핑몰 확인",
  permissions: "권한 안내",
  consent: "카페24 동의",
  verify: "연결 검증",
  first_sync: "첫 동기화",
  done: "완료",
  failed: "오류",
};

export const FAILURE_COPY: Record<TutorialFailure, string> = {
  invalid_request:
    "요청이 만료되었거나 리디렉션 정보가 일치하지 않습니다. 처음부터 다시 연결해 주세요.",
  reconnect_required:
    "연결 정보를 확인하지 못했습니다. 카페24 동의를 다시 진행해 연결을 갱신해 주세요.",
  credential_decrypt:
    "저장된 연결 정보를 확인하지 못했습니다. 카페24 동의를 다시 진행해 주세요.",
  board_mapping:
    "게시판(구매후기/문의사항) 매핑을 확인하지 못했습니다. 잠시 후 다시 검증해 주세요.",
  first_sync_failed: "첫 동기화에 실패했습니다. 잠시 후 다시 시도해 주세요.",
  verify_unavailable: "연결 검증을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.",
  start_failed: "카페24 연결 시작에 실패했습니다. 잠시 후 다시 시도해 주세요.",
};

// ---- resume persistence (tutorial-scoped; guarded, no secrets) ----

const STORAGE_KEY = "cafe24_tutorial_v1";

/** Persist the resumable slice of state. Only phase/mallId/accountId — never a secret. */
export function saveTutorialState(state: TutorialState): void {
  if (typeof sessionStorage === "undefined") {
    return;
  }
  try {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        phase: state.phase,
        mallId: state.mallId,
        accountId: state.accountId,
        failure: state.failure,
      }),
    );
  } catch {
    // Storage unavailable (private mode / quota) — resume is best-effort, never fatal.
  }
}

export function loadTutorialState(): TutorialState | null {
  if (typeof sessionStorage === "undefined") {
    return null;
  }
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<TutorialState>;
    if (!parsed.phase || !STEP_LABELS[parsed.phase as TutorialPhase]) {
      return null;
    }
    return {
      phase: parsed.phase as TutorialPhase,
      mallId: parsed.mallId ?? null,
      accountId: parsed.accountId ?? null,
      failure: parsed.failure ?? null,
      verifyRetryable: false,
      verifyNonce: 0,
    };
  } catch {
    return null;
  }
}

export function clearTutorialState(): void {
  if (typeof sessionStorage === "undefined") {
    return;
  }
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
