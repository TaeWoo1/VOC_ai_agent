// NAVER Guided Connection (G3) — FE-owned seller-facing copy (frontend/CLAUDE.md: "FE owns all
// final copy"). Korean, honest and non-over-claiming: no phase claims a live connection before it
// is proven (§12 completion gate), and no copy names a selector, url, or account id. Declared as
// `as const` records keyed by the sanitized enums so the wizard renders them by lookup.
//
// The initial order connection is Local-Agent-free (product decision 2026-07-31): no phase mentions
// a bridge/renderer/NAVER-login step. The Local Agent is referenced only in the post-completion
// REVIEW_IMPORT setup card (see REVIEW_SETUP_COPY), never in the order-connection path.
import type { GuidedActor, GuidedFailureReason, GuidedPhase } from "./types";

export const PHASE_COPY: Record<GuidedPhase, { title: string; body: string }> = {
  check_saved_credential: {
    title: "저장된 연결 정보 확인",
    body: "SellerOps에 저장된 NAVER 연결 정보가 있는지 확인하고 있습니다. 있으면 다시 입력하지 않고 바로 연결을 확인합니다.",
  },
  application_path_choice: {
    title: "애플리케이션 확인",
    body: "NAVER 커머스 API 애플리케이션 상황을 선택해 주세요. 이미 있으면 기존 앱을 그대로 재사용하고, 없을 때만 새로 발급합니다.",
  },
  application_status_unknown: {
    title: "애플리케이션 목록 확인",
    body: "새 앱을 발급하기 전에, NAVER 커머스 API 센터의 애플리케이션 목록을 직접 확인해 주세요. 스토어별 애플리케이션은 1개만 만들 수 있고 삭제할 수 없으므로, 이미 앱이 있으면 새로 만들지 않고 그 앱을 그대로 재사용합니다. 앱이 없을 때만 신규 발급으로 진행합니다.",
  },
  existing_credential_entry: {
    title: "기존 연결 정보 입력",
    body: "이미 발급된 애플리케이션 ID와 시크릿을 SellerOps 보안 입력란에 직접 입력해 주세요. 새 앱을 만들 필요가 없습니다. 이 시크릿은 해당 스토어 애플리케이션의 공용 자격 증명이라, 같은 앱을 쓰는 다른 프로그램과 동일한 값입니다. 나중에 시크릿을 재발급하면 그 앱을 쓰는 모든 프로그램의 연결이 함께 끊깁니다.",
  },
  credential_recovery_required: {
    title: "시크릿 재확인 필요",
    body: "애플리케이션은 있지만 시크릿을 확보하지 못했습니다. NAVER 커머스 API 센터의 기존 애플리케이션 화면에서 시크릿을 다시 확인하거나, 확인이 어려우면 시크릿을 재발급해 주세요. 앱을 삭제할 필요는 없습니다 (NAVER는 앱 삭제 기능을 제공하지 않습니다). 다만 시크릿을 재발급하면 이 앱을 사용하는 다른 프로그램의 연결도 함께 끊기므로, 다른 프로그램에서 사용 중인지 먼저 확인해 주세요. SellerOps는 시크릿을 대신 확인하거나 재발급하지 않습니다.",
  },
  account_store_choice_required: {
    title: "계정·스토어 선택",
    body: "발급에 사용할 NAVER 계정과 스토어를 직접 선택해 주세요. (통합 매니저 권한이 필요합니다.)",
  },
  application_issuance: {
    title: "애플리케이션 발급",
    body: "아래 단계를 따라 NAVER 커머스 API 센터에서 애플리케이션을 발급하고, 주문 조회에 필요한 API 그룹을 추가한 뒤 애플리케이션 ID와 시크릿을 확인해 주세요.",
  },
  application_issuance_guided: {
    title: "화면 안내로 발급",
    body: "내 PC의 SellerOps 도우미가 NAVER 커머스 API 센터를 전용 창으로 열고, 눌러야 할 위치를 단계별로 표시해 드립니다. 실제 로그인·클릭·발급은 고객님이 그 창에서 직접 진행하고, SellerOps는 화면을 대신 조작하거나 시크릿을 대신 읽지 않습니다. 언제든 '텍스트로 직접 진행하기'로 바꿀 수 있습니다.",
  },
  credential_issued: {
    title: "발급 완료 확인",
    body: "애플리케이션 ID와 시크릿이 발급되면 다음 단계에서 SellerOps에 안전하게 입력합니다.",
  },
  sellerops_credential_entry: {
    title: "연결 정보 입력",
    body: "발급 화면에서 확인한 애플리케이션 ID와 시크릿을 SellerOps 보안 입력란에 직접 입력해 주세요.",
  },
  credential_registration: {
    title: "연결 정보 저장 중",
    body: "입력한 연결 정보를 암호화해 저장하고 있습니다.",
  },
  connection_testing: {
    title: "연결 확인 중",
    body: "저장된 연결 정보로 인증만 확인합니다. (아직 데이터를 수집하지 않습니다.)",
  },
  permission_review_required: {
    title: "권한 확인 필요",
    body: "연결에 필요한 API 권한이 부족할 수 있습니다. NAVER 커머스 API 센터에서 애플리케이션의 API 그룹·권한을 확인한 뒤 다시 시도해 주세요.",
  },
  call_environment_mismatch: {
    title: "호출 환경 확인 필요",
    body: "허용된 호출 환경(예: 호출 IP)과 일치하지 않을 수 있습니다. NAVER 커머스 API 센터에서 애플리케이션의 호출 IP 설정을 확인한 뒤 다시 시도해 주세요.",
  },
  order_access_denied: {
    title: "주문 API 접근 확인 필요",
    body: "연결 정보는 정상이지만 주문 API 접근이 거부되었습니다. 애플리케이션에 주문 관련 API 그룹 권한이 있는지, 그리고 SellerOps 고정 호출 IP가 'API 호출 IP'에 등록되어 있는지 두 가지를 모두 확인한 뒤 다시 시도해 주세요.",
  },
  first_order_sync: {
    title: "첫 주문 수집 중",
    body: "주문 요약 데이터를 처음으로 가져오고 있습니다.",
  },
  completed: {
    title: "주문 연결 완료",
    body: "연결 정보 저장·연결 확인·첫 주문 수집이 모두 완료되었습니다.",
  },
  review_export_readiness: {
    title: "리뷰 수집 준비",
    body: "리뷰는 판매자센터 공식 내보내기를 작업 창에서 직접 진행합니다. 준비되면 리뷰 내보내기로 이동하세요.",
  },
  recoverable_ui_drift: {
    title: "화면 확인 필요",
    body: "NAVER 화면이 예상과 달라 진행을 멈췄습니다. 화면을 확인하고 계속할지 알려주세요.",
  },
  unsupported_state: {
    title: "확인 필요",
    body: "현재 상태를 안전하게 판단하지 못했습니다. 화면을 직접 확인한 뒤 다음 단계를 선택해 주세요.",
  },
  terminal_failure: {
    title: "연결 중단",
    body: "연결을 완료하지 못했습니다. 잠시 후 다시 시도하거나 도움을 요청해 주세요.",
  },
};

export const ACTOR_COPY: Record<GuidedActor, string> = {
  USER_REQUIRED: "고객님이 진행",
  SELLEROPS_AUTOMATED: "SellerOps가 진행",
  SELLEROPS_GUIDED: "SellerOps 안내",
  SUPERVISED_ACTION: "확인 후 진행",
  UNSUPPORTED: "지원하지 않음",
};

/**
 * Disconnect ≠ NAVER deactivation guardrail (design-audit item D). Surfaced once the connection is live so
 * the seller understands the correct way to stop using SellerOps: SellerOps removes ONLY its own saved
 * connection info from its vault; it never deactivates or touches the NAVER application (which is the store's
 * single, non-deletable app shared by every tool). Never instruct 비활성화/삭제 of the NAVER app to leave SellerOps.
 */
export const DISCONNECT_GUARDRAIL_COPY = {
  title: "연결 해제 안내",
  body: "SellerOps 연결을 해제하면 SellerOps에 저장된 연결 정보만 삭제됩니다. NAVER 애플리케이션은 비활성화하거나 삭제하지 않습니다. NAVER 앱은 스토어당 1개뿐이고 삭제할 수 없으며 다른 프로그램도 함께 쓸 수 있으므로, SellerOps 연결 해제를 위해 NAVER 앱을 비활성화·삭제하지 마세요.",
} as const;

/**
 * Post-completion REVIEW_IMPORT setup card copy. The order connection is complete and Local-Agent-free;
 * review import is a SEPARATE, later step that DOES need the Local Agent (pairing + NAVER seller-center
 * login + the Action Window guided export). The card explains the honest state by pairing readiness:
 * `SETUP_REQUIRED` when the Local Agent is not yet paired, `GUIDED_CONFIRMATION` once it is. It never blocks
 * or re-opens the order connection.
 */
export const REVIEW_SETUP_COPY = {
  title: "리뷰 가져오기 설정 (선택)",
  setupRequiredBody:
    "주문 연결은 끝났습니다. 리뷰 가져오기는 별도 단계로, 내 PC의 SellerOps 로컬 에이전트를 실행·연결하고 판매자센터에 직접 로그인한 뒤 작업 창에서 공식 내보내기로 진행합니다. 지금 하지 않아도 주문 연결에는 영향이 없습니다.",
  readyBody:
    "로컬 에이전트가 연결되어 있어 리뷰 가져오기를 진행할 수 있습니다. 리뷰는 판매자센터 공식 내보내기를 작업 창에서 직접 진행합니다 (자동 수집이 아닙니다).",
  cta: "리뷰 가져오기 설정으로 이동",
} as const;

/**
 * Capability-result copy (§capability contract). The backend sends closed feature/state codes and a
 * fixed label; the FE owns the seller-facing state chip + explanation. Honest and non-over-claiming:
 * ORDER read is only "연결됨" when a first sync actually succeeded; review import is framed as a guided
 * export (never an automatic API pull) whose readiness depends on the Local Agent setup; review reply is
 * "미활성화" (no auto-send); inquiry is "연동 준비 중". The review/inquiry lines are informational — the
 * order connection screen never mixes in the review Action Window.
 */
export const CAPABILITY_STATE_COPY: Record<string, { chip: string; tone: "good" | "muted" | "warn" }> = {
  AVAILABLE: { chip: "연결됨", tone: "good" },
  SETUP_REQUIRED: { chip: "설정 필요", tone: "muted" },
  GUIDED_CONFIRMATION: { chip: "작업 창에서 직접 진행", tone: "muted" },
  NOT_ENABLED: { chip: "미활성화", tone: "muted" },
  INTEGRATION_PENDING: { chip: "연동 준비 중", tone: "muted" },
  NEEDS_ATTENTION: { chip: "확인 필요", tone: "warn" },
};

/** Safe reason codes → optional one-line explanation shown under a capability line. */
export const CAPABILITY_REASON_COPY: Record<string, string> = {
  CREDENTIAL_MISSING: "저장된 연결 정보가 없습니다.",
  FIRST_SYNC_REQUIRED: "첫 주문 수집이 아직 완료되지 않았습니다.",
  SYNC_FAILED: "첫 주문 수집에 실패했습니다. 다시 시도해 주세요.",
  SYNC_IN_PROGRESS: "첫 주문 수집이 진행 중입니다.",
  SCOPE_INSUFFICIENT: "읽기 권한(스코프)이 부족합니다. 카페24 앱의 읽기 권한 설정을 확인해 주세요.",
  RECONNECT_REQUIRED: "연결 정보를 확인하지 못했습니다. 카페24 동의를 다시 진행해 주세요.",
  PROVIDER_ERROR: "카페24 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.",
  GUIDED_EXPORT_ONLY: "네이버 리뷰는 공식 API가 없어, 작업 창에서 직접 내보내기로 가져옵니다.",
  REVIEW_SETUP_REQUIRED: "리뷰 가져오기는 로컬 에이전트를 설정한 뒤 작업 창에서 진행합니다.",
  REPLY_UNVERIFIED: "리뷰 답변 자동 전송은 제공하지 않습니다.",
  INTEGRATION_PENDING: "네이버 문의 연동은 준비 중입니다.",
};

/** First ORDER_SUMMARY sync status → seller-facing line for the capability summary. */
export const SYNC_STATUS_COPY: Record<string, string> = {
  NONE: "아직 수집 전",
  SUCCESS: "첫 주문 수집 완료",
  PARTIAL: "첫 주문 수집 일부 완료",
  FAILED: "첫 주문 수집 실패",
  RUNNING: "첫 주문 수집 진행 중",
};

/**
 * First-sync in-progress copy (NAVER First Sync Progress + Resume UX v1). Honest: NO fake percentage — the
 * backend exposes no progress fraction, so we show only elapsed time and reassure the seller that refreshing
 * resumes the SAME run (never a second sync). `slowNote` appears once the run passes a soft threshold; the
 * `stalled*` copy is for a poll timeout, where we offer a re-check (poll only) — never a new collection.
 */
export const SYNC_PROGRESS_COPY = {
  body: "주문 요약 데이터를 처음으로 가져오고 있습니다. 주문 수에 따라 몇 분 정도 걸릴 수 있어요.",
  reassurance: "이 화면을 그대로 두셔도 되고, 새로고침해도 같은 수집이 이어집니다. 수집이 다시 시작되지 않아요.",
  elapsedLabel: "경과 시간",
  slowNote: "예상보다 오래 걸리고 있어요. 수집은 계속 진행 중이니 잠시만 더 기다려 주세요.",
  stalledTitle: "아직 진행 중일 수 있어요",
  stalledBody: "수집이 아직 끝나지 않았습니다. 새 수집을 만들지 않고 현재 진행 상태만 다시 확인합니다.",
  recheckCta: "진행 상태 다시 확인",
} as const;

export const FAILURE_COPY: Record<GuidedFailureReason, string> = {
  INVALID_CREDENTIAL: "연결 정보가 올바르지 않습니다. 애플리케이션 ID와 시크릿을 다시 확인해 주세요.",
  PERMISSION_INSUFFICIENT: "연결에 필요한 권한이 부족할 수 있습니다. 애플리케이션의 API 그룹·권한을 확인해 주세요.",
  CALL_ENVIRONMENT_MISMATCH: "허용된 호출 환경과 일치하지 않을 수 있습니다. 애플리케이션의 호출 IP 설정을 확인해 주세요.",
  ORDER_ACCESS_DENIED: "주문 API 접근이 거부되었습니다. 주문 API 그룹 권한과 SellerOps 고정 호출 IP 등록을 함께 확인해 주세요.",
  SECRET_UNRECOVERABLE: "시크릿을 확보하지 못했습니다. 기존 애플리케이션의 시크릿을 다시 확인하거나, 확인이 어려우면 시크릿을 재발급해 주세요. (앱 삭제는 필요하지 않으며 NAVER도 제공하지 않습니다. 단, 재발급은 같은 앱을 쓰는 모든 프로그램의 연결을 함께 끊습니다.)",
  TEMPORARY_PROVIDER_ERROR: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
  PROVIDER_UNAVAILABLE: "NAVER 서비스에 일시적으로 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.",
  TEST_UNSUPPORTED: "이 연결 방식은 아직 지원되지 않습니다.",
  NOT_CONFIGURED: "저장된 연결 정보가 없습니다. 연결 정보를 입력해 주세요.",
  SYNC_FAILED: "첫 주문 수집에 실패했습니다. 잠시 후 다시 시도해 주세요.",
  UI_DRIFT: "NAVER 화면이 예상과 달라졌습니다. 화면을 확인해 주세요.",
  UNKNOWN_STATE: "상태를 확인하지 못했습니다. 화면을 직접 확인해 주세요.",
};
