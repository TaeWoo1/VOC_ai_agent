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
};

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
  SURFACE_SETTLE_TIMEOUT: {
    title: "화면이 아직 준비되지 않았어요",
    body: "판매자센터의 리뷰 관리 화면이 모두 뜬 뒤 '다시 확인'을 눌러 주세요.",
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
