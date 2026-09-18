/**
 * The copy of the customer-operations surfaces — Home, the case screen and 지식 (Customer Operations v3.1).
 *
 * <b>One file, so one fact is said one way.</b> A state word, a reason tag or a wait label that two screens spelled
 * separately would drift, and a seller reading 「미발송」 on one screen and 「보내지 않음」 on the next is being told two
 * things. Screens import these words; they do not write their own.
 *
 * <b>Short is not looser.</b> The invariants `customerOperations.ts` holds still hold here, in fewer letters:
 * <ul>
 *   <li>checked ≠ processed — the Home's left cell says 「자동 확인」, never 「처리」;</li>
 *   <li>prepared ≠ sent — every draft carries {@link DRAFT_UNSENT};</li>
 *   <li>0 ≠ not observed — a source that was not read is 「집계 제외」, never a zero;</li>
 *   <li>partial ≠ fine — a partial read gets its own warning line.</li>
 * </ul>
 */

export const DRAFT_UNSENT = "미발송";

export const COPY = {
  homeTitle: "홈",
  checkedLabel: "자동 확인 · 24시간",
  mineLabel: "내 확인 필요",
  listTitle: "확인 필요",
  listOrder: "오래된 순",
  none: "없음",
  firstCheck: "첫 확인 중",
  lastCheckFailed: "마지막 확인 실패",
  reconnect: "재연결",
  observing: "관찰 중",
  view: "보기",
  running: "운영 중",
  paused: "일시정지됨",
  off: "고객 운영 관리 꺼짐",
  start: "시작",
  resume: "재개",
  composer: "질문이나 지시를 입력하세요",
  // Case
  caseChecked: "자동 확인",
  original: "원문 보기",
  inquiryBody: "문의 내용",
  reviewBody: "리뷰 내용",
  checks: "확인 항목",
  evidence: "근거",
  noEvidence: "사용한 근거 없음",
  noInvestigation: "조사 기록 없음",
  draftTitle: "답변 초안",
  edit: "수정",
  save: "저장",
  cancel: "취소",
  toSend: "발송 화면으로",
  reuse: "유사 건에 재사용",
  otherHandling: "다른 처리가 필요하면",
  changeHandling: "처리 변경",
  handlingMethod: "처리 방법",
  memo: "메모 (선택)",
  needInfo: "필요한 정보",
  enterInfo: "정보 입력",
  guidance: "안내 내용",
  applyScope: "적용 범위",
  thisProduct: "이 상품",
  wholeCompany: "회사 전체",
  saveAndRedraft: "저장 후 초안 재작성",
  loadPastAnswer: "과거 답변 불러오기",
  saved: "저장됨",
  redrafted: "초안 재작성 완료",
  sameQuestionUses: "같은 질문에 이 기준 사용",
  saveFailed: "저장 실패",
  used: "사용됨",
  pastAnswer: "과거 답변",
  closed: "처리됨",
  // Knowledge
  knowledgeTitle: "지식",
  held: "보유 정보",
  toEnter: "입력 필요",
  nothingCollected: "수집된 정보 없음",
  connectChannel: "채널 연결",
  add: "+ 추가",
  sources: "출처",
  documentsTab: "자료",
  learnedTab: "채널 수집",
  addDocument: "+ 자료",
  enter: "입력",
  registerRule: "기준 등록",
  defer: "보류",
  findInPastAnswers: "과거 답변에서 찾기",
  noContent: "내용 없음",
  stopUsing: "사용 중지",
} as const;

/* ─────────────────────────── reason tags ─────────────────────────── */

export type ReasonTone = "amber" | "blue" | "gray";
export type ReasonIcon = "box" | "question" | "star" | "chat" | "scale";

export interface Reason {
  tag: string;
  tone: ReasonTone;
  icon: ReasonIcon;
}

export const REASON = {
  exchange: { tag: "교환·환불", tone: "amber", icon: "box" },
  info: { tag: "정보 부족", tone: "blue", icon: "question" },
  review: { tag: "리뷰", tone: "gray", icon: "star" },
  reply: { tag: "답변 필요", tone: "gray", icon: "chat" },
  withheld: { tag: "판단 보류", tone: "gray", icon: "scale" },
} as const satisfies Record<string, Reason>;

/**
 * Why a case came to the seller, from the action Reviewnary recommended — nothing new is classified here.
 * Money is money; a missing fact is a missing fact (also when the case lists what it is missing and names no
 * action); every other recommendation is a judgement Reviewnary did not take on itself.
 */
export function reasonOfCase(actionType: string | null, missingInformation: string[] = []): Reason {
  switch (actionType) {
    case "REFUND_OR_COMPENSATION":
    case "CANCEL_OR_EXCHANGE":
      return REASON.exchange;
    case "ADD_KNOWLEDGE":
      return REASON.info;
    case null:
      return missingInformation.length > 0 ? REASON.info : REASON.withheld;
    default:
      return REASON.withheld;
  }
}

/** The decision the seller is asked for, as a short noun phrase. Unknown actions say nothing rather than guess. */
const DECISION: Record<string, string> = {
  REPLY_TO_CUSTOMER: "답변 확인 후 발송",
  CONTACT_CUSTOMER: "고객 연락 여부 결정",
  REFUND_OR_COMPENSATION: "환불·보상 여부 결정",
  CANCEL_OR_EXCHANGE: "취소·교환 여부 결정",
  ADD_KNOWLEDGE: "정보 입력",
  REVIEW_PRODUCT_LISTING: "상품 설명 점검",
  MONITOR_REPEAT_ISSUE: "관찰 여부 결정",
  NO_ACTION: "처리 불필요 확인",
};

export function decisionOf(actionType: string | null): string | null {
  return actionType ? DECISION[actionType] ?? null : null;
}

/* ─────────────────────────── channel · kind ─────────────────────────── */

const CHANNEL_SHORT: Record<string, string> = {
  CAFE24: "카페24",
  NAVER: "네이버",
  COUPANG: "쿠팡",
  "네이버 스마트스토어": "네이버",
  "카페24": "카페24",
  "쿠팡": "쿠팡",
};

/** 「네이버 스마트스토어」 → 「네이버」. A name the table does not know is printed as the channel gave it. */
export function channelShort(codeOrName: string | null | undefined): string | null {
  if (!codeOrName) return null;
  return CHANNEL_SHORT[codeOrName] ?? codeOrName;
}

/** 「카페24 문의」 · 「네이버 리뷰 ★1」. */
export function sourceLabel(channel: string | null | undefined, kind: "INQUIRY" | "REVIEW", rating?: number | null): string {
  const name = channelShort(channel);
  const noun = kind === "INQUIRY" ? "문의" : "리뷰";
  const star = kind === "REVIEW" && rating != null ? ` ★${rating}` : "";
  return `${name ? `${name} ` : ""}${noun}${star}`;
}

/* ─────────────────────────── time ─────────────────────────── */

const KST = "Asia/Seoul";

function kstDay(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: KST, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return Date.UTC(get("year"), get("month") - 1, get("day")) / 86_400_000;
}

/**
 * How long something has waited. An instant gives minutes, hours or days; a bare date (`2026-09-17`) can only give
 * days, and today is 「오늘 접수」 rather than a zero wait nobody measured. Null when the value cannot be read.
 */
export function waitLabel(value: string | null | undefined, now: Date = new Date()): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const at = new Date(`${value}T00:00:00+09:00`);
    if (Number.isNaN(at.getTime())) return null;
    const days = Math.max(0, kstDay(now) - kstDay(at));
    return days === 0 ? "오늘 접수" : `${days}일 대기`;
  }
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return null;
  const minutes = Math.max(0, Math.floor((now.getTime() - at.getTime()) / 60_000));
  if (minutes < 1) return "방금 접수";
  if (minutes < 60) return `${minutes}분 대기`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 대기`;
  return `${Math.floor(hours / 24)}일 대기`;
}

/** Milliseconds since the epoch for ordering — a date-only value is midnight in Korea. NaN sorts last. */
export function waitSince(value: string | null | undefined): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const at = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00+09:00`) : new Date(value);
  const t = at.getTime();
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

/** 「9월 18일 목요일」, in Korea time. */
export function kstLongDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: KST, month: "long", day: "numeric", weekday: "long" }).format(now);
}

/** 「8월 21일」 from `2026-08-21`, or from an instant (read in Korea time); the value unchanged when it is not a date. */
export function shortDate(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length > 10 && value.includes("T")) {
    const at = new Date(value);
    if (!Number.isNaN(at.getTime())) {
      return new Intl.DateTimeFormat("ko-KR", { timeZone: KST, month: "long", day: "numeric" }).format(at);
    }
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m ? `${Number(m[2])}월 ${Number(m[3])}일` : value;
}

/* ─────────────────────────── source health ─────────────────────────── */

const FAILURE_SHORT: Record<string, string> = {
  AUTH_REQUIRED: "연결 만료",
  NOT_CONNECTED: "연결 끊김",
  TIMEOUT: "응답 지연",
  RATE_LIMITED: "요청 한도",
  EXECUTION_FAILED: "오류",
  INTERRUPTED: "중단됨",
  CONNECTOR_UNAVAILABLE: "지원 전",
  CONFIGURATION_REQUIRED: "설정 필요",
  CANCELLED: "확인 중단",
  SOURCE_AUTH_REQUIRED: "연결 만료",
  SOURCE_NOT_CONNECTED: "연결 끊김",
};

export function failureShort(reason: string | null | undefined): string {
  return (reason && FAILURE_SHORT[reason]) || "확인 못함";
}

/* ─────────────────────────── photos ─────────────────────────── */

/** What a looked-at photo shows. 「문제 보임」 keeps the wire's meaning — a problem, not necessarily damage. */
export function photoWord(problemVisible: "YES" | "NO" | "UNCLEAR" | null): string | null {
  switch (problemVisible) {
    case "YES":
      return "문제 보임";
    case "NO":
      return "이상 없음";
    case "UNCLEAR":
      return "판단 어려움";
    default:
      return null;
  }
}
