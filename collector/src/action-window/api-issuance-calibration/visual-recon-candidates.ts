/**
 * **PROPOSED API-center selector candidates — CANDIDATE / UNVERIFIED (live matchCount pending).**
 *
 * A reviewer derived these from the redacted screenshots + sanitized structural summaries of ONE live visual
 * recon. They use ONLY fixed NAVER UI labels (never an application NAME, never a credential VALUE, never a bare
 * coordinate), so they carry no user/account data. Every candidate's `matchCount` is {@link MATCH_COUNT_UNMEASURED}
 * so the frozen {@link evaluateSelectorCandidate} gate refuses adoption (`NOT_UNIQUE`) until a live run measures
 * uniqueness against the real DOM.
 *
 * This module ADOPTS NOTHING and never flips `SELECTORS_CALIBRATED`. It is a proposal RECORD plus its eligibility
 * check — the calibrated production selectors and the `SELECTORS_CALIBRATED=true` flip remain a separate,
 * explicitly-authorized step that happens only after live matchCount confirms each candidate.
 *
 * Selector strings use Playwright selector-engine syntax (`role=…[name="…"]`, `text="…"`) — a live matchCount is
 * `page.locator(selector).count()`, not `querySelectorAll` (these are text/role candidates, not pure CSS).
 */
import { evaluateSelectorCandidate, type SelectorCandidate, type VisualReconScreen } from "./visual-recon";

/** `matchCount` sentinel: "not yet measured on the live DOM" — keeps a candidate non-adoptable (`NOT_UNIQUE`). */
export const MATCH_COUNT_UNMEASURED = -1;

/** Stable, sanitized target ids — never a selector, never user data. */
export const VISUAL_RECON_TARGET_IDS = [
  "app_list.register_application",
  "app_list.reactivate_application",
  "app_detail.application_section",
  "api_group.section",
  "credentials.application_id_label",
  "credentials.application_secret_label",
  "credentials.secret_view_button",
  "credentials.secret_copy_button",
] as const;
export type VisualReconTargetId = (typeof VISUAL_RECON_TARGET_IDS)[number];

export interface ProposedCandidate {
  targetId: VisualReconTargetId;
  screen: VisualReconScreen;
  /** Sanitized note: what the control is + where it sits, in fixed-label terms only. */
  note: string;
  candidate: SelectorCandidate;
}

/** Build a candidate that uses a fixed NAVER label only, unmeasured, and screenshot-confirmed by the reviewer. */
function fixedLabelCandidate(screen: VisualReconScreen, selector: string): SelectorCandidate {
  return {
    screen,
    selector,
    matchCount: MATCH_COUNT_UNMEASURED, // live-pending — never claims uniqueness offline
    screenshotTargetConfirmed: true, // the reviewer saw this control in the redacted screenshot
    dependsOnAccountOrCredential: false, // fixed UI label only — no app name / no credential value
    positionOnly: false, // anchored by role/label, not a coordinate or nth-child
    usesTextMatch: true,
    usesFixedLabelTextOnly: true,
  };
}

/**
 * The proposals. All are non-adoptable offline (matchCount unmeasured). Notes call out the two live checks the
 * capture surfaced: the register button's label is STATE-dependent (becomes "다시사용" when the app is suspended),
 * and the section headings must be matched EXACTLY so the nav/breadcrumb "내 스토어 애플리케이션" is not caught.
 */
export const VISUAL_RECON_CANDIDATES: readonly ProposedCandidate[] = [
  {
    targetId: "app_list.register_application",
    screen: "app_list",
    note: "app_list 스토어 섹션 우상단의 등록 버튼(등록 가능 상태). 일시중단이면 같은 자리 라벨이 '다시사용'으로 바뀜.",
    candidate: fixedLabelCandidate("app_list", 'role=button[name="애플리케이션 등록"]'),
  },
  {
    targetId: "app_list.reactivate_application",
    screen: "app_list",
    note: "app_list 스토어 섹션 우상단의 재사용 버튼(앱 일시중단 상태에서 '애플리케이션 등록' 대신 노출). 상태별로 둘 중 하나만 존재.",
    candidate: fixedLabelCandidate("app_list", 'role=button[name="다시사용"]'),
  },
  {
    targetId: "app_detail.application_section",
    screen: "app_detail",
    note: "app_detail 본문의 '애플리케이션' 섹션 제목. 네비/브레드크럼의 '내 스토어 애플리케이션'과 구분되도록 정확 일치 heading으로 앵커.",
    candidate: fixedLabelCandidate("app_detail", 'role=heading[name="애플리케이션"]'),
  },
  {
    targetId: "api_group.section",
    screen: "api_group",
    note: "동일 app_detail 페이지 하단 'API 그룹' 섹션 제목(같은 페이지 스크롤). 정확 일치 heading으로 앵커.",
    candidate: fixedLabelCandidate("api_group", 'role=heading[name="API 그룹"]'),
  },
  {
    targetId: "credentials.application_id_label",
    screen: "credentials",
    note: "인증정보 KV 테이블의 '애플리케이션 ID' 라벨 셀(값이 아니라 라벨). 값은 절대 대상 아님.",
    candidate: fixedLabelCandidate("credentials", 'text="애플리케이션 ID"'),
  },
  {
    targetId: "credentials.application_secret_label",
    // NOTE: this selector NAMES the secret row; the frozen gate flags any credentials-screen selector containing
    // "시크릿" as CREDENTIAL_VALUE_TARGET (conservative). It is recorded so the intent + the gate's protection are
    // both explicit; the practical, gate-clean anchor for the secret row is its 보기/복사 buttons below.
    screen: "credentials",
    note: "인증정보 '애플리케이션 시크릿' 라벨. 보수적 게이트가 시크릿 관련 selector를 값-대상으로 차단하므로 채택 불가 — 시크릿 행은 보기/복사 버튼으로 앵커 권장.",
    candidate: fixedLabelCandidate("credentials", 'text="애플리케이션 시크릿"'),
  },
  {
    targetId: "credentials.secret_view_button",
    screen: "credentials",
    note: "시크릿 행의 '보기' 버튼(값을 드러내는 컨트롤의 위치만 식별 — 값 자체는 대상 아님).",
    candidate: fixedLabelCandidate("credentials", 'role=button[name="보기"]'),
  },
  {
    targetId: "credentials.secret_copy_button",
    screen: "credentials",
    note: "시크릿 행의 '복사' 버튼(값 복사 컨트롤의 위치만 식별 — 값 자체는 대상 아님).",
    candidate: fixedLabelCandidate("credentials", 'role=button[name="복사"]'),
  },
];

/** A proposal with its eligibility verdict — every one is non-adoptable offline (matchCount unmeasured). */
export interface EvaluatedCandidate extends ProposedCandidate {
  adoptable: boolean;
  reasons: ReturnType<typeof evaluateSelectorCandidate>["reasons"];
}

/** Score every proposal through the frozen adoption gate. Purely diagnostic — adopts nothing. */
export function evaluateVisualReconCandidates(): EvaluatedCandidate[] {
  return VISUAL_RECON_CANDIDATES.map((p) => {
    const { adoptable, reasons } = evaluateSelectorCandidate(p.candidate);
    return { ...p, adoptable, reasons };
  });
}

/**
 * A READ-ONLY fixed-label matchCount probe spec. NAVER's API-center controls carry no aria-label/name/id for
 * these targets (run #3 census proved it) — they are labelled by visible TEXT only, which the attribute-only
 * census cannot count. Each probe names a STRUCTURAL candidate set (a plain querySelectorAll — no user data) and
 * a FIXED NAVER label; the in-page probe counts how many candidates have that exact accessible name and returns
 * only an integer. It never clicks, types, reads a credential value, or emits any page text.
 */
export interface FixedLabelProbe {
  targetId: VisualReconTargetId;
  screen: VisualReconScreen;
  /** A structural querySelectorAll for candidate elements — no user data, no value attribute. */
  candidateQuery: string;
  /** The FIXED NAVER UI label to match by accessible name / normalized text (never user/app/credential data). */
  exactText: string;
  /**
   * Optional: a structural selector for chrome/navigation ancestors. A candidate whose `closest(excludeWithin)`
   * is non-null is NOT counted — used to drop a label that also appears in the sidebar nav / breadcrumb / header
   * so only the MAIN-CONTENT occurrence is measured (run #4 found "애플리케이션" matched 3× incl. nav + breadcrumb).
   */
  excludeWithin?: string;
}

/** Chrome/navigation ancestors whose copy of a label must not be counted (sidebar nav, breadcrumb, header). */
const CHROME_NAV_ANCESTORS = "nav, aside, header, [role='navigation'], [role='banner'], [role='complementary'], ol, ul";

export const VISUAL_RECON_LABEL_PROBES: readonly FixedLabelProbe[] = [
  { targetId: "app_list.register_application", screen: "app_list", candidateQuery: "button, a, [role='button']", exactText: "애플리케이션 등록" },
  { targetId: "app_list.reactivate_application", screen: "app_list", candidateQuery: "button, a, [role='button']", exactText: "다시사용" },
  // app_detail: exclude the sidebar-nav group label + breadcrumb copies of "애플리케이션" so only the main-content
  // section heading is counted (was matchCount=3; this narrows toward 1 — confirm on the next live re-measure).
  // NOTE: only THIS probe gets excludeWithin — the others already measured matchCount=1 live (run #4) and the
  // aggressive `ol, ul` exclusion could wrongly drop them, so they stay unchanged until separately re-measured.
  { targetId: "app_detail.application_section", screen: "app_detail", candidateQuery: "h1,h2,h3,h4,h5,h6,[role='heading']", exactText: "애플리케이션", excludeWithin: CHROME_NAV_ANCESTORS },
  { targetId: "api_group.section", screen: "api_group", candidateQuery: "h1,h2,h3,h4,h5,h6,[role='heading']", exactText: "API 그룹" },
  { targetId: "credentials.application_id_label", screen: "credentials", candidateQuery: "th,td,dt,label,span,div", exactText: "애플리케이션 ID" },
  { targetId: "credentials.secret_view_button", screen: "credentials", candidateQuery: "button, a, [role='button']", exactText: "보기" },
  { targetId: "credentials.secret_copy_button", screen: "credentials", candidateQuery: "button, a, [role='button']", exactText: "복사" },
];

/** The fixed-label probes that apply to a given screen (the CLI runs these on that screen's live viewport). */
export function labelProbesForScreen(screen: VisualReconScreen): FixedLabelProbe[] {
  return VISUAL_RECON_LABEL_PROBES.filter((p) => p.screen === screen);
}
