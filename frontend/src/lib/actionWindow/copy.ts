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
  "actionWindow.issuance.return": "SellerOps로 돌아와 입력",

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
  // The walk's LAST step. It said "액세스 키·시크릿 키·업체코드 복사" while the panel asked the seller to
  // transcribe a 40-character secret by hand; SellerOps fetches them now, under a confirmation pressed on a
  // SellerOps surface. The separate `return` step is gone — this step's CTA performs the return.
  "actionWindow.coupangIssuance.copyKeys": "SellerOps에 연결",

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
  "actionWindow.coupangRenewal.return": "SellerOps로 돌아와 새 키 입력",
};

// Per-step FULL instruction for the guided issuance walkthrough — so the SellerOps screen is self-sufficient
// and the seller does not have to decode the in-NAVER highlight (which only points at a control). Grounded in
// the static issuance/existing-app tutorials (`lib/guidedConnection/tutorial.ts`); same hedged, position/role
// wording (exact NAVER labels differ by screen version, so none is asserted as fact) and the same privacy
// invariant — SellerOps never logs in, clicks, or reads the credential value; the seller performs each step.
// Keyed by the SAME `actionWindow.issuance.*` copy keys the runtime emits; an unmapped step renders no detail.
const ISSUANCE_STEP_DETAIL: Record<string, string> = {
  "actionWindow.issuance.run":
    "SellerOps가 화면에서 어디를 봐야 하는지 안내합니다. 각 단계는 열린 NAVER 창에서 직접 진행하시고, 이 화면의 설명을 따라가세요. SellerOps는 로그인·클릭·입력을 하지 않고 어떤 값도 읽지 않습니다.",
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
    "애플리케이션 상태를 확인해 주세요. 화면에 '다시사용' 버튼이 보인다면 직접 눌러 앱을 활성화해 주세요. 버튼이 보이지 않더라도 SellerOps가 활성 상태라고 단정하지 않습니다. 확인했다면 다음으로 진행해 주세요.",
  "actionWindow.issuance.appUsageCheckNew":
    "방금 만든 애플리케이션의 상태를 확인해 주세요. 새로 만든 앱은 보통 바로 사용할 수 있지만, 혹시 화면에 '다시사용' 버튼이 보이면 직접 눌러 활성화해 주세요. 버튼이 보이지 않더라도 SellerOps가 활성 상태라고 단정하지 않습니다. 확인했다면 다음으로 진행해 주세요.",
  "actionWindow.issuance.apiGroup":
    "이 애플리케이션에 상품·주문(판매자) 관련 API 그룹이 포함돼 있는지 확인하고, 없으면 추가하세요. 정확한 그룹 이름은 화면마다 다를 수 있으니 '주문'·'판매자'가 포함된 항목을 찾아 선택하면 됩니다.",
  "actionWindow.issuance.applicationId":
    "애플리케이션 ID를 복사해 주세요. 표시된 애플리케이션 ID 행에서 값을 직접 복사하시면 됩니다. SellerOps는 이 값을 읽지 않습니다 — 복사는 직접 하시고, 마지막에 SellerOps 보안 입력란에 붙여넣으세요.",
  "actionWindow.issuance.applicationSecret":
    "애플리케이션 시크릿을 확인하고 복사해 주세요. 표시된 '보기/복사' 컨트롤에서 시크릿을 직접 확인·복사하시면 됩니다. SellerOps는 시크릿 값도, 클립보드도 읽지 않습니다. 확인이 어려우면 시크릿 재발급이 필요할 수 있습니다.",
  "actionWindow.issuance.return":
    "두 값을 복사했다면 SellerOps로 돌아가 주세요. 안내가 끝나면 연결 정보 입력 화면으로 이동합니다.",

  // Coupang WING Open API key issuance — FULL per-step instruction. Same hedged, position/role wording
  // (exact WING labels differ by screen version, so none is asserted as fact) and the same privacy
  // invariant — SellerOps never logs in, clicks, or reads a key value; the seller performs each step and
  // clicks 발급 themselves. Keyed by the SAME `actionWindow.coupangIssuance.*` keys the runtime emits.
  "actionWindow.coupangIssuance.run":
    "SellerOps가 화면에서 어디를 봐야 하는지 안내합니다. 각 단계는 열린 쿠팡 윙 창에서 직접 진행하시고, 이 화면의 설명을 따라가세요. SellerOps는 로그인·클릭·입력을 하지 않고 어떤 값도 읽지 않습니다.",
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
    "약관을 직접 읽고 판단하신 뒤 동의 체크박스 2개를 선택하세요. SellerOps는 약관을 읽지도, 대신 동의하지도, 체크하지도 않습니다. 2개가 모두 선택되면 자동으로 넘어갑니다(선택 여부는 저장·전송하지 않습니다).",
  "actionWindow.coupangIssuance.issueCheckpoint":
    "'약관 동의 및 Key 발급받기'를 직접 누르세요 — SellerOps는 이 버튼을 절대 누르지 않습니다. 이 버튼에서는 키가 발급되지 않고 연동 방식을 고르는 화면이 열립니다(live walk 2회에서 그렇게 보고되었습니다. SellerOps는 키 발급 여부를 확인할 수 없습니다). 그 화면이 열리면 자동으로 넘어갑니다.",
  "actionWindow.coupangIssuance.vendorMethod":
    "입력 방식에서 '자체개발(직접입력)'을 직접 선택하세요 — SellerOps는 선택하지 않습니다. 선택하면 URL · IP 주소 입력란이 더 나타납니다(업체명은 이미 화면에 있습니다). 업체명 · URL을 입력하고 IP는 '추가'까지 누르면 자동으로 넘어갑니다(SellerOps는 입력란이 비었는지만 보고 값은 읽지 않습니다. 넘어가지 않으면 아래 버튼을 누르세요).",
  "actionWindow.coupangIssuance.vendorConfirm":
    "업체명 · URL을 입력하고, IP 주소는 입력한 뒤 옆의 '추가'를 눌러 등록하세요 — 추가하지 않으면 IP가 등록되지 않습니다. 그 다음 '확인'을 직접 누르세요. ⚠ 여기서 실제 API 키가 발급되어 라이브 계정 상태가 바뀝니다(지우려면 나중에 별도의 삭제 작업이 필요합니다). SellerOps는 이 버튼을 절대 누르지 않고, 입력란에 아무것도 쓰지 않습니다. 키가 화면에 표시되면 자동으로 넘어갑니다.",
  "actionWindow.coupangIssuance.copyKeys":
    "API 키 발급이 확인됐습니다. SellerOps가 연결에 필요한 정보를 안전하게 가져올 준비가 됐어요. 아래 버튼을 누르시면 SellerOps로 돌아가고, 거기서 가져와도 될지 한 번 더 여쭙니다.",
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
    "현재 키의 유효기간이 다가와 새 키로 갱신하는 안내입니다. 각 단계는 열린 쿠팡 윙 창에서 직접 진행하시고, 이 화면의 설명을 따라가세요. SellerOps는 로그인·클릭·입력을 하지 않고 어떤 값도 읽지 않습니다.",
  "actionWindow.coupangRenewal.reachOpenApi":
    "쿠팡 윙에서 '판매자정보'의 오픈API 키 발급 영역으로 이동하세요. 정확한 메뉴 이름은 화면 버전에 따라 다를 수 있으니 '오픈API'·'키 발급'이 포함된 항목을 찾아 주세요.",
  "actionWindow.coupangRenewal.checkExpiry":
    "현재 발급된 키의 유효기간(만료일)을 확인해 주세요. 유효기간이 얼마 남지 않았거나 이미 지났다면 새 키를 재발급해야 합니다. 이 만료일은 뒤에서 직접 입력하실 값이니 함께 확인해 두세요. SellerOps는 이 화면의 값을 읽지 않습니다.",
  "actionWindow.coupangRenewal.reissueCheckpoint":
    "이제 재발급 버튼을 누르기 직전 단계입니다. 재발급 버튼은 반드시 직접 눌러 주세요 — SellerOps는 대신 재발급하지 않습니다. 재발급하면 새 키가 생성되며, 기존 키는 쿠팡 정책에 따라 처리됩니다.",
  "actionWindow.coupangRenewal.copyKeys":
    "재발급된 새 액세스 키(Access Key), 시크릿 키(Secret Key), 업체코드(Vendor ID)를 직접 복사하세요. 시크릿 키는 재발급 시 한 번만 표시되니 안전하게 보관하세요. SellerOps는 이 값들을 읽지 않습니다 — 복사는 직접 하시고, 마지막에 SellerOps 보안 입력란에 붙여넣으세요.",
  "actionWindow.coupangRenewal.return":
    "새 키 세 값과 확인한 만료일을 들고 SellerOps로 돌아와 주세요. 안내가 끝나면 새 키로 교체하는 입력 화면으로 이동합니다.",
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
    body: "'다시 확인'을 누르면 판매자센터 창을 다시 열어 드릴게요.",
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
  "아직 연결할 수 없어요. 로컬 에이전트가 실행 중인지 확인해 주세요.";

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

// Home "리뷰 운영" activity strip (seller-center overhaul, Slice 2). A read-only
// summary of the current review run shown on the Home dashboard that deep-links
// into the operations workbench — it never starts or commands a run. "리뷰 운영"
// matches the nav label and the /operations page title so the surface name never
// drifts. The empty body is a calm honest state (shown when there is no live run).
export const HOME_REVIEW_OPS_COPY = {
  sectionTitle: "리뷰 운영",
  emptyBody: "진행 중인 리뷰 작업이 없어요.",
  open: "리뷰 운영 열기",
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
