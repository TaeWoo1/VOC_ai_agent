// NAVER Guided Connection (G3) — API-issuance tutorial content (FE-owned copy).
//
// A step-by-step, actionable walkthrough the seller follows to issue (or reuse) a NAVER Commerce API
// application and obtain the Application ID + Secret, entirely at the official API center. It is NOT a
// scrape or an automated click flow: SellerOps only shows the checklist and opens the official center in
// a NEW TAB; the seller performs every action there themselves.
//
// **Honesty rule (slice §4 / product constraint):** exact menu names, button labels, and the precise
// order API-group name are NOT hardcoded here — they must be confirmed against the live API center via
// operator read-only observation (see the report's "needs confirmation" list). Each step therefore
// describes the ACTION and the general area to look for, in hedged language, rather than asserting a label
// SellerOps has not verified. `TUTORIAL_HINT_QUALIFIER` is shown ONCE at the top of the checklist so the
// seller treats every described label as approximate.
//
// Privacy: this module holds only static copy. Tutorial *progress* (which steps are checked) lives in
// transient component state and NEVER carries a credential value or an account id (product constraint).

/**
 * Documented entry to the NAVER Commerce API Center. Centralized so there is exactly one place to correct
 * it after operator recon. Exact deep-links (application list / application detail) are intentionally NOT
 * encoded — the seller navigates within the center from this entry. Confirm this URL against the live
 * center during recon before any operator walkthrough.
 */
export const NAVER_API_CENTER_URL = "https://apicenter.commerce.naver.com/";

/** Shown once at the top of the checklist so the seller treats every described label as approximate. */
export const TUTORIAL_HINT_QUALIFIER =
  "실제 메뉴·버튼 이름은 화면 버전에 따라 다를 수 있으니, 위치와 역할을 기준으로 찾아 주세요.";

export interface TutorialStep {
  /** Stable key (used for checklist state + test targeting). Never surfaced. */
  id: string;
  /** The action the seller performs, in the imperative. */
  title: string;
  /** "어디를 눌러야 하나요?" — where to look / what it does. Hedged; no verbatim NAVER label asserted. */
  hint: string;
  /** True for the one step that opens the official center in a new tab. */
  opensCenter?: boolean;
}

/**
 * New-app issuance walk (§flow 6): open the center → log in → find the application area → create an app →
 * add the order API group → read the ID/Secret → return to SellerOps. The last step is the handoff back to
 * the secure input; the seller never types the Secret anywhere but the masked SellerOps field.
 */
export const NAVER_ISSUANCE_TUTORIAL: readonly TutorialStep[] = [
  {
    id: "open_center",
    title: "NAVER 커머스 API 센터 열기",
    hint: "아래 버튼을 누르면 공식 API 센터가 새 탭으로 열립니다. 이 SellerOps 화면은 그대로 남아 있으니, 확인 후 다시 이 탭으로 돌아오세요.",
    opensCenter: true,
  },
  {
    id: "login",
    title: "판매자 계정으로 로그인",
    hint: "API 센터에서 애플리케이션을 발급하려면 스토어의 통합 매니저 권한이 있는 판매자 계정으로 로그인해야 합니다.",
  },
  {
    id: "open_app_list",
    title: "내 스토어의 애플리케이션 관리로 이동",
    hint: "로그인 후 애플리케이션(앱)을 만들고 관리하는 영역으로 이동합니다. 보통 '내 애플리케이션' 또는 애플리케이션 목록 형태의 메뉴입니다.",
  },
  {
    id: "create_app",
    title: "애플리케이션 생성",
    hint: "새 애플리케이션을 하나 만듭니다. 스토어당 애플리케이션은 1개만 만들 수 있고 삭제할 수 없으니, 이미 만든 앱이 있으면 새로 만들지 말고 그 앱을 사용하세요.",
  },
  {
    id: "app_usage_check",
    title: "애플리케이션 상태 확인",
    hint: "방금 만든 애플리케이션이 사용 가능한 상태인지 확인합니다. 화면에 '다시사용' 버튼이 보이면 직접 눌러 활성화하세요. 버튼이 보이지 않더라도 SellerOps가 활성 상태라고 단정하지는 않습니다 — 확인 후 다음으로 진행하세요.",
  },
  {
    id: "select_api_group",
    title: "주문 조회에 필요한 API 그룹 추가",
    hint: "애플리케이션에 상품·주문(판매자) 관련 API 그룹을 추가/허용합니다. 정확한 그룹 이름은 화면에서 '주문'·'판매자'가 포함된 항목을 찾아 선택하세요.",
  },
  {
    id: "view_credentials",
    title: "애플리케이션 ID와 시크릿 확인",
    hint: "애플리케이션 상세 화면에서 애플리케이션 ID와 시크릿(클라이언트 시크릿)을 확인합니다. 시크릿은 화면에서 눈으로 확인만 하고, 다음 단계에서 SellerOps 보안 입력란에 직접 입력하세요.",
  },
  {
    id: "return_to_sellerops",
    title: "SellerOps로 돌아와 입력",
    hint: "확인한 애플리케이션 ID와 시크릿을 들고 이 탭으로 돌아옵니다. 아래 '발급을 완료했어요'를 누르면 SellerOps 보안 입력 단계로 넘어갑니다.",
  },
] as const;

/**
 * Existing-app reuse walk (§flow 3/7): the store already has its one application, so the seller does NOT
 * create a second — they open the existing app, confirm it has the order API group (add it if missing), and
 * read the ID/Secret. Same open-center-in-new-tab + checklist shape as issuance.
 */
export const NAVER_EXISTING_APP_TUTORIAL: readonly TutorialStep[] = [
  {
    id: "open_center",
    title: "NAVER 커머스 API 센터 열기",
    hint: "아래 버튼을 누르면 공식 API 센터가 새 탭으로 열립니다. 이 화면은 그대로 남아 있으니 확인 후 돌아오세요.",
    opensCenter: true,
  },
  {
    id: "open_existing_app",
    title: "기존 애플리케이션 열기",
    hint: "이미 만들어 둔 애플리케이션의 상세 화면을 엽니다. 새 애플리케이션을 만들지 마세요 — 스토어당 1개만 가능하고 삭제할 수 없습니다.",
  },
  {
    id: "app_usage_check",
    title: "애플리케이션 상태 확인",
    hint: "이 애플리케이션이 사용 가능한 상태인지 먼저 확인합니다. 화면에 '다시사용' 버튼이 보이면 앱이 일시중단된 것이니 직접 눌러 활성화하세요. 버튼이 보이지 않더라도 SellerOps가 활성 상태라고 단정하지는 않습니다 — 확인 후 다음으로 진행하세요.",
  },
  {
    id: "verify_api_group",
    title: "주문 조회 API 그룹 확인",
    hint: "이 애플리케이션에 상품·주문(판매자) 관련 API 그룹이 포함되어 있는지 확인하고, 없으면 추가합니다.",
  },
  {
    id: "view_credentials",
    title: "애플리케이션 ID와 시크릿 확인",
    hint: "애플리케이션 상세에서 애플리케이션 ID와 시크릿을 확인합니다. 시크릿은 눈으로만 확인하고, SellerOps 보안 입력란에 직접 입력하세요. 확인이 어려우면 시크릿 재발급이 필요할 수 있습니다.",
  },
] as const;
