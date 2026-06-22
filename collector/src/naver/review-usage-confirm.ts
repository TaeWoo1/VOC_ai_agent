/**
 * Live REVIEW-USAGE CONSENT handling — observe-only diagnostics + an exactly-once 확인 click.
 *
 * Two surfaces, both reached ONLY after the supervised diagnostic export click already produced
 * `outcome: REVIEW_USAGE_CONFIRMATION`:
 *
 *  1. `scanReviewUsageConfirmCandidates` — NO-CLICK candidate-index diagnostic. It badges every
 *     visible button in the foreground consent modal with an index (for human inspection in the live
 *     browser) and returns ONLY sanitized per-candidate metadata (index / kind / visible / enabled /
 *     text-length bucket). It never clicks.
 *  2. `confirmReviewUsageOnce` — presses the single modal-scoped affirmative `확인` EXACTLY ONCE,
 *     then observes whether a download / dialog / follow-up modal results. Gated upstream by
 *     `decideReviewUsageConfirm` + the explicit `--diagnose-confirm-review-usage` flag.
 *
 * HARD INVARIANTS:
 *   - Exactly ONE `.click(` in this module (inside `confirmReviewUsageOnce`), on a control bound by a
 *     read-only in-page scan that stamps the SINGLE affirmative button inside the VISIBLE consent
 *     modal and is re-checked with `count() === 1`. Never a global `확인`. No fallback, no retry.
 *   - NEVER persists / uploads / writes status: no `saveAs`, `uploadReviewFile`, `writeStatus`,
 *     `runExport`, navigation. A download that fires is observed (sanitized) and discarded.
 *   - esbuild/`keepNames` safety: every `page.evaluate(...)` callback is an INLINE anonymous arrow
 *     with plain loops and NO inner named declarations — a named inner helper becomes `__name(...)`,
 *     undefined in the page sandbox → `ReferenceError: __name is not defined`. A source guard locks this.
 *   - Resilience: every `page.content()` / `page.evaluate()` is wrapped — a closed/detached page or
 *     context returns a sanitized `CONFIRM_READ_FAILED` halt, never an uncaught exception.
 *   - All output is sanitized — enums / booleans / coarse buckets / salted 16-hex hashes. No raw
 *     modal/dialog/toast/button text, filename, URL, selector, id, or token. Badge labels (index +
 *     derived kind) may render in the browser for inspection, but never reach console/log output.
 */
import { log } from "../log";
import {
  AFFIRMATIVE_MARKERS,
  CANCEL_MARKERS,
  classifyDialogMessage,
  classifyModalCategory,
  decideApprovedIndexBind,
  deriveConfirmOutcome,
  emptyPostClick,
  lengthBucket,
  mergePostClick,
  messageFingerprint,
  summarizePostClick,
  type ApprovedIndexBind,
  type ApprovedIndexDecision,
  type ConfirmOutcome,
  type DialogMessageCategory,
  type DialogRecord,
  type MessageLengthBucket,
  type ModalCategory,
} from "./export-click-signals";
import type { CountBucket } from "./export-probe";
import { extensionCategory, type ExtensionCategory } from "./review-export";
import type { SavedDownloadInspection } from "./review-download-save";

/** Internal index attribute stamped on the single bound affirmative control (read-identity only). */
const STAMP_ATTR = "data-sellerops-confirm";
/** Internal index attribute stamped on each badged candidate in the no-click diagnostic. */
const CAND_INDEX_ATTR = "data-sellerops-cand-index";

/** Per-`확인`-click actionability budget (matches the export safe-confirm timeout). */
const CONFIRM_CLICK_TIMEOUT_MS = 4_000;

/**
 * Visible-modal container scopes, in priority order (role/aria first, then the NAVER seller-center
 * modal classes). Plain CSS — visibility is tested in JS inside the scan (NOT a `:visible` pseudo).
 */
const MODAL_SCOPES: readonly string[] = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[aria-modal="true"]',
  ".modal-dialog",
  ".modal-content",
  ".modal-footer",
  ".seller-btn-area",
];

/** The button selector enumerated within the modal container (shared by both scans). */
const BUTTON_SEL = 'button, a[role="button"], [role="button"], input[type="button"], input[type="submit"]';

/** Minimal structural surface of a Playwright locator the confirm step touches. */
export interface ConfirmLocator {
  count(): Promise<number>;
  click(opts?: { timeout?: number }): Promise<void>;
}

/** Minimal structural surface of the Playwright page these steps touch. */
export interface ConfirmPage {
  content(): Promise<string>;
  evaluate<R, A>(fn: (arg: A) => R, arg: A): Promise<R>;
  locator(selector: string): ConfirmLocator;
  on(event: "dialog", handler: (dialog: ConfirmDialog) => void): void;
  waitForEvent(event: "download", opts?: { timeout?: number }): Promise<ConfirmDownload>;
}

/** Minimal structural surface of the browser context (popup/new-page observation). */
export interface ConfirmContext {
  on(event: "page", handler: (page: unknown) => void): void;
}

/** Minimal structural surface of a native dialog. */
export interface ConfirmDialog {
  type(): string;
  message(): string;
  accept(promptText?: string): Promise<void>;
  dismiss(): Promise<void>;
}

/** Minimal structural surface of a download event — read the suggested name; `saveAs` is used ONLY
 *  by the injected diagnostic save hook (which confines the actual `saveAs`/fs to its own module). */
export interface ConfirmDownload {
  suggestedFilename(): string;
  saveAs(path: string): Promise<void>;
}

export interface ConfirmDeps {
  /** Total observe window after the click. */
  observeWindowMs: number;
  /** Re-read cadence within the window. */
  pollIntervalMs: number;
  /** Salt for the sanitized message/filename hashes (shared `STORAGE_PROBE_SALT`). */
  salt?: string;
  /** Bounded SPA settle before each read (e.g. `waitForSpaHydration`). */
  settleFn: (page: ConfirmPage) => Promise<unknown>;
  /** Injectable sleep so tests run without real timers. */
  sleepFn?: (ms: number) => Promise<void>;
  /**
   * Optional CONTROLLED-SAVE hook: when set, a fired download is saved+validated+deleted by the
   * injected fn (which owns the only `saveAs`/fs). Wired ONLY in the approved-index diagnostic path
   * when `--diagnose-save-review-download` is set; absent everywhere else (observe-and-discard).
   */
  saveDownloadFn?: (download: ConfirmDownload) => Promise<SavedDownloadInspection | undefined>;
}

/** Sanitized observation of a download that fired — filename is hashed, never echoed. */
export interface ConfirmDownloadRecord {
  fired: true;
  extensionCategory: ExtensionCategory;
  filenameLengthBucket: MessageLengthBucket;
  filenameHash: string;
}

/** How the single affirmative control was (or wasn't) bound before any click. */
export type ConfirmBind =
  | "BOUND"
  | "CONFIRM_NOT_CONSENT"
  | "CONFIRM_NOT_FOUND"
  | "CONFIRM_NOT_UNIQUE"
  | "CONFIRM_READ_FAILED";

/** The ONLY shape the confirm-click step contributes to the report. Every leaf is non-sensitive. */
export interface ReviewUsageConfirmResult {
  confirmBind: ConfirmBind;
  confirmClicked: boolean;
  confirmClickedCount: 0 | 1;
  confirmOutcome: ConfirmOutcome;
  modalDisappeared: boolean;
  followUpModalCategory: ModalCategory | null;
  postConfirmDownloadFired: boolean;
  postConfirmAsyncJob: boolean;
  postConfirmToastPresent: boolean;
  postConfirmDialogCategory: DialogMessageCategory | "none";
  postConfirmPopupOpened: boolean;
  postConfirmChecks: number;
  download?: ConfirmDownloadRecord;
  /**
   * Present only when a `saveDownloadFn` was injected (the controlled diagnostic save/upload path) AND
   * a download fired — the sanitized inspection of the saved-then-deleted file (and, on the upload
   * path, its nested backend ingest). Mirrors `ReviewUsageConfirmIndexResult.savedDownload` so the
   * SEMANTIC single-affirmative confirm carries the same save/upload result as the approved-index one.
   */
  savedDownload?: SavedDownloadInspection;
  detail: string;
}

/** Exact top-level key allow-list — used by the offline no-leak test. */
export const REVIEW_USAGE_CONFIRM_KEYS: ReadonlyArray<keyof ReviewUsageConfirmResult> = [
  "confirmBind",
  "confirmClicked",
  "confirmClickedCount",
  "confirmOutcome",
  "modalDisappeared",
  "followUpModalCategory",
  "postConfirmDownloadFired",
  "postConfirmAsyncJob",
  "postConfirmToastPresent",
  "postConfirmDialogCategory",
  "postConfirmPopupOpened",
  "postConfirmChecks",
  "download",
  "savedDownload",
  "detail",
];

/** Sanitized classification of a modal button candidate (no raw text/selector). */
export type ButtonKind = "affirmative" | "cancel" | "other" | "unknown";

/** Sanitized metadata for one badged modal button candidate. */
export interface CandidateMeta {
  index: number;
  buttonKind: ButtonKind;
  visible: boolean;
  enabled: boolean;
  textLengthBucket: MessageLengthBucket;
}

/** Result of the NO-CLICK candidate-index diagnostic. */
export type CandidateScan = "SCANNED" | "CONFIRM_NOT_CONSENT" | "CONFIRM_READ_FAILED";

export interface ReviewUsageCandidatesResult {
  candidateScan: CandidateScan;
  candidateCountBucket: CountBucket;
  candidateIndices: number[];
  candidates: CandidateMeta[];
  detail: string;
}

/** Exact top-level key allow-list for the candidate diagnostic — used by the no-leak test. */
export const REVIEW_USAGE_CANDIDATES_KEYS: ReadonlyArray<keyof ReviewUsageCandidatesResult> = [
  "candidateScan",
  "candidateCountBucket",
  "candidateIndices",
  "candidates",
  "detail",
];

/** The ONLY shape the approved-index confirm step contributes to the report. Every leaf is non-sensitive. */
export interface ReviewUsageConfirmIndexResult {
  approvedIndex: number;
  approvedIndexDecision: ApprovedIndexDecision;
  approvedIndexBind: ApprovedIndexBind;
  approvedIndexClicked: boolean;
  approvedIndexClickedCount: 0 | 1;
  confirmOutcome: ConfirmOutcome;
  modalDisappeared: boolean;
  followUpModalCategory: ModalCategory | null;
  postConfirmDownloadFired: boolean;
  postConfirmAsyncJob: boolean;
  postConfirmToastPresent: boolean;
  postConfirmDialogCategory: DialogMessageCategory | "none";
  postConfirmPopupOpened: boolean;
  postConfirmChecks: number;
  download?: ConfirmDownloadRecord;
  /** Sanitized inspection of a saved-then-deleted download (only when the save hook is wired). */
  savedDownload?: SavedDownloadInspection;
  detail: string;
}

/** Exact top-level key allow-list for the approved-index result — used by the no-leak test. */
export const REVIEW_USAGE_CONFIRM_INDEX_KEYS: ReadonlyArray<keyof ReviewUsageConfirmIndexResult> = [
  "approvedIndex",
  "approvedIndexDecision",
  "approvedIndexBind",
  "approvedIndexClicked",
  "approvedIndexClickedCount",
  "confirmOutcome",
  "modalDisappeared",
  "followUpModalCategory",
  "postConfirmDownloadFired",
  "postConfirmAsyncJob",
  "postConfirmToastPresent",
  "postConfirmDialogCategory",
  "postConfirmPopupOpened",
  "postConfirmChecks",
  "download",
  "savedDownload",
  "detail",
];

function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Coarse count bucket (kept local so this stays import-light). */
function countBucket(n: number): CountBucket {
  if (n <= 0) return "none";
  if (n === 1) return "one";
  if (n <= 5) return "few";
  if (n <= 20) return "some";
  return "many";
}

/** Marker source/flags passed into the in-page scans (single source of truth, rebuilt in the page). */
interface MarkerSrc {
  source: string;
  flags: string;
}
function markerSrc(markers: readonly RegExp[]): MarkerSrc[] {
  return markers.map((m) => ({ source: m.source, flags: m.flags }));
}

/**
 * Bind the single affirmative control inside the visible consent modal, or report why not. The scan
 * is an INLINE anonymous arrow (no named inner helper → no esbuild `__name`). Returns a bind verdict;
 * read failures are caught by the caller and become `CONFIRM_READ_FAILED`.
 */
async function bindAffirmative(page: ConfirmPage): Promise<ConfirmBind> {
  const arg = {
    affirmative: markerSrc(AFFIRMATIVE_MARKERS),
    cancel: markerSrc(CANCEL_MARKERS),
    scopes: [...MODAL_SCOPES],
    buttonSel: BUTTON_SEL,
    stampAttr: STAMP_ATTR,
  };
  const matched = await page.evaluate((a: typeof arg): number => {
    const aff = a.affirmative.map((m) => new RegExp(m.source, m.flags));
    const can = a.cancel.map((m) => new RegExp(m.source, m.flags));
    let container: Element | null = null;
    for (const sel of a.scopes) {
      for (const n of Array.from(document.querySelectorAll(sel))) {
        const hn = n as HTMLElement;
        if (hn.offsetParent !== null || hn.getClientRects().length > 0) {
          container = n;
          break;
        }
      }
      if (container) break;
    }
    if (!container) return 0;
    const hits: Element[] = [];
    for (const el of Array.from(container.querySelectorAll(a.buttonSel))) {
      const he = el as HTMLElement;
      if (!(he.offsetParent !== null || he.getClientRects().length > 0)) continue;
      if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") continue;
      const label = `${el.textContent ?? ""} ${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("title") ?? ""} ${
        (el as HTMLInputElement).value ?? ""
      }`;
      if (can.some((re) => re.test(label))) continue; // cancel/close exclusion wins
      if (!aff.some((re) => re.test(label))) continue;
      hits.push(el);
    }
    const only = hits[0];
    if (hits.length === 1 && only) only.setAttribute(a.stampAttr, "0");
    return hits.length;
  }, arg);

  if (matched === 0) return "CONFIRM_NOT_FOUND";
  if (matched > 1) return "CONFIRM_NOT_UNIQUE";
  const resolved = await page.locator(`[${STAMP_ATTR}="0"]`).count();
  if (resolved === 0) return "CONFIRM_NOT_FOUND";
  if (resolved > 1) return "CONFIRM_NOT_UNIQUE";
  return "BOUND";
}

/** A no-click confirm result (bind failed / not consent / read failed) — inert observation defaults. */
function haltResult(bind: ConfirmBind): ReviewUsageConfirmResult {
  return {
    confirmBind: bind,
    confirmClicked: false,
    confirmClickedCount: 0,
    confirmOutcome: "NO_CHANGE",
    modalDisappeared: false,
    followUpModalCategory: null,
    postConfirmDownloadFired: false,
    postConfirmAsyncJob: false,
    postConfirmToastPresent: false,
    postConfirmDialogCategory: "none",
    postConfirmPopupOpened: false,
    postConfirmChecks: 0,
    detail: `confirm: bind=${bind}; no click`,
  };
}

/**
 * NO-CLICK candidate-index diagnostic. Re-confirm the foreground modal is review-usage consent, then
 * badge every visible modal button with an index (for human inspection) and return sanitized
 * per-candidate metadata only. Never clicks. The scan is an INLINE anonymous arrow (no `__name`).
 */
export async function scanReviewUsageConfirmCandidates(page: ConfirmPage): Promise<ReviewUsageCandidatesResult> {
  let html = "";
  try {
    html = await page.content();
  } catch {
    return readFailedCandidates();
  }
  if (classifyModalCategory(html) !== "review_usage_confirmation") {
    return {
      candidateScan: "CONFIRM_NOT_CONSENT",
      candidateCountBucket: "none",
      candidateIndices: [],
      candidates: [],
      detail: "candidates: foreground modal is not review-usage consent; no scan",
    };
  }

  const arg = {
    affirmative: markerSrc(AFFIRMATIVE_MARKERS),
    cancel: markerSrc(CANCEL_MARKERS),
    scopes: [...MODAL_SCOPES],
    buttonSel: BUTTON_SEL,
    badgeAttr: CAND_INDEX_ATTR,
  };
  let raw: { candidates: Array<{ index: number; kind: string; visible: boolean; enabled: boolean; textLength: number }> };
  try {
    raw = await page.evaluate((a: typeof arg) => {
      // Idempotent: clear any stale index stamps / floating badges from a prior scan in this page,
      // so a re-scan (e.g. the approved-index path's rescan) can never inherit a stale numbering.
      for (const stale of Array.from(document.querySelectorAll("[" + a.badgeAttr + "]"))) {
        stale.removeAttribute(a.badgeAttr);
      }
      for (const oldBadge of Array.from(document.querySelectorAll('[data-sellerops-badge="1"]'))) {
        oldBadge.remove();
      }
      const aff = a.affirmative.map((m) => new RegExp(m.source, m.flags));
      const can = a.cancel.map((m) => new RegExp(m.source, m.flags));
      let container: Element | null = null;
      for (const sel of a.scopes) {
        for (const n of Array.from(document.querySelectorAll(sel))) {
          const hn = n as HTMLElement;
          if (hn.offsetParent !== null || hn.getClientRects().length > 0) {
            container = n;
            break;
          }
        }
        if (container) break;
      }
      const out: Array<{ index: number; kind: string; visible: boolean; enabled: boolean; textLength: number }> = [];
      if (!container) return { candidates: out };
      let idx = 0;
      for (const el of Array.from(container.querySelectorAll(a.buttonSel))) {
        const he = el as HTMLElement;
        const visible = he.offsetParent !== null || he.getClientRects().length > 0;
        const enabled = !(el as HTMLButtonElement).disabled && el.getAttribute("aria-disabled") !== "true";
        const label = `${el.textContent ?? ""} ${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("title") ?? ""} ${
          (el as HTMLInputElement).value ?? ""
        }`.trim();
        const isCancel = can.some((re) => re.test(label));
        const isAff = aff.some((re) => re.test(label));
        const kind = isCancel ? "cancel" : isAff ? "affirmative" : label.length > 0 ? "other" : "unknown";
        el.setAttribute(a.badgeAttr, String(idx));
        // Visible badge for human inspection (index + DERIVED kind only — never the raw button text).
        if (visible) {
          const rect = he.getBoundingClientRect();
          const badge = document.createElement("div");
          badge.setAttribute("data-sellerops-badge", "1");
          badge.textContent = "#" + idx + " " + kind;
          badge.style.position = "fixed";
          badge.style.left = Math.max(0, rect.left) + "px";
          badge.style.top = Math.max(0, rect.top - 14) + "px";
          badge.style.zIndex = "2147483647";
          badge.style.background = "magenta";
          badge.style.color = "white";
          badge.style.font = "bold 11px sans-serif";
          badge.style.padding = "0 3px";
          badge.style.pointerEvents = "none";
          document.body.appendChild(badge);
        }
        out.push({ index: idx, kind, visible, enabled, textLength: label.length });
        idx += 1;
      }
      return { candidates: out };
    }, arg);
  } catch {
    return readFailedCandidates();
  }

  const kinds: ReadonlyArray<ButtonKind> = ["affirmative", "cancel", "other", "unknown"];
  const candidates: CandidateMeta[] = raw.candidates.map((c) => ({
    index: c.index,
    buttonKind: kinds.includes(c.kind as ButtonKind) ? (c.kind as ButtonKind) : "unknown",
    visible: c.visible,
    enabled: c.enabled,
    textLengthBucket: lengthBucket(c.textLength),
  }));

  log("confirm.review-usage-candidates", {
    count: candidates.length,
    affirmative: candidates.filter((c) => c.buttonKind === "affirmative").length,
    cancel: candidates.filter((c) => c.buttonKind === "cancel").length,
    visible: candidates.filter((c) => c.visible).length,
  });

  return {
    candidateScan: "SCANNED",
    candidateCountBucket: countBucket(candidates.length),
    candidateIndices: candidates.map((c) => c.index),
    candidates,
    detail: `candidates: scanned=${candidates.length} (no click)`,
  };
}

function readFailedCandidates(): ReviewUsageCandidatesResult {
  return {
    candidateScan: "CONFIRM_READ_FAILED",
    candidateCountBucket: "none",
    candidateIndices: [],
    candidates: [],
    detail: "candidates: page/content/evaluate read failed; no scan",
  };
}

/** Sanitized post-click observation, shared by the single-affirmative and approved-index click paths. */
interface PostConfirmObservation {
  clicked: boolean;
  confirmOutcome: ConfirmOutcome;
  modalDisappeared: boolean;
  followUpModalCategory: ModalCategory | null;
  postConfirmDownloadFired: boolean;
  postConfirmAsyncJob: boolean;
  postConfirmToastPresent: boolean;
  postConfirmDialogCategory: DialogMessageCategory | "none";
  postConfirmPopupOpened: boolean;
  postConfirmChecks: number;
  download?: ConfirmDownloadRecord;
  savedDownload?: SavedDownloadInspection;
}

/**
 * Wire the dialog / popup / download observers, run the single bound click (`clickFn` — the ONE
 * `.click(` lives in the CALLER's thunk, so each adapter owns exactly one), then poll the post-confirm
 * structure read-only for the bounded window and collapse it into one sanitized observation. Shared by
 * `confirmReviewUsageOnce` and `confirmReviewUsageByIndexOnce` so the post-click logic has one source.
 *
 * When `deps.saveDownloadFn` is set, a fired download is additionally handed to it for the controlled
 * diagnostic save+validate+delete (the fn owns the only `saveAs`/fs); its sanitized inspection is
 * surfaced on the observation. Absent that hook, the download is observed-and-discarded as before.
 */
async function observeBoundConfirmClick(
  page: ConfirmPage,
  ctx: ConfirmContext,
  deps: ConfirmDeps,
  clickFn: () => Promise<void>,
): Promise<PostConfirmObservation> {
  const { observeWindowMs, pollIntervalMs, salt, settleFn, sleepFn = defaultSleep, saveDownloadFn } = deps;

  // Observers set up BEFORE the click (the export-click observers are already released).
  let dialog: DialogRecord | undefined;
  page.on("dialog", (d: ConfirmDialog): void => {
    const type = d.type();
    const message = d.message();
    if (!dialog) {
      dialog = {
        type,
        messageCategory: classifyDialogMessage(message),
        messageLengthBucket: lengthBucket(message.length),
        messageHash: messageFingerprint(salt, message),
        action: type === "alert" ? "accepted" : "dismissed",
      };
    }
    void (type === "alert" ? d.accept() : d.dismiss()).catch(() => undefined);
  });

  let popupOpened = false;
  ctx.on("page", (): void => {
    popupOpened = true;
  });

  let downloadFired = false;
  let download: ConfirmDownloadRecord | undefined;
  let savedDownload: SavedDownloadInspection | undefined;
  const downloadPromise = page
    .waitForEvent("download", { timeout: observeWindowMs })
    .then(async (d) => {
      downloadFired = true;
      const name = d.suggestedFilename();
      download = {
        fired: true,
        extensionCategory: extensionCategory(name),
        filenameLengthBucket: lengthBucket(name.length),
        filenameHash: messageFingerprint(salt, name),
      };
      // Controlled diagnostic save+validate+delete (only when the hook is wired); the fn owns the
      // sole `saveAs`/fs and returns a sanitized inspection — never uploads/persists/writes status.
      if (saveDownloadFn) savedDownload = await saveDownloadFn(d);
    })
    .catch(() => undefined);

  // The single bound click — exactly once, no fallback, no retry (the literal click is in clickFn).
  let clicked = false;
  try {
    await clickFn();
    clicked = true;
  } catch {
    // The bound control did not resolve to an actionable click; we still observe.
  }

  // Slow, repeated read of the post-confirm structure for the bounded window.
  let post = emptyPostClick();
  let lastModalCategory: ModalCategory | null = "review_usage_confirmation";
  let checks = 0;
  const maxChecks = Math.max(1, Math.ceil(observeWindowMs / pollIntervalMs));
  for (let i = 0; i < maxChecks; i += 1) {
    checks += 1;
    try {
      await settleFn(page);
    } catch {
      // Mid-navigation settle failure — keep observing.
    }
    let html = "";
    try {
      html = await page.content();
    } catch {
      // Transient read during a re-render (or a closed page) — skip this snapshot.
    }
    if (html) {
      post = mergePostClick(post, summarizePostClick(html));
      lastModalCategory = classifyModalCategory(html);
    }
    if (downloadFired) break; // got the definitive answer
    if (i + 1 < maxChecks) await sleepFn(pollIntervalMs);
  }
  await downloadPromise; // ensure the download wait has settled before returning

  // The consent modal is "gone" if the latest read is not consent; a NEW non-consent modal is the
  // actionable follow-up.
  const modalDisappeared = lastModalCategory !== "review_usage_confirmation";
  const followUpModalCategory =
    lastModalCategory !== null && lastModalCategory !== "review_usage_confirmation" ? lastModalCategory : null;
  const confirmOutcome = deriveConfirmOutcome({
    downloadFired,
    dialogPresent: dialog !== undefined,
    modalDisappeared,
    followUpModalCategory,
    asyncJobMarkerPresent: post.asyncJobMarkerPresent,
  });

  return {
    clicked,
    confirmOutcome,
    modalDisappeared,
    followUpModalCategory,
    postConfirmDownloadFired: downloadFired,
    postConfirmAsyncJob: post.asyncJobMarkerPresent,
    postConfirmToastPresent: post.toastPresent,
    postConfirmDialogCategory: dialog?.messageCategory ?? "none",
    postConfirmPopupOpened: popupOpened,
    postConfirmChecks: checks,
    download,
    savedDownload,
  };
}

/**
 * Live: re-confirm the consent modal, bind its single affirmative `확인`, click it ONCE, then observe
 * (sanitized) whether a download / follow-up modal / dialog / toast / popup results. A closed/detached
 * page returns a sanitized `CONFIRM_READ_FAILED` halt — never an uncaught exception. The caller must
 * already have `decideReviewUsageConfirm === ATTEMPT`.
 */
export async function confirmReviewUsageOnce(
  page: ConfirmPage,
  ctx: ConfirmContext,
  deps: ConfirmDeps,
): Promise<ReviewUsageConfirmResult> {
  const { observeWindowMs, pollIntervalMs, salt, settleFn, sleepFn = defaultSleep } = deps;

  // 1) Re-confirm the FOREGROUND modal is still the review-usage consent — never confirm anything else.
  let preHtml = "";
  try {
    preHtml = await page.content();
  } catch {
    return haltResult("CONFIRM_READ_FAILED");
  }
  if (classifyModalCategory(preHtml) !== "review_usage_confirmation") {
    return haltResult("CONFIRM_NOT_CONSENT");
  }

  // 2) Bind exactly one modal-scoped affirmative control, or halt without clicking.
  let bind: ConfirmBind;
  try {
    bind = await bindAffirmative(page);
  } catch {
    return haltResult("CONFIRM_READ_FAILED");
  }
  if (bind !== "BOUND") return haltResult(bind);

  // 3) Observe a single bound 확인 click (observers wired BEFORE the click; exactly once, no retry).
  const obs = await observeBoundConfirmClick(page, ctx, deps, () =>
    page.locator(`[${STAMP_ATTR}="0"]`).click({ timeout: CONFIRM_CLICK_TIMEOUT_MS }),
  );

  log("confirm.review-usage", {
    bind,
    clicked: obs.clicked ? 1 : 0,
    checks: obs.postConfirmChecks,
    confirmOutcome: obs.confirmOutcome,
    modalDisappeared: obs.modalDisappeared,
    followUpModalCategory: obs.followUpModalCategory ?? "none",
    downloadFired: obs.postConfirmDownloadFired,
    asyncJobMarkerPresent: obs.postConfirmAsyncJob,
    popupOpened: obs.postConfirmPopupOpened,
    dialogCategory: obs.postConfirmDialogCategory,
  });

  return {
    confirmBind: bind,
    confirmClicked: obs.clicked,
    confirmClickedCount: obs.clicked ? 1 : 0,
    confirmOutcome: obs.confirmOutcome,
    modalDisappeared: obs.modalDisappeared,
    followUpModalCategory: obs.followUpModalCategory,
    postConfirmDownloadFired: obs.postConfirmDownloadFired,
    postConfirmAsyncJob: obs.postConfirmAsyncJob,
    postConfirmToastPresent: obs.postConfirmToastPresent,
    postConfirmDialogCategory: obs.postConfirmDialogCategory,
    postConfirmPopupOpened: obs.postConfirmPopupOpened,
    postConfirmChecks: obs.postConfirmChecks,
    download: obs.download,
    savedDownload: obs.savedDownload,
    detail: `confirm: clicked=${obs.clicked ? 1 : 0} outcome=${obs.confirmOutcome}`,
  };
}

/** A no-click approved-index result (skip / reject / read failure) — inert observation defaults. */
function indexHaltResult(
  approvedIndex: number,
  decision: ApprovedIndexDecision,
  bind: ApprovedIndexBind,
): ReviewUsageConfirmIndexResult {
  return {
    approvedIndex,
    approvedIndexDecision: decision,
    approvedIndexBind: bind,
    approvedIndexClicked: false,
    approvedIndexClickedCount: 0,
    confirmOutcome: "NO_CHANGE",
    modalDisappeared: false,
    followUpModalCategory: null,
    postConfirmDownloadFired: false,
    postConfirmAsyncJob: false,
    postConfirmToastPresent: false,
    postConfirmDialogCategory: "none",
    postConfirmPopupOpened: false,
    postConfirmChecks: 0,
    detail: `confirm-index ${approvedIndex}: decision=${decision} bind=${bind}; no click`,
  };
}

/** Map a metadata-validation bind verdict to the corresponding REJECT_* decision. */
function rejectDecisionFor(bind: ApprovedIndexBind): ApprovedIndexDecision {
  switch (bind) {
    case "INDEX_NOT_FOUND":
      return "REJECT_MISSING";
    case "INDEX_NOT_AFFIRMATIVE":
      return "REJECT_NOT_AFFIRMATIVE";
    case "INDEX_NOT_VISIBLE":
      return "REJECT_NOT_VISIBLE";
    case "INDEX_DISABLED":
      return "REJECT_DISABLED";
    default:
      return "ATTEMPT";
  }
}

/**
 * Live: click EXACTLY the operator-approved candidate index in the review-usage consent modal, ONCE.
 *
 * Re-runs the no-click candidate scan (single source of index numbering + the `data-sellerops-cand-index`
 * stamp), re-validates that the requested index is still an affirmative / visible / enabled control
 * THIS run (so a stale approval from an earlier run cannot click the wrong button), binds the single
 * `[data-sellerops-cand-index="N"]` locator with a `count() === 1` guard, clicks once, and observes. Any
 * miss → a sanitized halt with no click. Caller must already have `decideApprovedIndexConfirm === ATTEMPT`.
 */
export async function confirmReviewUsageByIndexOnce(
  page: ConfirmPage,
  ctx: ConfirmContext,
  deps: ConfirmDeps,
  approvedIndex: number,
): Promise<ReviewUsageConfirmIndexResult> {
  // 1) Rescan: reuses the candidate scan's consent re-check, read-failure handling, and — critically —
  //    its exact index numbering + `data-sellerops-cand-index` stamp (the bind bridge).
  const scan = await scanReviewUsageConfirmCandidates(page);
  if (scan.candidateScan === "CONFIRM_READ_FAILED") {
    return indexHaltResult(approvedIndex, "ATTEMPT", "CONFIRM_READ_FAILED");
  }
  if (scan.candidateScan === "CONFIRM_NOT_CONSENT") {
    return indexHaltResult(approvedIndex, "SKIP_NOT_CONSENT", "CONFIRM_NOT_CONSENT");
  }

  // 2) Validate the requested index against the (sanitized) candidate metadata — affirmative+visible+enabled.
  const metaBind = decideApprovedIndexBind({ candidates: scan.candidates, requestedIndex: approvedIndex });
  if (metaBind !== "BOUND") {
    return indexHaltResult(approvedIndex, rejectDecisionFor(metaBind), metaBind);
  }

  // 3) Bind the single stamped control for the approved index; require exactly one match (else halt).
  let resolved: number;
  try {
    resolved = await page.locator(`[${CAND_INDEX_ATTR}="${approvedIndex}"]`).count();
  } catch {
    return indexHaltResult(approvedIndex, "ATTEMPT", "CONFIRM_READ_FAILED");
  }
  if (resolved === 0) return indexHaltResult(approvedIndex, "ATTEMPT", "INDEX_NOT_FOUND");
  if (resolved > 1) return indexHaltResult(approvedIndex, "ATTEMPT", "INDEX_NOT_UNIQUE");

  // 4) Observe a single bound click on EXACTLY the approved index (the one `.click(` is in the thunk).
  const obs = await observeBoundConfirmClick(page, ctx, deps, () =>
    page.locator(`[${CAND_INDEX_ATTR}="${approvedIndex}"]`).click({ timeout: CONFIRM_CLICK_TIMEOUT_MS }),
  );

  log("confirm.review-usage-index", {
    approvedIndex,
    clicked: obs.clicked ? 1 : 0,
    checks: obs.postConfirmChecks,
    confirmOutcome: obs.confirmOutcome,
    modalDisappeared: obs.modalDisappeared,
    followUpModalCategory: obs.followUpModalCategory ?? "none",
    downloadFired: obs.postConfirmDownloadFired,
    asyncJobMarkerPresent: obs.postConfirmAsyncJob,
    popupOpened: obs.postConfirmPopupOpened,
    dialogCategory: obs.postConfirmDialogCategory,
  });

  return {
    approvedIndex,
    approvedIndexDecision: "ATTEMPT",
    approvedIndexBind: "BOUND",
    approvedIndexClicked: obs.clicked,
    approvedIndexClickedCount: obs.clicked ? 1 : 0,
    confirmOutcome: obs.confirmOutcome,
    modalDisappeared: obs.modalDisappeared,
    followUpModalCategory: obs.followUpModalCategory,
    postConfirmDownloadFired: obs.postConfirmDownloadFired,
    postConfirmAsyncJob: obs.postConfirmAsyncJob,
    postConfirmToastPresent: obs.postConfirmToastPresent,
    postConfirmDialogCategory: obs.postConfirmDialogCategory,
    postConfirmPopupOpened: obs.postConfirmPopupOpened,
    postConfirmChecks: obs.postConfirmChecks,
    download: obs.download,
    savedDownload: obs.savedDownload,
    detail: `confirm-index ${approvedIndex}: clicked=${obs.clicked ? 1 : 0} outcome=${obs.confirmOutcome}`,
  };
}
