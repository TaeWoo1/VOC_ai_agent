// NAVER Guided Connection (G3) — FE-owned seller-facing copy (frontend/CLAUDE.md: "FE owns all
// final copy"). Korean, honest and non-over-claiming: no phase claims a live connection before it
// is proven (§12 completion gate), and no copy names a selector, url, or account id. Declared as
// `as const` records keyed by the sanitized enums so the wizard renders them by lookup.
import type { GuidedActor, GuidedFailureReason, GuidedPhase } from "./types";

export const PHASE_COPY: Record<GuidedPhase, { title: string; body: string }> = {
  readiness_checking: {
    title: "연결 준비 확인 중",
    body: "내 PC의 로컬 에이전트와 NAVER 로그인 상태를 확인하고 있습니다.",
  },
  agent_unavailable: {
    title: "로컬 에이전트 필요",
    body: "내 PC에서 SellerOps 로컬 에이전트를 실행하고 이 브라우저와 연결해 주세요.",
  },
  renderer_unavailable: {
    title: "작업 창 준비 필요",
    body: "안내를 표시할 작업 창(Action Window)을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  },
  naver_login_required: {
    title: "NAVER 로그인 필요",
    body: "NAVER 커머스 API 센터에 직접 로그인해 주세요. 로그인·2단계 인증은 고객님이 진행합니다.",
  },
  account_store_choice_required: {
    title: "계정·스토어 선택",
    body: "발급에 사용할 NAVER 계정과 스토어를 직접 선택해 주세요. (통합 매니저 권한이 필요합니다.)",
  },
  application_issuance: {
    title: "애플리케이션 발급",
    body: "API 센터에서 애플리케이션을 생성하고 필요한 API 그룹·권한을 검토해 발급을 완료해 주세요.",
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

export const FAILURE_COPY: Record<GuidedFailureReason, string> = {
  AGENT_UNAVAILABLE: "로컬 에이전트에 연결하지 못했습니다. 에이전트 실행 상태를 확인해 주세요.",
  RENDERER_UNAVAILABLE: "작업 창을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  NAVER_LOGIN_REQUIRED: "NAVER 로그인이 필요합니다. 직접 로그인해 주세요.",
  INVALID_CREDENTIAL: "연결 정보가 올바르지 않습니다. 애플리케이션 ID와 시크릿을 다시 확인해 주세요.",
  TEMPORARY_PROVIDER_ERROR: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
  PROVIDER_UNAVAILABLE: "NAVER 서비스에 일시적으로 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.",
  TEST_UNSUPPORTED: "이 연결 방식은 아직 지원되지 않습니다.",
  NOT_CONFIGURED: "저장된 연결 정보가 없습니다. 연결 정보를 입력해 주세요.",
  SYNC_FAILED: "첫 주문 수집에 실패했습니다. 잠시 후 다시 시도해 주세요.",
  UI_DRIFT: "NAVER 화면이 예상과 달라졌습니다. 화면을 확인해 주세요.",
  UNKNOWN_STATE: "상태를 확인하지 못했습니다. 화면을 직접 확인해 주세요.",
};
