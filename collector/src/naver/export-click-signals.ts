/**
 * Pure, sanitized signals for the export-click DIAGNOSTIC — browser-free.
 *
 * Why this exists: the same-session capture run proved the full pre-export chain
 * (auto-read → guarded continue → LOGGED_IN → export gate → ONE export click), but
 * the click produced no download within the bound (`DOWNLOAD_FAILED`). The live page
 * is classified `SYNC_DOWNLOAD` from the visible Excel/download control, yet clicking
 * it does not yield an immediate browser download — most likely a date/range
 * requirement, a native alert, a toast, a confirmation modal, or an async job. Per
 * `CLAUDE.md §6` we DIAGNOSE that from observed (sanitized) structure rather than
 * blindly raising the timeout or guess-tuning markers.
 *
 * This module is the pure classification half: serialized-HTML / dialog-text in →
 * fixed enums / booleans / bucketed counts / salted 16-hex hashes out. The live
 * observer wiring lives in `export-click-diagnose.ts`.
 *
 * SAFETY CONTRACT (same as `export-probe.ts` / `export-classify.ts`): every field
 * emitted here is a fixed category enum, a boolean, a coarse bucket, or a salted
 * one-way hash. No field copies a substring of the input — dialog/toast text is
 * reduced to a category + length bucket + salted hash, never echoed. So
 * `JSON.stringify(...)` of any record below can never carry a store/account/Commerce
 * id, NAVER id, review text, raw URL, selector, label, or token. Asserted by an
 * offline hostile-fixture test.
 */
import { createHash } from "node:crypto";
import { planExportAction, type ExportLayout } from "./export-classify";
import type { CountBucket } from "./export-probe";

export type MessageLengthBucket = "empty" | "tiny" | "short" | "medium" | "long";

/** Sanitized category of a confirmation/warning MODAL surfaced after the click. */
export type ModalCategory =
  | "date_range_required"
  // The legal "리뷰 다운로드 및 활용에 유의 … 계속하시겠습니까?" review-usage consent prompt —
  // a real export gate, distinct from "no target" / "pick a range" / a generic confirm.
  | "review_usage_confirmation"
  | "confirmation_required"
  | "async_job_notice"
  | "unknown_modal";

/** Sanitized category of a NATIVE dialog (window.alert/confirm/prompt) message. */
export type DialogMessageCategory =
  | "date_range"
  | "review_usage_confirmation"
  | "confirmation"
  | "error_warning"
  | "async_job"
  | "other";

/** The single derived classification of what the one export click produced. */
export type ExportClickOutcome =
  | "DOWNLOAD"
  | "NATIVE_DIALOG"
  | "DATE_RANGE_REQUIRED"
  | "REVIEW_USAGE_CONFIRMATION"
  | "MODAL"
  | "ASYNC_JOB"
  | "TOAST"
  | "POPUP"
  | "NO_OP";

/** Sanitized pre-click UI snapshot of the export surface. */
export interface PreClickSignals {
  exportLayout: ExportLayout;
  exportActionable: boolean;
  /** Bucketed count of date/range-style controls present. */
  dateRangeControlPresence: CountBucket;
  /** Best-effort: a date/range control already carries a non-empty value. */
  selectedRangePresent: boolean;
  /** A modal/dialog/overlay is already open before the click. */
  modalOpen: boolean;
  /** A toast/snackbar/status region is present before the click. */
  toastRegionPresent: boolean;
}

/** Sanitized post-click structural observation (accumulated across polls). */
export interface PostClickSignals {
  modalOpen: boolean;
  modalCategory: ModalCategory | null;
  toastPresent: boolean;
  asyncJobMarkerPresent: boolean;
  dateRangeRequired: boolean;
  /** The legal review-usage download-consent prompt is present (diagnostic only; never auto-confirmed). */
  reviewUsageConfirmation: boolean;
}

/** Sanitized record of a native dialog — never the raw message. */
export interface DialogRecord {
  /** Playwright dialog type enum: alert | confirm | prompt | beforeunload. */
  type: string;
  messageCategory: DialogMessageCategory;
  messageLengthBucket: MessageLengthBucket;
  /** Salted one-way hash of the message — stable across runs, non-reversible. */
  messageHash: string;
  /** What we did to keep observing: alerts accepted, everything else dismissed. */
  action: "accepted" | "dismissed";
}

/** Exact key allow-lists — used by the offline no-leak tests. */
export const PRE_CLICK_SIGNAL_KEYS: ReadonlyArray<keyof PreClickSignals> = [
  "exportLayout",
  "exportActionable",
  "dateRangeControlPresence",
  "selectedRangePresent",
  "modalOpen",
  "toastRegionPresent",
];
export const POST_CLICK_SIGNAL_KEYS: ReadonlyArray<keyof PostClickSignals> = [
  "modalOpen",
  "modalCategory",
  "toastPresent",
  "asyncJobMarkerPresent",
  "dateRangeRequired",
  "reviewUsageConfirmation",
];
export const DIALOG_RECORD_KEYS: ReadonlyArray<keyof DialogRecord> = [
  "type",
  "messageCategory",
  "messageLengthBucket",
  "messageHash",
  "action",
];

// --- markers (presence-only; matched text is never returned) ------------------

const MODAL_MARKERS: readonly RegExp[] = [
  /role\s*=\s*["'](?:dialog|alertdialog)["']/i,
  /aria-modal\s*=\s*["']true["']/i,
  /\b(?:class|id)\s*=\s*["'][^"']*(?:modal|dialog|popup|layer|overlay)[^"']*["']/i,
];
const TOAST_MARKERS: readonly RegExp[] = [
  /\b(?:class|id)\s*=\s*["'][^"']*(?:toast|snackbar|noti(?:fy|fication)|message-?(?:box|bar)|alert-?(?:area|box|bar))[^"']*["']/i,
  /role\s*=\s*["'](?:status|alert)["']/i,
];
const ASYNC_JOB_MARKERS: readonly RegExp[] = [
  /다운로드\s*목록/,
  /다운로드\s*센터/,
  /다운로드\s*요청/,
  /처리\s*중/,
  /대기열/,
  /download[-\s]?center/i,
  /export[-\s]?(?:queue|job)/i,
];
const DATE_RANGE_MARKERS: readonly RegExp[] = [
  /조회\s*기간/,
  /검색\s*기간/,
  /시작일/,
  /종료일/,
  /기간을?\s*(?:선택|설정|확인)/,
  /최대\s*\d+\s*(?:개월|일|주)/,
  /date\s*range/i,
  /\bperiod\b/i,
];
// The legal review-download consent prompt: "리뷰 다운로드 및 활용에 유의해 주세요 … 리뷰 작성자
// … 저작권자 … 리뷰데이터 다운로드를 계속하시겠습니까?". Distinct from a generic confirm, a
// no-target notice, or a date-range requirement — it means reviews EXIST and consent is asked.
const REVIEW_USAGE_MARKERS: readonly RegExp[] = [
  /리뷰\s*다운로드\s*및\s*활용/,
  /활용에\s*유의/,
  /리뷰\s*작성자/,
  /저작권자/,
  /리뷰\s*데이터\s*다운로드/,
  /리뷰데이터\s*다운로드/,
  /다운로드를?\s*계속하시겠습니까/,
];
const CONFIRM_MARKERS: readonly RegExp[] = [/확인/, /계속/, /저장/, /\bconfirm\b/i, /\bcontinue\b/i, /\bok\b/i];
const ERROR_WARN_MARKERS: readonly RegExp[] = [/오류/, /실패/, /경고/, /불가/, /\berror\b/i, /\bfail/i, /\bwarn/i];
const DATE_INPUT_RE = /type=["']date["']|date[-_]?picker|calendar|달력|날짜\s*선택/gi;
const FILLED_DATE_INPUT_RE =
  /<input\b[^>]*(?:type=["']date["']|class=["'][^"']*(?:date|calendar|picker)[^"']*["'])[^>]*\bvalue\s*=\s*["'][^"']+["']/i;

const stripComments = (html: string): string => html.replace(/<!--[\s\S]*?-->/g, " ");
const anyMatch = (markers: readonly RegExp[], s: string): boolean => markers.some((re) => re.test(s));
const countMatches = (re: RegExp, html: string): number => (html.match(re) ?? []).length;

/** Same bucket thresholds as the sibling probe modules (kept local so this stays a pure leaf). */
function bucket(n: number): CountBucket {
  if (n <= 0) return "none";
  if (n === 1) return "one";
  if (n <= 5) return "few";
  if (n <= 20) return "some";
  return "many";
}

/** Coarse length bucket for a dialog/toast/filename string — never its content. */
export function lengthBucket(n: number): MessageLengthBucket {
  if (n <= 0) return "empty";
  if (n <= 8) return "tiny";
  if (n <= 40) return "short";
  if (n <= 200) return "medium";
  return "long";
}

/** Pure: trim + collapse whitespace before hashing — stabilizes the hash only. */
function normalize(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/**
 * Pure: salted one-way fingerprint of a message/filename (same scheme as the
 * resolver's `continueCardFingerprint`). With no salt it still hashes, just without
 * the shared-secret guard. Used so two runs hitting the same dialog/file produce the
 * same 16-hex token WITHOUT ever echoing the raw text.
 */
export function messageFingerprint(salt: string | undefined, text: string): string {
  return createHash("sha256")
    .update(`${salt ?? ""} ${normalize(text)}`)
    .digest("hex")
    .slice(0, 16);
}

/** Pure: is a modal/dialog/overlay container present in the HTML? */
export function modalMarkersPresent(rawHtml: string): boolean {
  return anyMatch(MODAL_MARKERS, stripComments(rawHtml));
}

/** Pure: is a toast/snackbar/status region present in the HTML? */
export function toastMarkersPresent(rawHtml: string): boolean {
  return anyMatch(TOAST_MARKERS, stripComments(rawHtml));
}

/**
 * Pure: classify an open modal into a fixed category, or null when no modal marker
 * is present. Precedence: an async-job notice wins, then a date/range requirement,
 * then a generic confirmation, else unknown.
 */
export function classifyModalCategory(rawHtml: string): ModalCategory | null {
  const html = stripComments(rawHtml);
  if (!anyMatch(MODAL_MARKERS, html)) return null;
  if (anyMatch(ASYNC_JOB_MARKERS, html)) return "async_job_notice";
  if (anyMatch(DATE_RANGE_MARKERS, html)) return "date_range_required";
  // The review-usage consent is a specific confirm — classify it BEFORE a generic confirm
  // (its "계속하시겠습니까" would otherwise fall through to confirmation_required).
  if (anyMatch(REVIEW_USAGE_MARKERS, html)) return "review_usage_confirmation";
  if (anyMatch(CONFIRM_MARKERS, html)) return "confirmation_required";
  return "unknown_modal";
}

/** Pure: classify a native dialog MESSAGE into a fixed category — never echoed. */
export function classifyDialogMessage(message: string): DialogMessageCategory {
  if (anyMatch(ASYNC_JOB_MARKERS, message)) return "async_job";
  if (anyMatch(DATE_RANGE_MARKERS, message)) return "date_range";
  if (anyMatch(REVIEW_USAGE_MARKERS, message)) return "review_usage_confirmation";
  if (anyMatch(ERROR_WARN_MARKERS, message)) return "error_warning";
  if (anyMatch(CONFIRM_MARKERS, message)) return "confirmation";
  return "other";
}

/** Pure: sanitized pre-click snapshot of the export surface. */
export function diagnosePreClickSignals(rawHtml: string): PreClickSignals {
  const html = stripComments(rawHtml);
  const plan = planExportAction(rawHtml);
  return {
    exportLayout: plan.layout,
    exportActionable: plan.hasActionableExportCandidate,
    dateRangeControlPresence: bucket(countMatches(DATE_INPUT_RE, html)),
    selectedRangePresent: FILLED_DATE_INPUT_RE.test(html),
    modalOpen: anyMatch(MODAL_MARKERS, html),
    toastRegionPresent: anyMatch(TOAST_MARKERS, html),
  };
}

/** Pure: sanitized post-click structural observation for one polled snapshot. */
export function summarizePostClick(rawHtml: string): PostClickSignals {
  const html = stripComments(rawHtml);
  const modalCategory = classifyModalCategory(rawHtml);
  return {
    modalOpen: modalCategory !== null,
    modalCategory,
    toastPresent: anyMatch(TOAST_MARKERS, html),
    asyncJobMarkerPresent: anyMatch(ASYNC_JOB_MARKERS, html),
    dateRangeRequired: modalCategory === "date_range_required" || anyMatch(DATE_RANGE_MARKERS, html),
    reviewUsageConfirmation: modalCategory === "review_usage_confirmation" || anyMatch(REVIEW_USAGE_MARKERS, html),
  };
}

/** Pure: the empty accumulator the poll loop folds snapshots into. */
export function emptyPostClick(): PostClickSignals {
  return {
    modalOpen: false,
    modalCategory: null,
    toastPresent: false,
    asyncJobMarkerPresent: false,
    dateRangeRequired: false,
    reviewUsageConfirmation: false,
  };
}

/**
 * Pure: OR-accumulate two post-click snapshots. Booleans latch true; the modal
 * category keeps the FIRST concrete category seen (so a later unrelated snapshot
 * can't erase the diagnosis).
 */
export function mergePostClick(acc: PostClickSignals, next: PostClickSignals): PostClickSignals {
  return {
    modalOpen: acc.modalOpen || next.modalOpen,
    modalCategory: acc.modalCategory ?? next.modalCategory,
    toastPresent: acc.toastPresent || next.toastPresent,
    asyncJobMarkerPresent: acc.asyncJobMarkerPresent || next.asyncJobMarkerPresent,
    dateRangeRequired: acc.dateRangeRequired || next.dateRangeRequired,
    reviewUsageConfirmation: acc.reviewUsageConfirmation || next.reviewUsageConfirmation,
  };
}

/**
 * Pure: collapse the observed signals into ONE outcome. Precedence is deliberate —
 * an actual download is the answer; otherwise a native dialog (it blocks everything);
 * then a date/range requirement (the most likely cause of the no-download), a generic
 * modal, an async job, a toast, a popup, and finally a no-op.
 */
export function deriveExportClickOutcome(input: {
  downloadFired: boolean;
  dialogPresent: boolean;
  post: PostClickSignals;
  popupOpened: boolean;
}): ExportClickOutcome {
  const { downloadFired, dialogPresent, post, popupOpened } = input;
  if (downloadFired) return "DOWNLOAD";
  if (dialogPresent) return "NATIVE_DIALOG";
  if (post.dateRangeRequired) return "DATE_RANGE_REQUIRED";
  // The review-usage consent gate is a specific, actionable modal — surface it distinctly
  // (above a generic MODAL) so the diagnostic names exactly which gate blocked the download.
  if (post.reviewUsageConfirmation) return "REVIEW_USAGE_CONFIRMATION";
  if (post.modalOpen) return "MODAL";
  if (post.asyncJobMarkerPresent) return "ASYNC_JOB";
  if (post.toastPresent) return "TOAST";
  if (popupOpened) return "POPUP";
  return "NO_OP";
}
