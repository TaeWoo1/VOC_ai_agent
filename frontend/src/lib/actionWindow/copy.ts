// FE-owned copy registry for the Action Window.
//
// Runtime sends only semantic identifiers (copy keys, channelCode, BlockerCode,
// enums). THIS module — owned by the frontend — maps them to final Korean copy,
// button labels, icons, and tone. Unknown copy keys render a safe fallback and
// never surface raw identifiers as if they were prose.

import type { BlockerCode, CommandType, CopyParams, RunStatus, StepStatus } from "./contract";

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
export interface StatusView {
  label: string;
  icon: string;
  tone: StatusTone;
}

// Exhaustive: every RunStatus must have a view (a missing key is a compile error).
const RUN_STATUS_VIEW: Record<RunStatus, StatusView> = {
  PREPARING: { label: "준비 중", icon: "⏳", tone: "active" },
  RUNNING: { label: "진행 중", icon: "▶", tone: "active" },
  WAITING_FOR_HUMAN: { label: "확인이 필요해요", icon: "🙋", tone: "human" },
  PAUSED: { label: "일시정지", icon: "⏸", tone: "neutral" },
  PROCESSING: { label: "처리 중", icon: "⚙", tone: "active" },
  COMPLETED: { label: "완료", icon: "✓", tone: "good" },
  FAILED: { label: "실패", icon: "⚠", tone: "bad" },
  CANCELLED: { label: "취소됨", icon: "⛔", tone: "neutral" },
};
export function runStatusView(status: RunStatus): StatusView {
  return RUN_STATUS_VIEW[status];
}

const STEP_STATUS_VIEW: Record<StepStatus, { label: string; icon: string }> = {
  PENDING: { label: "대기", icon: "○" },
  PREPARING: { label: "준비 중", icon: "⏳" },
  READY: { label: "준비됨", icon: "▸" },
  AWAITING_USER: { label: "내 차례", icon: "🙋" },
  OBSERVING: { label: "확인 중", icon: "👀" },
  PROCESSING: { label: "처리 중", icon: "⚙" },
  COMPLETED: { label: "완료", icon: "✓" },
  FAILED: { label: "실패", icon: "⚠" },
  SKIPPED: { label: "건너뜀", icon: "↷" },
};
export function stepStatusView(status: StepStatus): { label: string; icon: string } {
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
  REQUEST_STEP_RECHECK: "다 했어요",
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
};
export function blockerView(code: BlockerCode): BlockerView {
  return BLOCKER_VIEW[code];
}
