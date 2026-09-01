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
    hint: "아래 버튼을 누르면 공식 API 센터가 새 탭으로 열립니다. 이 reviewnary 화면은 그대로 남아 있으니, 확인 후 다시 이 탭으로 돌아오세요.",
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
    hint: "방금 만든 애플리케이션이 사용 가능한 상태인지 확인합니다. 화면에 '다시사용' 버튼이 보이면 직접 눌러 활성화하세요. 버튼이 보이지 않더라도 reviewnary가 활성 상태라고 단정하지는 않습니다 — 확인 후 다음으로 진행하세요.",
  },
  {
    id: "select_api_group",
    title: "주문 조회에 필요한 API 그룹 추가",
    hint: "애플리케이션에 상품·주문(판매자) 관련 API 그룹을 추가/허용합니다. 정확한 그룹 이름은 화면에서 '주문'·'판매자'가 포함된 항목을 찾아 선택하세요.",
  },
  {
    id: "register_call_ip",
    title: "API 호출 IP에 reviewnary 고정 IP 등록",
    hint: "reviewnary는 고정된 서버 IP에서 NAVER API를 호출합니다. 애플리케이션의 'API 호출 IP' 설정에 아래에 표시된 고정 IP를 그대로 등록하세요. 표시된 IP가 없으면 아직 준비 중이므로 이 단계는 건너뛰고 담당자에게 문의하세요. (등록하지 않으면 첫 주문 수집이 호출 IP 오류로 실패할 수 있습니다.)",
  },
  {
    id: "view_credentials",
    title: "애플리케이션 ID와 시크릿 확인",
    hint: "애플리케이션 상세 화면에서 애플리케이션 ID와 시크릿(클라이언트 시크릿)을 확인합니다. 시크릿은 화면에서 눈으로 확인만 하고, 다음 단계에서 reviewnary 보안 입력란에 직접 입력하세요.",
  },
  {
    id: "return_to_sellerops",
    title: "reviewnary로 돌아와 입력",
    hint: "확인한 애플리케이션 ID와 시크릿을 들고 이 탭으로 돌아옵니다. 아래 '발급을 완료했어요'를 누르면 reviewnary 보안 입력 단계로 넘어갑니다.",
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
    hint: "이 애플리케이션이 사용 가능한 상태인지 먼저 확인합니다. 화면에 '다시사용' 버튼이 보이면 앱이 일시중단된 것이니 직접 눌러 활성화하세요. 버튼이 보이지 않더라도 reviewnary가 활성 상태라고 단정하지는 않습니다 — 확인 후 다음으로 진행하세요.",
  },
  {
    id: "verify_api_group",
    title: "주문 조회 API 그룹 확인",
    hint: "이 애플리케이션에 상품·주문(판매자) 관련 API 그룹이 포함되어 있는지 확인하고, 없으면 추가합니다.",
  },
  {
    id: "register_call_ip",
    title: "API 호출 IP에 reviewnary 고정 IP 등록",
    hint: "reviewnary는 고정된 서버 IP에서 NAVER API를 호출합니다. 애플리케이션의 'API 호출 IP' 설정에 아래에 표시된 고정 IP가 등록되어 있는지 확인하고, 없으면 그대로 등록하세요. 표시된 IP가 없으면 아직 준비 중이므로 이 단계는 건너뛰고 담당자에게 문의하세요.",
  },
  {
    id: "view_credentials",
    title: "애플리케이션 ID와 시크릿 확인",
    hint: "애플리케이션 상세에서 애플리케이션 ID와 시크릿을 확인합니다. 시크릿은 눈으로만 확인하고, reviewnary 보안 입력란에 직접 입력하세요. 확인이 어려우면 시크릿 재발급이 필요할 수 있습니다.",
  },
] as const;

/**
 * Documented public entry to the Coupang seller center (WING). A plain public URL — no deep-link, no
 * account context. The text fallback opens this in a NEW TAB; the seller navigates to the Open API key
 * issuance area themselves. SellerOps never scripts or reads the WING page.
 */
export const COUPANG_WING_URL = "https://wing.coupang.com/";

/**
 * Coupang WING Open API key text-fallback checklist — shown when guided in-screen help is impossible
 * (no local agent), when the seller switches to text, or after they end the walk. The seller issues the
 * key entirely at WING and returns to paste the three values into the masked form. SellerOps never
 * scripts WING, never presses a control, and never reads a key value here.
 *
 * **The order is the MEASURED order.** Until 2026-08-23 this list was the pre-measurement plan, and it
 * survived every correction the guided walk received because nothing pinned it: the Action Window copy is
 * held character-for-character against the runtime by a cross-stack parity test, and this checklist was
 * held against nothing. It carried the three claims five live READ_ONLY walks refuted
 * (`collector/src/action-window/coupang-issuance/coupang-issuance-stages.ts`):
 *
 *   1. It put `자체개발` third, as the 연동 방식 choice. The screen there is 사용 목적, which offers
 *      `OPEN API` (the default) and `플레이오토 웹 솔루션` — no 자체개발. The real control is
 *      `자체개발(직접입력)` under 업체 입력 방식, five screens later.
 *   2. It asked for 업체명 / URL / 호출 IP before 발급. Those fields belong to the vendor-method screen and
 *      appear only after `자체개발(직접입력)` is chosen — which is after the terms consent.
 *   3. It called 발급 the key-creating press and then told the seller to copy their keys. 발급 opens the
 *      purpose screen; `약관 동의 및 Key 발급받기` opens the vendor-method screen (pressed on two live walks,
 *      issued nothing); the key is created by that screen's `확인`. The seller was being told to copy keys
 *      that did not exist yet.
 *
 * The step ids are checklist state only and never surfaced, EXCEPT `register_call_ip`, which
 * {@link CoupangIssuanceTutorial} keys the shared {@link AdvertisedCallIpPanel} off. Labels stay hedged —
 * exact WING menu/button names differ by screen version.
 */
export const COUPANG_ISSUANCE_TUTORIAL: readonly TutorialStep[] = [
  {
    id: "open_wing",
    title: "쿠팡 윙 열기",
    hint: "아래 버튼을 누르면 쿠팡 판매자센터(쿠팡 윙)가 새 탭으로 열립니다. 이 reviewnary 화면은 그대로 남아 있으니, 확인 후 다시 이 탭으로 돌아오세요.",
    opensCenter: true,
  },
  {
    id: "reach_open_api",
    title: "오픈API 키 발급 화면으로 이동",
    hint: "쿠팡 윙에서 '판매자정보'의 오픈API 키 발급 영역으로 이동합니다. 정확한 메뉴 이름은 화면 버전에 따라 다를 수 있으니 '오픈API'·'키 발급'이 포함된 항목을 찾으세요.",
  },
  {
    id: "reveal_form",
    title: "'API Key 발급 받기' 직접 누르기",
    hint: "'API Key 발급 받기'를 직접 누르세요. 이 버튼은 키를 만들지 않고 사용 목적을 고르는 화면만 엽니다. 아직 계정에 바뀌는 것은 없습니다.",
  },
  {
    id: "confirm_purpose",
    title: "사용 목적 확인 후 '확인' 누르기",
    hint: "사용 목적이 'OPEN API'인지 확인하세요 — 기본으로 선택되어 있습니다. 이 화면에는 '자체개발' 항목이 없습니다(그 선택은 뒤에 따로 나옵니다). 확인했으면 '확인'을 누르세요. 이 버튼도 키를 만들지 않고 약관 화면을 엽니다.",
  },
  {
    id: "terms_consent",
    title: "약관 2건 직접 읽고 동의",
    hint: "약관을 직접 읽고 판단하신 뒤 동의 체크박스 2개를 선택하세요. reviewnary는 약관을 읽지도, 대신 동의하지도 않습니다.",
  },
  {
    id: "terms_issue_button",
    title: "'약관 동의 및 Key 발급받기' 직접 누르기",
    hint: "'약관 동의 및 Key 발급받기'를 직접 누르세요. 버튼 이름과 달리 이 단계에서는 키가 발급되지 않고, 업체 정보를 입력하는 화면이 열립니다(라이브 진행 2회에서 그렇게 확인되었습니다). 여기까지는 취소해도 계정에 남는 것이 없습니다.",
  },
  {
    id: "vendor_method",
    title: "입력 방식 '자체개발(직접입력)' 선택",
    hint: "'업체 입력 방식'에서 '자체개발(직접입력)'을 선택하세요. 솔루션사(대행) 연동이 아니라 내 시스템에서 직접 호출하는 방식입니다. 선택하면 URL과 IP 주소 입력란이 더 나타납니다(업체명 칸은 이미 화면에 있습니다).",
  },
  {
    id: "register_call_ip",
    title: "업체명·URL 입력 + 호출 IP 등록",
    hint: "업체명과 URL을 입력하고, 'IP 주소'에 아래 reviewnary 고정 IP를 넣은 뒤 옆의 '추가'까지 누르세요 — '추가'를 누르지 않으면 IP가 등록되지 않고, 나중에 첫 주문 수집이 호출 IP 오류로 실패합니다. 아래에 표시된 IP가 없으면 아직 준비 중이므로 담당자에게 문의하세요.",
  },
  {
    id: "issue_checkpoint",
    title: "'확인' 직접 누르기 (여기서 키가 발급됩니다)",
    hint: "입력한 내용을 한 번 더 확인한 뒤 '확인'을 직접 누르세요. ⚠ 이 버튼에서 실제 API 키가 발급되어 쿠팡 계정 상태가 바뀝니다(지우려면 나중에 별도의 삭제 작업이 필요합니다). reviewnary는 대신 누르지 않습니다 — 발급은 반드시 판매자 본인이 진행합니다.",
  },
  {
    id: "copy_keys",
    title: "액세스 키·시크릿 키·업체코드 복사",
    hint: "발급된 액세스 키(Access Key), 시크릿 키(Secret Key), 업체코드(Vendor ID)를 복사합니다. 시크릿 키는 발급 시 한 번만 표시되니 안전하게 보관하세요. 값은 눈으로 확인·복사만 하고, 다음 단계에서 reviewnary 보안 입력란에 직접 붙여넣으세요.",
  },
  {
    id: "return_to_sellerops",
    title: "reviewnary로 돌아와 입력",
    hint: "복사한 세 값을 들고 이 탭으로 돌아옵니다. 아래 '발급을 완료했어요'를 누르면 reviewnary 보안 입력 단계로 넘어갑니다.",
  },
] as const;

/**
 * Coupang WING Open API key RENEWAL text-fallback checklist. Same pattern as {@link COUPANG_ISSUANCE_TUTORIAL}
 * but WORDED FOR RENEWAL (the seller already has a connected key that is expiring): reach the Open API key
 * screen, check the current key's 유효기간, click 재발급 THEMSELVES (SellerOps never re-issues), copy the NEW
 * Access Key / Secret Key / Vendor ID and note the new expiry date, then return to SellerOps to paste them
 * into the masked REPLACE form. Progress is transient checkbox state that NEVER holds a key value.
 */
export const COUPANG_RENEWAL_TUTORIAL: readonly TutorialStep[] = [
  {
    id: "open_wing",
    title: "쿠팡 윙 열기",
    hint: "아래 버튼을 누르면 쿠팡 판매자센터(쿠팡 윙)가 새 탭으로 열립니다. 이 reviewnary 화면은 그대로 남아 있으니, 확인 후 다시 이 탭으로 돌아오세요.",
    opensCenter: true,
  },
  {
    id: "reach_open_api",
    title: "오픈API 키 발급 화면으로 이동",
    hint: "쿠팡 윙에서 '판매자정보'의 오픈API 키 발급 영역으로 이동합니다. 정확한 메뉴 이름은 화면 버전에 따라 다를 수 있으니 '오픈API'·'키 발급'이 포함된 항목을 찾으세요.",
  },
  {
    id: "check_expiry",
    title: "현재 키의 유효기간 확인",
    hint: "현재 발급된 키의 유효기간(만료일)을 확인합니다. 얼마 남지 않았거나 이미 지났다면 새 키를 재발급해야 합니다. 이 만료일은 뒤에서 reviewnary에 직접 입력할 값이니 함께 확인해 두세요.",
  },
  {
    id: "reissue_checkpoint",
    title: "재발급 버튼 직접 누르기",
    hint: "입력한 내용을 한 번 더 확인한 뒤, 재발급 버튼을 직접 누르세요. reviewnary는 대신 재발급하지 않습니다 — 재발급은 반드시 판매자 본인이 진행합니다.",
  },
  {
    id: "copy_keys",
    title: "새 액세스 키·시크릿 키·업체코드 복사",
    hint: "재발급된 새 액세스 키(Access Key), 시크릿 키(Secret Key), 업체코드(Vendor ID)를 복사합니다. 시크릿 키는 재발급 시 한 번만 표시되니 안전하게 보관하세요. 값은 눈으로 확인·복사만 하고, 다음 단계에서 reviewnary 보안 입력란에 직접 붙여넣으세요.",
  },
  {
    id: "return_to_sellerops",
    title: "reviewnary로 돌아와 새 키 입력",
    hint: "복사한 새 값과 확인한 만료일을 들고 이 탭으로 돌아옵니다. 아래 '재발급을 완료했어요'를 누르면 새 키로 교체하는 입력 단계로 넘어갑니다.",
  },
] as const;
