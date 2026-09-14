// FE-owned copy registry for the Action Window.
//
// Runtime sends only semantic identifiers (copy keys, channelCode, BlockerCode,
// enums). THIS module — owned by the frontend — maps them to final Korean copy,
// button labels, icons, and tone. Unknown copy keys render a safe fallback and
// never surface raw identifiers as if they were prose.

import type { BlockerCode, CommandType, CopyParams, RunStatus, StepStatus } from "./contract";
import type { CommandRejectionReason, SourceConnection } from "./source";

/** Shown when a copy key has no FE mapping yet. Never the raw key. */
export const COPY_FALLBACK = "안내를 준비하고 있어요";

// Semantic copy key → Korean copy. Values may contain {param} placeholders that
// are filled from the sanitized primitive copyParams.
const COPY: Record<string, string> = {
  "actionWindow.review.run": "리뷰 내려받기",
  "actionWindow.review.prepare": "세션 준비",
  "actionWindow.review.openSurface": "판매자센터 화면 열기",
  "actionWindow.review.selectAndDownload": "마켓 선택 후 내려받기",
  "actionWindow.review.processDownstream": "정리·분석",

  // NAVER Commerce API-center issuance guidance (Action Window). Shared step copy keys with the collector
  // runtime — the runtime sends only the key, this FE owns the wording. Hedged, position/role based: exact
  // NAVER menu/button labels differ by screen version, so no label is asserted as fact. SellerOps never
  // logs in, clicks, or reads the credential — the seller performs each step in the guided window.
  "actionWindow.issuance.run": "API 발급 화면 안내",
  "actionWindow.issuance.reachApplications": "애플리케이션 관리 영역으로 이동",
  "actionWindow.issuance.createApp": "애플리케이션 만들기 (스토어당 1개)",
  "actionWindow.issuance.openApp": "발급한 애플리케이션 열기",
  "actionWindow.issuance.appUsageCheck": "애플리케이션 상태 확인",
  "actionWindow.issuance.appUsageCheckNew": "생성 직후 상태 확인",
  "actionWindow.issuance.apiGroup": "주문·판매자 관련 API 그룹 추가",
  "actionWindow.issuance.applicationId": "애플리케이션 ID 복사",
  "actionWindow.issuance.applicationSecret": "애플리케이션 시크릿 확인·복사",
  "actionWindow.issuance.return": "reviewnary로 돌아와 입력",

  // Coupang WING Open API key issuance guidance (Action Window). Shared step copy keys with the collector
  // runtime — the runtime sends only the key, this FE owns the wording. Hedged, position/role based: exact
  // WING menu/button labels differ by screen version, so no label is asserted as fact. SellerOps never logs
  // in, clicks, or reads a key value; the seller performs each step in the guided WING window.
  "actionWindow.coupangIssuance.run": "쿠팡 Open API 키 발급 화면 안내",
  "actionWindow.coupangIssuance.reachOpenApi": "판매자정보 › 오픈API 키 발급으로 이동",
  // The 8 steps below are the MEASURED flow (five granted READ_ONLY runs + a dev-host guided walk,
  // 2026-08-10): 발급 → 사용 목적(OPEN API, 기본 선택) → 확인 → 약관 동의 2건 → '약관 동의 및 Key 발급받기'.
  // That last press does NOT create the key — refuted live on 2026-08-12, see
  // `WING_KEY_CREATION_CONTROL_REFUTATION`. An integration-method screen follows it and the key is issued
  // there; the walk does not model that screen yet, so it stops one step short and says so.
  // `selfDev` / `vendorInfo` / `callIp` were removed with the screens they named — WING shows no 자체개발
  // option, and 업체명 / 호출 IP never appear in this flow.
  "actionWindow.coupangIssuance.revealForm": "'API Key 발급 받기' 직접 누르기",
  "actionWindow.coupangIssuance.confirmPurpose": "사용 목적 확인 후 '확인' 직접 누르기",
  "actionWindow.coupangIssuance.termsConsent": "약관 2건 직접 읽고 동의",
  // The `(키 생성)` qualifier was refuted on 2026-08-12 and removed. It sat in the step LIST while the detail
  // string below said the opposite, so the seller read both claims on one screen.
  "actionWindow.coupangIssuance.issueCheckpoint": "'약관 동의 및 Key 발급받기' 직접 누르기",
  "actionWindow.coupangIssuance.vendorMethod": "입력 방식 '자체개발(직접입력)' 직접 선택",
  // The `(키 발급)` qualifier is on THIS step, and it is measured. It sat on `issueCheckpoint` until 2026-08-12
  // asserted from a button label, was refuted when that button was pressed and issued nothing, and belongs to
  // the control that actually does it.
  "actionWindow.coupangIssuance.vendorConfirm": "'확인' 직접 누르기 (키 발급)",
  // The walk's LAST step, and its name has followed the step twice. It said "액세스 키·시크릿 키·업체코드 복사"
  // while the panel asked the seller to transcribe a 40-character secret by hand, then "SellerOps로 돌아가기"
  // while the decision lived in the other tab. The decision is now made where the values are, so the step is
  // the consent — and the return is the outcome panel's button, after the credential is actually stored.
  "actionWindow.coupangIssuance.copyKeys": "reviewnary에 연결하기",

  // Coupang WING Open API key RENEWAL guidance (Action Window). Entered from an already-connected account
  // whose credential is expiring. The renewal step plan reuses the issuance runtime but highlights 유효기간
  // (check the current key's expiry) + 재발급 (with the same human checkpoint before pressing 재발급). Same
  // shared step copy keys with the collector runtime — the runtime sends only the key, this FE owns the
  // wording; the seller performs each step in the guided WING window; SellerOps reads no key value.
  "actionWindow.coupangRenewal.run": "쿠팡 API 키 갱신 화면 안내",
  "actionWindow.coupangRenewal.reachOpenApi": "판매자정보 › 오픈API 키 발급으로 이동",
  "actionWindow.coupangRenewal.checkExpiry": "현재 키의 유효기간 확인",
  "actionWindow.coupangRenewal.reissueCheckpoint": "재발급 버튼 직접 누르기",
  "actionWindow.coupangRenewal.copyKeys": "새 액세스 키·시크릿 키·업체코드 복사",
  "actionWindow.coupangRenewal.return": "reviewnary로 돌아와 새 키 입력",

  // Coupang WING 고객문의 답변 guidance (Action Window). Unlike the issuance walk, NOTHING on the 고객문의
  // screen has been measured, so this run highlights nothing and asserts no label — it opens the screened
  // WING window, rests while the seller navigates and posts, and records what the seller reports. Wording
  // must never read as 발송/전송/등록 by SellerOps: the seller posts the reply themselves.
  "actionWindow.coupangInquiryReply.run": "쿠팡 고객문의 답변 화면 안내",
  "actionWindow.coupangInquiryReply.openWing": "쿠팡 윙 창 열기",
  "actionWindow.coupangInquiryReply.reachScreen": "고객문의 화면으로 직접 이동",
  "actionWindow.coupangInquiryReply.userReply": "답변을 직접 등록",

  // Coupang WING 상품평 읽기 (Action Window). **이 네 키에는 FE 매핑이 없었다** — 그래서 이 lane의 모든
  // 단계가 `COPY_FALLBACK`, 즉 「안내를 준비하고 있어요」로 렌더됐고, 체크포인트 카드는 그 문장을 20px
  // 굵은 지시문으로 올려 놓고 그 아래 [확인 완료]를 놓았다(실측 2026-09-14). 판매자가 수집 내내 읽은
  // 것은 안내가 아니라 안내가 없다는 말이었다. 문장은 판매자가 <b>직접 하는 일</b>로 적는다 —
  // reviewnary는 이 화면에서 로그인·클릭·입력을 하지 않는다.
  "actionWindow.reviewAcquisition.run": "쿠팡 상품평 가져오기",
  "actionWindow.reviewAcquisition.openList": "쿠팡 창에서 상품평 목록 열기",
  "actionWindow.reviewAcquisition.confirmPage": "열린 상품평 목록 확인",
  "actionWindow.reviewAcquisition.handoff": "가져온 상품평 저장",
};

// Per-step FULL instruction for the guided issuance walkthrough — so the SellerOps screen is self-sufficient
// and the seller does not have to decode the in-NAVER highlight (which only points at a control). Grounded in
// the static issuance/existing-app tutorials (`lib/guidedConnection/tutorial.ts`); same hedged, position/role
// wording (exact NAVER labels differ by screen version, so none is asserted as fact) and the same privacy
// invariant — SellerOps never logs in, clicks, or reads the credential value; the seller performs each step.
// Keyed by the SAME `actionWindow.issuance.*` copy keys the runtime emits; an unmapped step renders no detail.
const ISSUANCE_STEP_DETAIL: Record<string, string> = {
  "actionWindow.issuance.run":
    "reviewnary가 화면에서 어디를 봐야 하는지 안내합니다. 각 단계는 열린 NAVER 창에서 직접 진행하시고, 이 화면의 설명을 따라가세요. reviewnary는 로그인·클릭·입력을 하지 않고 어떤 값도 읽지 않습니다.",
  "actionWindow.issuance.reachApplications":
    "애플리케이션(앱)을 만들고 관리하는 영역으로 이동하세요. 보통 '내 애플리케이션' 또는 애플리케이션 목록 형태의 메뉴입니다.",
  "actionWindow.issuance.createApp":
    "새 애플리케이션을 하나 만드세요. 스토어당 애플리케이션은 1개만 만들 수 있고 삭제할 수 없으니, 이미 만든 앱이 있으면 새로 만들지 말고 그 앱을 사용하세요.",
  "actionWindow.issuance.openApp":
    "이미 만들어 둔 애플리케이션의 상세 화면을 여세요. 새 애플리케이션을 만들지 마세요 — 스토어당 1개만 가능하고 삭제할 수 없습니다.",
  // Text-only usage-state advisory (no highlight): the seller checks their app is usable BEFORE the API-group
  // step, so a suspended app doesn't fail later. SellerOps does not read the app's state and never asserts it is
  // active — absence of a reactivate button is NOT treated as active. The seller reactivates it themselves if shown.
  "actionWindow.issuance.appUsageCheck":
    "애플리케이션 상태를 확인해 주세요. 화면에 '다시사용' 버튼이 보인다면 직접 눌러 앱을 활성화해 주세요. 버튼이 보이지 않더라도 reviewnary가 활성 상태라고 단정하지 않습니다. 확인했다면 다음으로 진행해 주세요.",
  "actionWindow.issuance.appUsageCheckNew":
    "방금 만든 애플리케이션의 상태를 확인해 주세요. 새로 만든 앱은 보통 바로 사용할 수 있지만, 혹시 화면에 '다시사용' 버튼이 보이면 직접 눌러 활성화해 주세요. 버튼이 보이지 않더라도 reviewnary가 활성 상태라고 단정하지 않습니다. 확인했다면 다음으로 진행해 주세요.",
  "actionWindow.issuance.apiGroup":
    "이 애플리케이션에 상품·주문(판매자) 관련 API 그룹이 포함돼 있는지 확인하고, 없으면 추가하세요. 정확한 그룹 이름은 화면마다 다를 수 있으니 '주문'·'판매자'가 포함된 항목을 찾아 선택하면 됩니다.",
  "actionWindow.issuance.applicationId":
    "애플리케이션 ID를 복사해 주세요. 표시된 애플리케이션 ID 행에서 값을 직접 복사하시면 됩니다. reviewnary는 이 값을 읽지 않습니다 — 복사는 직접 하시고, 마지막에 reviewnary 보안 입력란에 붙여넣으세요.",
  "actionWindow.issuance.applicationSecret":
    "애플리케이션 시크릿을 확인하고 복사해 주세요. 표시된 '보기/복사' 컨트롤에서 시크릿을 직접 확인·복사하시면 됩니다. reviewnary는 시크릿 값도, 클립보드도 읽지 않습니다. 확인이 어려우면 시크릿 재발급이 필요할 수 있습니다.",
  "actionWindow.issuance.return":
    "두 값을 복사했다면 reviewnary로 돌아가 주세요. 안내가 끝나면 연결 정보 입력 화면으로 이동합니다.",

  // Coupang WING Open API key issuance — FULL per-step instruction. Same hedged, position/role wording
  // (exact WING labels differ by screen version, so none is asserted as fact) and the same privacy
  // invariant — SellerOps never logs in, clicks, or reads a key value; the seller performs each step and
  // clicks 발급 themselves. Keyed by the SAME `actionWindow.coupangIssuance.*` keys the runtime emits.
  "actionWindow.coupangIssuance.run":
    "reviewnary가 화면에서 어디를 봐야 하는지 안내합니다. 각 단계는 열린 쿠팡 윙 창에서 직접 진행하시고, 이 화면의 설명을 따라가세요. reviewnary는 로그인·클릭·입력을 하지 않고 어떤 값도 읽지 않습니다.",
  // VERBATIM from `OPERATOR_STEP_LABELS` in collector/src/action-window/coupang-wing-issuance-driver.ts —
  // the WING-resident panel copy an operator read on screen and confirmed correct during the 2026-08-10
  // dev-host guided walk. Reused rather than rewritten: two places wording the same step differently is how
  // the tutorial and the runtime drift, and this copy is the half that has actually been seen live.
  //
  // The claim is ENFORCED, not just stated: `collector/test/crossstack/coupang-issuance-fe-copy-parity.test.ts`
  // compares these five strings character-for-character against `OPERATOR_STEP_LABELS`. It exists because the
  // comment was already false — three of them were the PRE-auto-advance wording, so the SellerOps tab told a
  // seller to press a button that had stopped being the advance mechanism. Edit either side and both must move.
  "actionWindow.coupangIssuance.reachOpenApi":
    "WING에 로그인한 뒤 '오픈API 키 발급' 페이지로 이동하세요. 도착하면 자동으로 넘어갑니다.",
  "actionWindow.coupangIssuance.revealForm":
    "'API Key 발급 받기'를 직접 누르세요. 키는 아직 만들어지지 않고 사용 목적 화면만 열립니다. 화면이 열리면 자동으로 넘어갑니다.",
  "actionWindow.coupangIssuance.confirmPurpose":
    "사용 목적이 'OPEN API'인지 확인하고(기본값입니다) '확인'을 직접 누르세요. 이 버튼도 키를 만들지 않고 약관 화면을 엽니다. 화면이 열리면 자동으로 넘어갑니다.",
  "actionWindow.coupangIssuance.termsConsent":
    "약관을 직접 읽고 판단하신 뒤 동의 체크박스 2개를 선택하세요. reviewnary는 약관을 읽지도, 대신 동의하지도, 체크하지도 않습니다. 2개가 모두 선택되면 자동으로 넘어갑니다(선택 여부는 저장·전송하지 않습니다).",
  "actionWindow.coupangIssuance.issueCheckpoint":
    "'약관 동의 및 Key 발급받기'를 직접 누르세요 — reviewnary는 이 버튼을 절대 누르지 않습니다. 이 버튼에서는 키가 발급되지 않고 연동 방식을 고르는 화면이 열립니다(live walk 2회에서 그렇게 보고되었습니다. reviewnary는 키 발급 여부를 확인할 수 없습니다). 그 화면이 열리면 자동으로 넘어갑니다.",
  "actionWindow.coupangIssuance.vendorMethod":
    "입력 방식에서 '자체개발(직접입력)'을 직접 선택하세요 — reviewnary는 선택하지 않습니다. 선택하면 URL · IP 주소 입력란이 더 나타납니다(업체명은 이미 화면에 있습니다). 업체명 · URL을 입력하고 IP는 '추가'까지 누르면 자동으로 넘어갑니다(reviewnary는 입력란이 비었는지만 보고 값은 읽지 않습니다. 넘어가지 않으면 아래 버튼을 누르세요).",
  "actionWindow.coupangIssuance.vendorConfirm":
    "업체명 · URL을 입력하고, IP 주소는 입력한 뒤 옆의 '추가'를 눌러 등록하세요 — 추가하지 않으면 IP가 등록되지 않습니다. 그 다음 '확인'을 직접 누르세요. ⚠ 여기서 실제 API 키가 발급되어 라이브 계정 상태가 바뀝니다(지우려면 나중에 별도의 삭제 작업이 필요합니다). reviewnary는 이 버튼을 절대 누르지 않고, 입력란에 아무것도 쓰지 않습니다. 키가 화면에 표시되면 자동으로 넘어갑니다.",
  "actionWindow.coupangIssuance.copyKeys":
    "reviewnary는 이 화면에 표시된 업체코드·Access Key·Secret Key만 읽어 곧바로 암호화해 저장하고, 저장한 뒤 연결이 되는지 한 번만 확인합니다. 값은 reviewnary 화면에 표시되지 않고, 기록에도 남지 않습니다. 아래 'reviewnary에 연결하기'를 누르시기 전에는 아무것도 읽지 않습니다. 직접 입력하고 싶으시면 그 아래 버튼을 누르세요.",

  // Coupang 고객문의 답변 — FULL per-step instruction. Deliberately vaguer than the issuance walk about
  // WHERE things are: no sitting has measured this screen, so naming a menu path would be asserting a
  // layout nobody has seen. The seller knows their own WING; SellerOps holds the draft and stays out of it.
  "actionWindow.coupangInquiryReply.run":
    "reviewnary가 쿠팡 윙 창을 열어 드립니다. 답변 초안은 이 화면에 있으니 보고 쓰시면 됩니다. 등록은 셀러님이 직접 하시고, reviewnary는 대신 입력하거나 등록하지 않습니다.",
  "actionWindow.coupangInquiryReply.openWing":
    "쿠팡 윙 창을 엽니다. 로그인은 셀러님이 직접 하세요 — reviewnary는 로그인하지 않습니다.",
  "actionWindow.coupangInquiryReply.reachScreen":
    "윙에서 이 문의가 있는 고객문의 화면으로 직접 이동하세요. 도착하셨으면 아래에서 알려 주세요. reviewnary는 화면을 읽지 않기 때문에 도착 여부를 스스로 알 수 없습니다.",
  "actionWindow.coupangInquiryReply.userReply":
    "옆의 답변 초안을 참고해 답변을 직접 등록하세요 — reviewnary는 등록 버튼을 누르지 않습니다. 마치신 뒤 결과를 알려 주시면 그대로 기록합니다(reviewnary가 등록을 확인한 것은 아닙니다).",
};

/** The FULL per-step instruction for a guided issuance step, or null when the step has no detail mapping. */
export function issuanceStepDetail(copyKey: string | null | undefined): string | null {
  if (!copyKey) return null;
  return ISSUANCE_STEP_DETAIL[copyKey] ?? null;
}

// Coupang WING key RENEWAL — FULL per-step instruction. Same hedged, position/role wording (exact WING
// labels differ by screen version) and the same privacy invariant — SellerOps never logs in, clicks, or
// reads a key value; the seller checks 유효기간 and clicks 재발급 themselves. Keyed by the SAME
// `actionWindow.coupangRenewal.*` keys the runtime emits; an unmapped step renders no detail.
const RENEWAL_STEP_DETAIL: Record<string, string> = {
  "actionWindow.coupangRenewal.run":
    "현재 키의 유효기간이 다가와 새 키로 갱신하는 안내입니다. 각 단계는 열린 쿠팡 윙 창에서 직접 진행하시고, 이 화면의 설명을 따라가세요. reviewnary는 로그인·클릭·입력을 하지 않고 어떤 값도 읽지 않습니다.",
  "actionWindow.coupangRenewal.reachOpenApi":
    "쿠팡 윙에서 '판매자정보'의 오픈API 키 발급 영역으로 이동하세요. 정확한 메뉴 이름은 화면 버전에 따라 다를 수 있으니 '오픈API'·'키 발급'이 포함된 항목을 찾아 주세요.",
  "actionWindow.coupangRenewal.checkExpiry":
    "현재 발급된 키의 유효기간(만료일)을 확인해 주세요. 유효기간이 얼마 남지 않았거나 이미 지났다면 새 키를 재발급해야 합니다. 이 만료일은 뒤에서 직접 입력하실 값이니 함께 확인해 두세요. reviewnary는 이 화면의 값을 읽지 않습니다.",
  "actionWindow.coupangRenewal.reissueCheckpoint":
    "이제 재발급 버튼을 누르기 직전 단계입니다. 재발급 버튼은 반드시 직접 눌러 주세요 — reviewnary는 대신 재발급하지 않습니다. 재발급하면 새 키가 생성되며, 기존 키는 쿠팡 정책에 따라 처리됩니다.",
  "actionWindow.coupangRenewal.copyKeys":
    "재발급된 새 액세스 키(Access Key), 시크릿 키(Secret Key), 업체코드(Vendor ID)를 직접 복사하세요. 시크릿 키는 재발급 시 한 번만 표시되니 안전하게 보관하세요. reviewnary는 이 값들을 읽지 않습니다 — 복사는 직접 하시고, 마지막에 reviewnary 보안 입력란에 붙여넣으세요.",
  "actionWindow.coupangRenewal.return":
    "새 키 세 값과 확인한 만료일을 들고 reviewnary로 돌아와 주세요. 안내가 끝나면 새 키로 교체하는 입력 화면으로 이동합니다.",
};

/** The FULL per-step instruction for a guided renewal step, or null when the step has no detail mapping. */
export function renewalStepDetail(copyKey: string | null | undefined): string | null {
  if (!copyKey) return null;
  return RENEWAL_STEP_DETAIL[copyKey] ?? null;
}

function interpolate(template: string, params?: CopyParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_m, key: string) => {
    const v = params[key];
    return v === undefined ? "" : String(v);
  });
}

/** Resolve a copy key to final FE copy, or a safe fallback for an unknown key. */
export function resolveCopy(key: string, params?: CopyParams): string {
  const template = COPY[key];
  if (template === undefined) return COPY_FALLBACK;
  return interpolate(template, params);
}

/** True when a copy key has an FE mapping (FE can distinguish key vs prose). */
export function hasCopy(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(COPY, key);
}

// Safe channel codes → display labels (FE-owned). An unknown code renders a safe
// user-facing fallback — never the raw semantic code.
export const CHANNEL_FALLBACK = "알 수 없는 채널";
const CHANNEL_LABELS: Record<string, string> = {
  esm_plus: "ESM (지마켓·옥션)",
  coupang: "쿠팡",
};
export function channelLabel(code: string): string {
  return CHANNEL_LABELS[code] ?? CHANNEL_FALLBACK;
}

export type StatusTone = "active" | "human" | "neutral" | "good" | "bad";
// Status is rendered as a text-only tone chip (admin-console style) — no glyph.
export interface StatusView {
  label: string;
  tone: StatusTone;
}

// Exhaustive: every RunStatus must have a view (a missing key is a compile error).
const RUN_STATUS_VIEW: Record<RunStatus, StatusView> = {
  PREPARING: { label: "준비 중", tone: "active" },
  RUNNING: { label: "진행 중", tone: "active" },
  WAITING_FOR_HUMAN: { label: "확인 필요", tone: "human" },
  PAUSED: { label: "일시정지", tone: "neutral" },
  PROCESSING: { label: "처리 중", tone: "active" },
  COMPLETED: { label: "완료", tone: "good" },
  FAILED: { label: "실패", tone: "bad" },
  CANCELLED: { label: "취소됨", tone: "neutral" },
};
export function runStatusView(status: RunStatus): StatusView {
  return RUN_STATUS_VIEW[status];
}

const STEP_STATUS_VIEW: Record<StepStatus, { label: string }> = {
  PENDING: { label: "대기" },
  PREPARING: { label: "준비 중" },
  READY: { label: "준비됨" },
  AWAITING_USER: { label: "확인 필요" },
  OBSERVING: { label: "확인 중" },
  PROCESSING: { label: "처리 중" },
  COMPLETED: { label: "완료" },
  FAILED: { label: "실패" },
  SKIPPED: { label: "건너뜀" },
};
export function stepStatusView(status: StepStatus): { label: string } {
  return STEP_STATUS_VIEW[status];
}

// Exhaustive command labels — the button text FE renders for each allowed command.
const COMMAND_LABEL: Record<CommandType, string> = {
  START_RUN: "시작",
  PAUSE_RUN: "일시정지",
  RESUME_RUN: "이어서 진행",
  CANCEL_RUN: "취소",
  FIND_CURRENT_STEP: "현재 단계 다시 찾기",
  SWITCH_TO_MANUAL: "직접 진행",
  REQUEST_STEP_RECHECK: "확인 완료",
  SET_GUIDANCE_ENABLED: "안내 켜기·끄기",
};
export function commandLabel(type: CommandType): string {
  return COMMAND_LABEL[type];
}

/**
 * **The label a command wears while the run is BLOCKED**, which is not the label it wears at a barrier.
 *
 * `REQUEST_STEP_RECHECK` does two jobs. At a barrier it means "I did it" — `확인 완료`. At a blocker it is the
 * recovery, and every blocker body in this file has been telling the seller to press **'다시 확인'** while the
 * button actually said 확인 완료: an instruction naming a control that is not on the screen. The bodies are the
 * ones that read correctly, so the button follows them.
 *
 * `SURFACE_CLOSED` goes further and says what pressing it DOES. The seller closed the marketplace window on
 * purpose; "다시 확인" invites them to re-check something, when what happens is that a window opens — and a
 * window opening unannounced is precisely the thing this runtime spent 2026-08-20 making impossible without an
 * explicit press. So the press has to be the one that says so.
 */
export function blockedCommandLabel(type: CommandType, blockerCode: BlockerCode | string | undefined): string {
  if (type !== "REQUEST_STEP_RECHECK") return commandLabel(type);
  return blockerCode === "SURFACE_CLOSED" ? "창 다시 열기" : "다시 확인";
}

export interface BlockerView {
  title: string;
  body: string;
}
// FE derives all blocker wording from BlockerCode (Runtime sends only the code).
const BLOCKER_VIEW: Record<BlockerCode, BlockerView> = {
  LOGIN_REQUIRED: { title: "다시 로그인이 필요해요", body: "판매자센터에 다시 로그인해 주세요." },
  UI_DRIFT: { title: "화면이 바뀐 것 같아요", body: "지금 화면을 확인해 주세요." },
  TARGET_NOT_FOUND: { title: "버튼을 찾지 못했어요", body: "화면을 확인한 뒤 다시 시도해 주세요." },
  TARGET_AMBIGUOUS: { title: "대상이 여러 개예요", body: "직접 알맞은 항목을 선택해 주세요." },
  SESSION_EXPIRED: { title: "세션이 만료됐어요", body: "다시 로그인해 주세요." },
  UNSUPPORTED_STATE: { title: "지원하지 않는 화면이에요", body: "직접 진행해 주세요." },
  DOWNLOAD_TIMEOUT: { title: "다운로드가 지연돼요", body: "잠시 후 다시 시도해 주세요." },
  ARTIFACT_INVALID: { title: "받은 파일을 확인할 수 없어요", body: "다시 내려받아 주세요." },
  INGEST_FAILED: { title: "저장 중 문제가 생겼어요", body: "잠시 후 다시 시도해 주세요." },
};

/**
 * Codes that exist in v2 but not v1. `BlockerCode` above is v1's (see `contract.ts`), and until the
 * import runs arrived every v2 code happened to be a v1 code too — so one map covered both by accident.
 * Adding `SCOPE_MISMATCH` to v2 ends that, and enumerating the difference here is what keeps the
 * accident from silently reappearing.
 */
const V2_ONLY_BLOCKER_VIEW: Record<string, BlockerView> = {
  SCOPE_MISMATCH: {
    title: "선택한 기간이 달라요",
    // Says exactly which repair is needed. Reported as "지원하지 않는 화면" the seller would go looking
    // for the wrong problem entirely.
    body: "가져오려는 기간과 화면에 선택된 기간이 일치하지 않아요. 날짜를 다시 선택해 주세요.",
  },
  // Guided Acquisition Reliability parks. Each was a place the guided import used to fall silent; each now
  // names the real screen and gives ONE recovery action. All recoverable — a 다시 확인 re-runs the guided
  // preparation (re-opening the 판매자센터 window if it was closed).
  SURFACE_OPEN_FAILED: {
    title: "판매자센터 창을 열지 못했어요",
    body: "'과거 리뷰 연동'을 다시 눌러 판매자센터 창을 열어 주세요.",
  },
  PREPARE_NOT_STARTED: {
    title: "시작이 지연되고 있어요",
    body: "잠시 기다린 뒤 '다시 확인'을 눌러 주세요.",
  },
  // Channel-NEUTRAL wording. It used to name 리뷰 관리 화면, which was true of the only run that raised it
  // (the NAVER guided import) and wrong for the Coupang guided walk, which now raises it when its watch for a
  // recognizable WING surface runs out. A blocker card that names the wrong screen sends the seller looking for
  // a different problem, so this says the one thing true of both: the screen is not ready yet, look again.
  SURFACE_SETTLE_TIMEOUT: {
    title: "화면이 아직 준비되지 않았어요",
    body: "판매자센터 화면이 모두 뜬 뒤 '다시 확인'을 눌러 주세요.",
  },
  GUIDANCE_PACK_REJECTED: {
    title: "안내를 불러오지 못했어요",
    body: "'다시 확인'을 눌러 안내를 다시 불러와 주세요.",
  },
  OVERLAY_MOUNT_FAILED: {
    title: "안내 표시를 그리지 못했어요",
    body: "'다시 확인'을 눌러 주세요.",
  },
  OVERLAY_NOT_VISIBLE: {
    title: "안내 표시가 보이지 않아요",
    body: "판매자센터 화면을 위로 올린 뒤 '다시 확인'을 눌러 주세요.",
  },
  SURFACE_CLOSED: {
    title: "판매자센터 창이 닫혔어요",
    // Names the button that is actually on the screen, and says the window opens only because they pressed it —
    // the runtime never re-opens a window the seller closed.
    body: "'창 다시 열기'를 누르면 판매자센터 창을 다시 열어 드릴게요. 누르기 전에는 창이 열리지 않아요.",
  },
  // The issuance walk refused to go on because it could not tell whether this account already has a key. The
  // copy says what SellerOps could not do and what clears it — it does NOT say "키가 없는 것 같아요", because
  // the whole point of this blocker is that nobody knows, and a guess in that direction creates a second key.
  // A `[쿠팡에서 보기]` press whose binding could not be turned into anything to look for. The 상품평 screen
  // has its own wording for this (see `locate/locateCopy.ts`); this is the generic fallback for any surface
  // that renders a blocker card without knowing which run raised it.
  LOCATE_TARGET_UNRESOLVED: {
    title: "요청이 만료됐어요",
    body: "'쿠팡에서 보기'를 다시 눌러 주세요.",
  },
  /**
   * TERMINAL, and the code that exposed the gap. On 2026-09-02 a guided import died of a driver fault and the
   * conversation card rendered `COPY_FALLBACK` — 「안내를 준비하고 있어요」 — over a run that had been dead for
   * minutes. A blocker with no entry here is a blocker the seller is told nothing true about, so every code in
   * `BLOCKER_CODES` now has one and a test holds that line.
   *
   * Says the two things that are true and no more: this run has stopped, and the recovery is a NEW run —
   * never a 다시 확인, which is the recoverable parks' repair and cannot restart a terminal one.
   */
  RUNTIME_FAULT: {
    title: "가져오기가 중단됐어요",
    body: "이번 가져오기는 더 진행할 수 없어요. '다시 시도'를 눌러 새로 시작해 주세요.",
  },
  ACQUISITION_TARGET_UNRESOLVED: {
    title: "요청이 만료됐어요",
    body: "리뷰 화면에서 다시 눌러 주세요.",
  },
  HANDOFF_REJECTED: {
    title: "도우미가 이 요청을 받지 못했어요",
    body: "'다시 시도'를 눌러 주세요.",
  },
  /**
   * The browser is signed into a DIFFERENT store than the one connected here. Named as a fact about the
   * account rather than about our software, because the repair is entirely the seller's: sign in as the store
   * they connected. Never "오류" — nothing is broken.
   */
  STORE_MISMATCH: {
    title: "연결한 판매자 계정과 다른 계정으로 로그인되어 있어요",
    body: "브라우저에서 이 채널에 연결한 판매자 계정으로 로그인한 뒤 '다시 시도'를 눌러 주세요.",
  },
  /**
   * We could not tell which store the screen belongs to — and "모른다" is not "틀렸다". So the copy asks them
   * to confirm rather than accusing them of being in the wrong place, and the run stopped before reading
   * anything either way.
   */
  STORE_UNRESOLVED: {
    title: "어느 판매자 계정인지 확인하지 못했어요",
    body: "안전을 위해 리뷰를 가져오지 않고 멈췄어요. 판매자 화면이 정상적으로 열려 있는지 확인한 뒤 '다시 시도'를 눌러 주세요.",
  },
  /**
   * The deterministic executor is not running. Nothing about the marketplace is wrong, and saying so matters:
   * the seller must not go looking at Coupang for a problem that is on their own machine.
   */
  EXECUTOR_UNAVAILABLE: {
    title: "가져오기 프로그램이 실행되고 있지 않아요",
    body: "판매자 화면에는 문제가 없어요. 프로그램을 실행한 뒤 '다시 시도'를 눌러 주세요.",
  },
  CREDENTIAL_STATE_UNKNOWN: {
    title: "발급된 키가 있는지 확인하지 못했어요",
    // Points at the WING window, because that is where the answer is and where the button now is. SellerOps
    // cannot read this one, so it does not pretend a re-check will settle it — for an ambiguous label it never
    // does, and that dead end is what this wording used to hide.
    body: "쿠팡 윙 창에서 업체코드·Access Key 칸을 직접 확인해 주세요. 키가 없다면 그 창의 '키가 없는 걸 확인했어요' 버튼으로 발급 안내를 시작할 수 있어요. 이미 키가 있다면 새로 발급하지 마세요.",
  },
};

/**
 * FE copy for a blocker code.
 *
 * <p>Falls back instead of returning `undefined`. The previous direct lookup meant a code the FE did not
 * know — a newer runtime, or a v2-only code like this — rendered a blank blocker card: the run is stopped
 * and the seller is told nothing, which is the worst of the available outcomes. The fallback says the run
 * stopped and that it needs a look, which is true of every blocker by definition.
 */
export function blockerView(code: BlockerCode | string): BlockerView {
  return (
    BLOCKER_VIEW[code as BlockerCode] ??
    V2_ONLY_BLOCKER_VIEW[code] ?? {
      title: "진행이 멈췄어요",
      body: "지금 화면을 확인해 주세요.",
    }
  );
}

// Connection resilience states (FE-2.5) — FE-owned copy for UI states the source
// reports; "connected" needs no banner so it has no entry here.
export interface ConnectionView {
  title: string;
  body: string;
  /** Reconnect button label — offline only (the terminal state where the
   *  transport has stopped auto-retrying); reconnecting has no manual action. */
  action?: string;
  /** Reconnect button label while a manual attempt is in flight. */
  actionPending?: string;
}
export const CONNECTION_VIEW: Record<Exclude<SourceConnection, "connected">, ConnectionView> = {
  offline: {
    title: "연결이 끊겼어요",
    // Offline is terminal (auto-retry exhausted / dormant), so we do NOT promise
    // another automatic attempt — recovery is the manual action below.
    body: "로컬 도우미와 연결이 끊겼어요. 화면은 마지막 상태를 보여주고 있어요.",
    action: "다시 연결",
    actionPending: "다시 연결하는 중…",
  },
  reconnecting: {
    title: "다시 연결하는 중이에요",
    body: "연결되면 최신 상태를 다시 불러와요. 잠시만 기다려 주세요.",
  },
};

/** Safe FE note when a manual reconnect attempt fails to reach a live session
 *  (agent still off / unpaired) — surfaced via the note channel, never a raw
 *  transport reason. */
export const CONNECTION_RETRY_FAILED_NOTE =
  "아직 연결할 수 없어요. 내 PC의 reviewnary 도우미가 실행 중인지 확인해 주세요.";

// Safe FE copy when a source rejects a command — never a raw reason code.
export const COMMAND_REJECTED_COPY: Record<CommandRejectionReason, string> = {
  "not-allowed": "지금은 할 수 없는 동작이라 무시했어요.",
  "stale-revision": "상태가 바뀌어 있어서 최신 화면으로 다시 맞췄어요. 확인 후 다시 시도해 주세요.",
};

// Desktop = act / mobile = read-only. Single source for the repeated "do it on
// desktop" guidance so the wording never drifts across surfaces. Each variant is
// context-specific (start / start-new / act / read-only banner) and kept distinct.
export const DESKTOP_ONLY_COPY = {
  start: "시작은 데스크톱에서 할 수 있어요. 휴대폰에서는 진행 상황만 볼 수 있어요.",
  startNew: "새 작업 시작은 데스크톱에서 할 수 있어요.",
  act: "실제 진행과 확인은 데스크톱에서 해주세요. 휴대폰에서는 진행 상황만 볼 수 있어요.",
  readOnlyBanner: "휴대폰에서는 진행 상황만 볼 수 있어요. 시작·확인 등 실제 작업은 데스크톱에서 진행해요.",
} as const;

// Shared empty-start copy (both /operations and /operations/current). The block
// component itself is deferred to a later slice (<EmptyStartCard>); only the copy
// is single-sourced here now.
export const EMPTY_START_COPY = {
  title: "리뷰 내려받기를 시작할 수 있어요.",
  body: "시작하면 판매자센터 화면에서 단계별로 안내해요.",
} as const;

// First-run review-work surface (/operations home empty state, FE-12). A state-driven
// current-task card modeled on a seller-center worklist (SmartStore / Wing / Cafe24): it shows
// ONLY the one actionable step for this state — task title, overall status, the current step,
// and its action. It is not an onboarding explainer and not a preview: later steps and results
// are revealed by <ActiveRunCard> once a run exists (progressive disclosure at the page level),
// never previewed here. The task title reuses the run copy key ("actionWindow.review.run" →
// "리뷰 내려받기") so the name matches the run / checkpoint / completed surfaces. "시작 전" is a
// UI-only status label, never a wire RunStatus. 채널 stays omitted (no value before a run exists).
export const REVIEW_WORK_COPY = {
  statusLabel: "시작 전",
  currentStepLabel: "현재 단계",
  currentStepText: "판매자센터 화면에서 리뷰 파일을 단계별로 내려받아요.",
  actionLabel: "내려받기 시작",
} as const;

// 네이버 리뷰를 기간별로 내려받는 작업의 activity strip (Home 참고 panel · 채널 연결 hub). A read-only
// summary of the current run that deep-links into the collection workbench (`/connect/imports`) — it never
// starts or commands a run. The name matches the workbench's page title so the surface name never drifts
// (product assembly A6: the workbench collects; review work lives on the 리뷰 screen).
//
// **이름이 바뀐 이유**(Coupang Connection UX v2, 2026-09-14): 쿠팡 채널 화면의 브라우저 수집 카드가
// 「리뷰 수집」이라는 이름을 갖는다. 같은 제품 안에서 한 이름이 두 대상을 가리키면, 판매자는 자기가 어느
// 것을 보고 있는지 화면으로 알 수 없다. 이 lane은 <b>네이버의</b> 기간별 내려받기이므로 그렇게 부른다.
export const HOME_REVIEW_OPS_COPY = {
  sectionTitle: "네이버 리뷰 기간별 가져오기",
  emptyBody: "진행 중인 네이버 리뷰 가져오기 작업이 없어요.",
  open: "작업 화면 열기",
  goToCheckpoint: "확인하러 가기",
} as const;

// The human-checkpoint action title — a seller-center task label ("do this step in
// the seller center"), distinct from the "확인 필요" run-status chip. Shown as the
// checkpoint card heading (/operations/current) and echoed in the home active-run
// summary — single-sourced so the two surfaces never drift.
export const CHECKPOINT_PROMPT_TITLE = "판매자센터에서 진행";

// Section titles that render BOTH as a section `aria-label` and its visible `<h2>`.
// Single-sourced here so the two copies in each card can never drift. Section names
// that appear only as an aria-label (no matching heading) stay inline at their site.
export const SECTION_TITLE = {
  reviewWork: "리뷰 업무 현황",
  recentActivity: "최근 활동",
  controls: "가능한 동작",
  timeline: "진행 단계",
  nextRun: "다음 작업",
} as const;

// Start-new-run affordance label. Rendered on both the home active-run card and the
// run-detail terminal "다음 작업" section — single-sourced so they stay in step.
export const START_NEW_RUN_LABEL = "새 작업 시작";
