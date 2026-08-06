// Coupang first-connection tutorial — pure state engine (no React, no api, no I/O).
//
// Drives the guided journey a first-time Coupang seller walks in the UI: issue the WING Open API key →
// enter the credential → connection test → PREPARING → first ORDER_SUMMARY sync → CONNECTED → Operations.
//
// **Server-authoritative, not localStorage-authoritative.** Every phase is DERIVED from persisted,
// channel-agnostic backend facts — the seller account's two-signal `connectionStatus`
// (PENDING → PREPARING → CONNECTED), whether a credential is on file, and the latest ORDER_SUMMARY sync
// outcome. So a refresh / a return after leaving re-lands on the correct step by re-reading state, and a
// sync already running server-side is RESUMED (observed), never re-triggered. This engine deliberately
// does NOT touch the NAVER-locked `/connection-capability` endpoint; it needs none of it.
//
// **Honest failure surfacing.** The connection test's safe `reasonCode` (INVALID_CREDENTIAL /
// CALL_ENVIRONMENT_MISMATCH / ORDER_ACCESS_DENIED / PROVIDER_UNAVAILABLE) maps to actionable recovery
// copy. The internal `returnShippingCenters` 400 → `ordersheets` fallback the backend uses to confirm a
// connection is an implementation detail the backend already hides behind those codes; it never reaches
// here and must never be surfaced to the seller.

import type { ChannelStatus, SyncRunView } from "./types";

/** The tutorial's engine phase — the single source of truth the container reduces and renders. */
export type CoupangPhase =
  | "resolving" // initial server read in flight (no writes)
  | "connect" // steps 1–3: prerequisites + credential entry (no credential on file yet)
  | "submitting" // storeCredential + testConnection chain in flight
  | "connect_error" // a credential is on file but not verified — recovery (reasonCode-aware) + re-verify
  | "preparing" // step 4: credential verified (PREPARING); the explicit "첫 주문 불러오기" CTA
  | "syncing" // step 5: first sync in flight OR a resumed RUNNING run being observed
  | "sync_error" // step 5 terminal FAILED — retry the sync (never a second concurrent run)
  | "connected" // step 6: first sync succeeded (CONNECTED) → Operations
  | "unavailable"; // the Coupang channel / credential template could not be prepared

/** Terminal-or-running status of the first ORDER_SUMMARY sync, in this engine's vocabulary. */
export type CoupangSyncStatus = "RUNNING" | "SUCCESS" | "PARTIAL" | "FAILED";

/** Safe connection-test reason codes the backend emits (mirrors VerifyOutcome.REASON_*). Sanitized. */
export type CoupangReasonCode =
  | "INVALID_CREDENTIAL"
  | "CALL_ENVIRONMENT_MISMATCH"
  | "ORDER_ACCESS_DENIED"
  | "PROVIDER_UNAVAILABLE";

/** The phases the initial server read can land on (every phase except the transient in-flight ones). */
export type ResolvedPhase = Extract<
  CoupangPhase,
  "connect" | "connect_error" | "preparing" | "syncing" | "sync_error" | "connected" | "unavailable"
>;

export interface CoupangState {
  phase: CoupangPhase;
  /** The last connection-test reason code (connect_error only). null = unverified with no known reason
   *  (e.g. a refresh that resumed a credential-present-but-not-PREPARING account). */
  reasonCode: string | null;
}

export type CoupangEvent =
  | { type: "RESOLVED"; phase: ResolvedPhase }
  | { type: "SUBMIT" } // credential submit started (→ submitting)
  | { type: "TEST_RESULT"; status: "SUCCESS" | "FAILED"; reasonCode: string | null }
  | { type: "SUBMIT_FAILED" } // store/transport error before a test result (safe, generic)
  | { type: "RETEST" } // re-run the connection test on the stored credential (→ submitting)
  | { type: "REENTER" } // re-open the credential form from a recovery screen (→ connect)
  | { type: "RUN_SYNC" } // the "첫 주문 불러오기" CTA / a sync retry (→ syncing)
  | { type: "SYNC_RESULT"; status: CoupangSyncStatus }; // terminal or coalesced-RUNNING sync outcome

export const INITIAL_COUPANG_STATE: CoupangState = { phase: "resolving", reasonCode: null };

/** Pure reducer. Ignores events that do not apply to the current phase (fail-safe, no throw). */
export function coupangTutorialReducer(state: CoupangState, event: CoupangEvent): CoupangState {
  switch (event.type) {
    case "RESOLVED":
      // Only meaningful from the initial read; once past resolving the live flow owns the phase.
      if (state.phase !== "resolving") return state;
      return { phase: event.phase, reasonCode: null };

    case "SUBMIT":
      if (state.phase !== "connect" && state.phase !== "connect_error") return state;
      return { phase: "submitting", reasonCode: null };

    case "RETEST":
      // Re-verify a stored credential without re-typing the secret (recovery screen).
      if (state.phase !== "connect_error") return state;
      return { phase: "submitting", reasonCode: null };

    case "REENTER":
      if (state.phase !== "connect_error") return state;
      return { phase: "connect", reasonCode: null };

    case "TEST_RESULT":
      if (state.phase !== "submitting") return state;
      return event.status === "SUCCESS"
        ? { phase: "preparing", reasonCode: null } // NO auto-sync: the seller starts it explicitly (step 4).
        : { phase: "connect_error", reasonCode: event.reasonCode };

    case "SUBMIT_FAILED":
      if (state.phase !== "submitting") return state;
      return { phase: "connect_error", reasonCode: null };

    case "RUN_SYNC":
      if (state.phase !== "preparing" && state.phase !== "sync_error") return state;
      return { phase: "syncing", reasonCode: null };

    case "SYNC_RESULT":
      if (state.phase !== "syncing") return state;
      if (event.status === "RUNNING") return state; // coalesced onto a live run — keep observing.
      return event.status === "FAILED"
        ? { phase: "sync_error", reasonCode: null }
        : { phase: "connected", reasonCode: null }; // SUCCESS | PARTIAL both complete the connection.

    default:
      return state;
  }
}

/** Map a backend SyncRunView.status onto the engine's sync vocabulary (fail-closed to RUNNING). */
export function syncStatusFromRun(run: SyncRunView | null | undefined): CoupangSyncStatus {
  switch (run?.status) {
    case "SUCCESS":
    case "PARTIAL":
    case "FAILED":
    case "RUNNING":
      return run.status;
    default:
      return "RUNNING"; // unknown/absent → non-advancing (never a spurious success)
  }
}

/**
 * The most recent ORDER_SUMMARY run for one account, newest first by finished-then-started time. The
 * `/sync-runs` list is not contractually ordered, so we sort defensively rather than trust index 0.
 */
export function latestOrderRun(
  runs: readonly SyncRunView[],
  sellerAccountId: string,
): SyncRunView | null {
  const mine = runs.filter(
    (r) => r.sellerAccountId === sellerAccountId && r.dataType === "ORDER_SUMMARY",
  );
  if (mine.length === 0) return null;
  const time = (r: SyncRunView) =>
    Date.parse(r.finishedAt ?? "") || Date.parse(r.startedAt ?? "") || 0;
  return [...mine].sort((a, b) => time(b) - time(a))[0];
}

/** Facts the container reads (all channel-agnostic + read-only) to decide where the page lands. */
export interface CoupangResolveInput {
  /** Channel + credential template are both ready (else `unavailable`). */
  ready: boolean;
  /** The seller's Coupang account, if one exists (a page load never creates it). */
  connectionStatus: ChannelStatus | null;
  /** Whether a credential is on file for that account. */
  credentialPresent: boolean;
  /** Status of the latest ORDER_SUMMARY sync for that account (null = never synced). */
  latestSyncStatus: CoupangSyncStatus | null;
}

/**
 * Derive the resume phase purely from persisted state — the heart of refresh/leave recovery. No account
 * or no credential → the connect stage. Credential on file but not yet PREPARING → recovery (unverified,
 * reason unknown after a reload). PREPARING → observe a running sync, retry a failed one, else offer the
 * first-sync CTA. CONNECTED → done.
 */
export function resolvePhase(input: CoupangResolveInput): ResolvedPhase {
  if (!input.ready) return "unavailable";
  const status = input.connectionStatus;

  if (status === "CONNECTED") return "connected";

  if (status === "PREPARING") {
    // Credential is verified. A SUCCESS/PARTIAL run would have flipped the account to CONNECTED already,
    // so here the latest run is at most RUNNING or FAILED — or none yet.
    if (input.latestSyncStatus === "RUNNING") return "syncing";
    if (input.latestSyncStatus === "FAILED") return "sync_error";
    return "preparing";
  }

  // PENDING / RECONNECT_REQUIRED / AVAILABLE / no account:
  // A credential on file but not PREPARING means the last verification did not pass (or never ran) — land
  // on recovery so the seller can re-verify or re-enter, without inventing a past error reason.
  if (input.credentialPresent) return "connect_error";
  return "connect";
}

// --- Step model (the 6-step progress indicator) -----------------------------------------------------

export type StepState = "done" | "current" | "upcoming";

export interface CoupangStepView {
  n: number;
  label: string;
  state: StepState;
}

/** The six conceptual steps, in order. Labels are the operator-facing Korean copy. */
export const COUPANG_STEP_LABELS: readonly string[] = [
  "API 키 발급",
  "발급 정보 확인",
  "연결 정보 입력",
  "첫 주문 불러오기",
  "수집 진행",
  "연결 완료",
];

/** Which of the six steps a phase is currently on. Informational steps 1–2 read as "behind" once the
 *  seller is at the credential form (step 3), which is the first action. */
export function activeStep(phase: CoupangPhase): number {
  switch (phase) {
    case "resolving":
    case "connect":
    case "submitting":
    case "connect_error":
      return 3;
    case "preparing":
      return 4;
    case "syncing":
    case "sync_error":
      return 5;
    case "connected":
      return 6;
    case "unavailable":
    default:
      return 1;
  }
}

/** Build the stepper view model for a phase. `connected` marks every step done. */
export function stepModel(phase: CoupangPhase): CoupangStepView[] {
  const active = activeStep(phase);
  const allDone = phase === "connected";
  return COUPANG_STEP_LABELS.map((label, i) => {
    const n = i + 1;
    const state: StepState = allDone || n < active ? "done" : n === active ? "current" : "upcoming";
    return { n, label, state };
  });
}

// --- Copy -------------------------------------------------------------------------------------------

/** Recovery guidance for a failed/unverified connection test. Sanitized + actionable; never exposes the
 *  provider body or the internal returnShippingCenters/ordersheets fallback. */
export interface CoupangRecoveryCopy {
  title: string;
  body: string;
  /** Show the advertised calling-IP panel (register-IP guidance) in this recovery. */
  showIpPanel: boolean;
  /** Offer re-entering the credential (the fix is likely the key itself). */
  allowReenter: boolean;
  /** Label for the primary "re-verify the stored credential" action. */
  retestLabel: string;
}

const GENERIC_RECOVERY: CoupangRecoveryCopy = {
  title: "연결을 확인하지 못했어요",
  body: "입력한 정보를 다시 확인한 뒤 연결을 다시 시도해 주세요.",
  showIpPanel: false,
  allowReenter: true,
  retestLabel: "연결 다시 확인",
};

const RECOVERY_BY_CODE: Record<CoupangReasonCode, CoupangRecoveryCopy> = {
  INVALID_CREDENTIAL: {
    title: "연결 정보가 올바르지 않아요",
    body: "액세스 키·시크릿 키·업체 코드(업체 코드)를 쿠팡 윙에서 다시 확인하고 정확히 입력해 주세요.",
    showIpPanel: false,
    allowReenter: true,
    retestLabel: "다시 확인",
  },
  CALL_ENVIRONMENT_MISMATCH: {
    title: "허용된 호출 IP와 일치하지 않아요",
    body: "쿠팡은 등록된 호출 IP에서만 API 요청을 허용합니다. 아래 IP를 쿠팡 앱의 호출 IP에 등록한 뒤 다시 확인해 주세요.",
    showIpPanel: true,
    allowReenter: false,
    retestLabel: "호출 IP를 확인했어요, 다시 확인",
  },
  ORDER_ACCESS_DENIED: {
    title: "주문 조회 권한을 확인해 주세요",
    body: "발급한 키에 주문(발주서) 조회 권한이 없거나 호출 IP가 아직 허용되지 않았을 수 있어요. 쿠팡 윙에서 주문 API 권한과 호출 IP를 확인한 뒤 다시 시도해 주세요.",
    showIpPanel: true,
    allowReenter: false,
    retestLabel: "권한·호출 IP를 확인했어요, 다시 확인",
  },
  PROVIDER_UNAVAILABLE: {
    title: "쿠팡 서버가 잠시 응답하지 않았어요",
    body: "일시적인 문제일 수 있어요. 잠시 후 연결을 다시 확인해 주세요.",
    showIpPanel: false,
    allowReenter: false,
    retestLabel: "다시 확인",
  },
};

/** Resolve recovery copy for a reason code. Unknown/null → the safe generic recovery. */
export function recoveryCopy(reasonCode: string | null): CoupangRecoveryCopy {
  if (reasonCode && reasonCode in RECOVERY_BY_CODE) {
    return RECOVERY_BY_CODE[reasonCode as CoupangReasonCode];
  }
  return GENERIC_RECOVERY;
}

/** Static copy for the tutorial surface (all seller-facing, Korean). */
export const COUPANG_TUTORIAL_COPY = {
  pageTitle: "쿠팡 연결",
  pageIntro:
    "쿠팡 판매자센터(쿠팡 윙)에서 발급한 Open API 키로 주문을 연동합니다. 아래 순서대로 진행하면 개발 지식 없이 연결할 수 있어요.",
  loading: "쿠팡 연결 준비 정보를 불러오는 중…",
  resolveError: "연결 준비 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
  unavailableTitle: "쿠팡 연결을 준비할 수 없어요",
  unavailableBody: "지금은 쿠팡 API 연결을 준비할 수 없습니다. 잠시 후 다시 시도해 주세요.",
  backToChannels: "채널 목록으로",

  // Step 1 — API 키 발급 안내
  step1Title: "1. 쿠팡 윙에서 Open API 키 발급",
  step1Body:
    "쿠팡 윙 › 판매자 정보 › 오픈API 키 발급에서 액세스 키·시크릿 키를 발급하세요. 직접 개발(자체개발) 연동을 선택하면 별도 심사 없이 바로 발급할 수 있습니다.",
  step1SelfDev:
    "연동 방식은 ‘자체개발’을 선택하세요. 솔루션사 연동이 아니라 내 시스템에서 직접 호출하는 방식입니다.",

  // Step 2 — 발급 정보 설명
  step2Title: "2. 발급받은 정보 확인",
  step2Vendor: "업체 코드(Vendor ID): 쿠팡 윙에서 부여한 판매자 업체 코드입니다. (예: A00012345)",
  step2AccessKey: "액세스 키(Access Key): API 요청을 식별하는 공개 키입니다.",
  step2SecretKey:
    "시크릿 키(Secret Key): 요청에 서명하는 비밀 키입니다. 발급 시 한 번만 표시되니 안전하게 보관하세요.",
  step2CallIp: "호출 IP: 쿠팡은 등록된 IP에서만 API 요청을 허용합니다. 아래 IP를 앱의 호출 IP에 등록하세요.",

  // Step 3 — 입력
  step3Title: "3. 연결 정보 입력",
  step3Body:
    "입력한 키는 암호화되어 저장되고, 즉시 연결 확인만 수행합니다. 주문 상태를 바꾸거나 어떤 것도 전송하지 않습니다.",

  // Step 4 — PREPARING
  step4Title: "연결 정보가 확인되었어요",
  step4Body:
    "키가 정상 확인되어 ‘연결 준비’ 상태예요. 아직 연결이 완료된 것은 아닙니다 — 첫 주문을 한 번 불러오면 연결이 완료됩니다.",
  step4Cta: "첫 주문 불러오기",

  // Step 5 — sync progress
  syncBody: "쿠팡에서 첫 주문을 불러오는 중이에요. 창을 닫아도 수집은 계속됩니다.",
  syncElapsedLabel: "경과 시간",
  syncReassurance: "이 화면을 새로 고쳐도 같은 수집을 이어서 확인해요. 다시 시작되지 않습니다.",
  syncSlowNote: "주문이 많으면 시간이 조금 더 걸릴 수 있어요. 그대로 기다려 주세요.",
  syncStalledTitle: "아직 수집이 진행 중이에요",
  syncStalledBody: "예상보다 오래 걸리고 있어요. 상태를 한 번 더 확인해 볼까요? (새 수집을 시작하지 않아요.)",
  syncRecheckCta: "상태 다시 확인",
  syncErrorTitle: "첫 주문을 불러오지 못했어요",
  syncErrorBody: "일시적인 문제일 수 있어요. 잠시 후 다시 시도해 주세요.",
  syncRetryCta: "다시 시도",

  // Step 6 — completed
  connectedTitle: "쿠팡 연결이 완료됐어요",
  connectedBody: "첫 주문 수집이 끝나 연결이 완료됐습니다. 이제 운영 화면에서 주문을 확인할 수 있어요.",
  goToOrders: "주문 보러 가기",
  viewChannelRuns: "연결 상태·수집 기록 보기",
  connectionStateLabel: "연결 상태",
  lastCollectedLabel: "마지막 수집",
  none: "아직 없음",

  // Recovery — re-enter option shared label
  reenterCta: "연결 정보 다시 입력",
} as const;
