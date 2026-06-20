import { resolve } from "node:path";
import { log } from "../log";
import type { PwPage } from "../profile";
import type { ExportOutcome } from "../status";

export type ExportPageKind = "SYNC_DOWNLOAD" | "ASYNC_JOB" | "UNRECOGNIZED";

// An async export sends the file to a download center / job list (request → poll →
// fetch later). These are page-level text markers; an async affordance must win
// over a direct download control so an async export is never mistaken for a sync
// capture. PLACEHOLDERS still, but confirmed against the live page's wording.
const ASYNC_JOB_MARKERS = [
  /다운로드\s*목록/,
  /다운로드\s*센터/,
  /다운로드\s*요청/,
  /처리\s*중/,
  /대기열/,
  /download[-\s]?center/i,
  /export[-\s]?(queue|job)/i,
];

// A sync export is a direct, immediate download control. The live milestone-1
// probe showed a top-document, visible, ENABLED Excel/download affordance that the
// old placeholder selector (`[data-export='review']`) and the old plain-text
// markers did NOT match — the page exposes the control with its own markup. So we
// no longer rely on a single hardcoded selector or on bare page text: we look for
// an *interactive* element (button / anchor / role=button / input button) whose
// accessible wording reads like an export/download control AND that is visible and
// enabled. Plain text outside an interactive element is intentionally NOT a sync
// signal (it is usually guidance copy, not a trigger).
//
// `keyword` is the literal used to build a Playwright text selector for the click.
// Deliberately narrow: bare `파일` (matches file upload/attach/select) and bare
// `다운` (a loose fragment) are excluded to avoid false positives on unrelated
// admin controls — `다운로드` already covers the common Korean download wording.
const EXPORT_WORDING: ReadonlyArray<{ re: RegExp; keyword: string }> = [
  { re: /엑셀/, keyword: "엑셀" },
  { re: /다운로드/, keyword: "다운로드" },
  { re: /내려받기/, keyword: "내려받기" },
  { re: /excel/i, keyword: "excel" },
  { re: /download/i, keyword: "download" },
  { re: /xlsx/i, keyword: "xlsx" },
  { re: /csv/i, keyword: "csv" },
];

/** A top-document interactive element that looks like an actionable export trigger. */
interface ExportCandidate {
  tag: string;
  keyword: string;
  dataExportReview: boolean;
  id?: string;
  /** Which accessible sources carried the keyword — drives selector fallbacks. */
  inText: boolean;
  inAriaLabel: boolean;
  inTitle: boolean;
}

const stripComments = (html: string): string => html.replace(/<!--[\s\S]*?-->/g, " ");
const stripTags = (s: string): string => s.replace(/<[^>]*>/g, " ");

function readAttr(attrs: string, name: string): string | undefined {
  const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"));
  return m ? m[1] : undefined;
}

/** Boolean (valueless or any-value) attribute presence, e.g. `disabled` / `hidden`. */
function hasBoolAttr(attrs: string, name: string): boolean {
  return new RegExp(`\\b${name}(?=[\\s=>/]|$)`, "i").test(attrs);
}

function isDisabled(attrs: string): boolean {
  return hasBoolAttr(attrs, "disabled") || readAttr(attrs, "aria-disabled") === "true";
}

function isHidden(attrs: string): boolean {
  return (
    hasBoolAttr(attrs, "hidden") ||
    readAttr(attrs, "aria-hidden") === "true" ||
    readAttr(attrs, "type") === "hidden" ||
    /display\s*:\s*none|visibility\s*:\s*hidden/i.test(readAttr(attrs, "style") ?? "")
  );
}

/**
 * Pure: scan top-document interactive elements (button / anchor / role=button /
 * input button) and return those whose accessible name matches `wording`, are
 * visible + enabled, and do NOT match any `exclude` pattern. Accessible name is
 * visible text + aria-label/title/value only — deliberately NOT the whole
 * attribute string, so a class/href like `excel-btn` can't false-match. Comment
 * text is stripped first so a marker word inside an HTML comment can't fabricate a
 * candidate. Shared by the export-trigger finder and the modal-confirm finder, so
 * both apply the same visibility/enabled discipline. Offline-testable.
 */
function scanInteractiveElements(
  rawHtml: string,
  wording: ReadonlyArray<{ re: RegExp; keyword: string }>,
  exclude: readonly RegExp[] = [],
): ExportCandidate[] {
  const html = stripComments(rawHtml);
  const out: ExportCandidate[] = [];

  const consider = (tag: string, attrs: string, inner: string): void => {
    if (isDisabled(attrs) || isHidden(attrs)) return;
    const visibleText = `${stripTags(inner)} ${readAttr(attrs, "value") ?? ""}`;
    const ariaLabel = readAttr(attrs, "aria-label") ?? "";
    const title = readAttr(attrs, "title") ?? "";
    const accessible = `${visibleText} ${ariaLabel} ${title}`;
    if (exclude.some((re) => re.test(accessible))) return; // e.g. never treat 취소 as confirm
    const matched = wording.find(({ re }) => re.test(accessible));
    if (!matched) return;
    out.push({
      tag,
      keyword: matched.keyword,
      dataExportReview: readAttr(attrs, "data-export") === "review",
      id: readAttr(attrs, "id"),
      inText: matched.re.test(visibleText),
      inAriaLabel: matched.re.test(ariaLabel),
      inTitle: matched.re.test(title),
    });
  };

  // <button>…</button> and <a>…</a> with inner text.
  for (const m of html.matchAll(/<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
    consider((m[1] ?? "").toLowerCase(), m[2] ?? "", m[3] ?? "");
  }
  // role="button" containers that are not already a <button>/<a>.
  for (const m of html.matchAll(
    /<(?!a\b|button\b)([a-z][a-z0-9]*)\b([^>]*\brole\s*=\s*["']button["'][^>]*)>([\s\S]*?)<\/\1>/gi,
  )) {
    consider((m[1] ?? "").toLowerCase(), m[2] ?? "", m[3] ?? "");
  }
  // <input type="button|submit"> — accessible text comes from its value attribute.
  for (const m of html.matchAll(/<input\b([^>]*?)\/?>/gi)) {
    const attrs = m[1] ?? "";
    const type = (readAttr(attrs, "type") ?? "").toLowerCase();
    if (type !== "button" && type !== "submit") continue;
    consider("input", attrs, "");
  }
  return out;
}

/**
 * Pure: find top-document interactive elements that read like an actionable export
 * trigger — matching export/download wording AND visible AND enabled. A disabled or
 * hidden control is deliberately excluded (it is not actionable yet, e.g. gated
 * behind a search step), so it is not treated as a sync trigger.
 */
export function findExportCandidates(rawHtml: string): ExportCandidate[] {
  return scanInteractiveElements(rawHtml, EXPORT_WORDING);
}

/**
 * Pure: classify the export area from its rendered HTML. An async/job affordance
 * wins over a direct control. Otherwise a sync download is recognized when an
 * actionable (visible + enabled) interactive export control is present — no longer
 * dependent on a single hardcoded selector or on bare page text. Unknown layout →
 * UNRECOGNIZED so the run halts instead of guessing.
 */
export function classifyExportPage(rawHtml: string): ExportPageKind {
  const html = stripComments(rawHtml);
  if (ASYNC_JOB_MARKERS.some((re) => re.test(html))) return "ASYNC_JOB";
  if (findExportCandidates(html).length > 0) return "SYNC_DOWNLOAD";
  return "UNRECOGNIZED";
}

// Legacy/preferred selector kept as a first attempt when the page exposes it; it is
// no longer the sole trigger. The text/role selectors below are derived from the
// actually-present actionable candidates.
const PREFERRED_TRIGGER_SELECTOR = "[data-export='review']";
// Per-click actionability budget (Playwright waits for visible + enabled). Kept
// short so a non-matching selector falls through to the next quickly; the download
// itself gets the longer DOWNLOAD_TIMEOUT_MS.
const TRIGGER_CLICK_TIMEOUT_MS = 8_000;
const DOWNLOAD_TIMEOUT_MS = 15_000;
// Shorter per-attempt budget for ordered modal-confirm selectors so trying several
// alternatives (most specific → general) stays bounded; the most specific should
// match first. The download itself still gets the full DOWNLOAD_TIMEOUT_MS.
const MODAL_CONFIRM_CLICK_TIMEOUT_MS = 4_000;

/**
 * Pure: build an ordered, deduped list of Playwright selectors for the actionable
 * export candidates on the page. Priority: `[data-export='review']` when a
 * candidate exposes it → `#id` → visible-text selector
 * (`:has-text(<keyword>)`) → attribute fallback selectors
 * (`[aria-label*=...]` / `[title*=...]`) for controls whose keyword lives in an
 * accessible attribute rather than visible text. Each selector still passes through
 * Playwright's actionability checks at click time, so a disabled/hidden element is
 * never clicked.
 */
/**
 * Pure: the ordered Playwright selector variants that target one matched
 * interactive element — `#id` → visible-text `:has-text(<keyword>)` →
 * `[aria-label*=...]` → `[title*=...]`, each carrying the enabled guard so a
 * gated control is never targeted. Shared by the trigger and modal-confirm paths.
 */
function selectorVariantsFor(c: ExportCandidate): string[] {
  if (c.id) return [`#${c.id}`];
  const isRoleButton = c.tag !== "button" && c.tag !== "a" && c.tag !== "input";
  const scope = isRoleButton ? `${c.tag}[role="button"]` : c.tag;
  const guard = isRoleButton ? ':not([aria-disabled="true"])' : ":not([disabled])";
  const out: string[] = [];
  if (c.tag === "input") {
    out.push(`input[type="button"][value*="${c.keyword}"], input[type="submit"][value*="${c.keyword}"]`);
  } else if (c.inText) {
    out.push(`${scope}:has-text("${c.keyword}")${guard}`);
  }
  // Attribute fallbacks for controls whose keyword is only in aria-label/title
  // (e.g. an icon button with no visible text).
  if (c.inAriaLabel) out.push(`${scope}[aria-label*="${c.keyword}"]${guard}`);
  if (c.inTitle) out.push(`${scope}[title*="${c.keyword}"]${guard}`);
  return out;
}

export function buildTriggerSelectors(rawHtml: string): string[] {
  const candidates = findExportCandidates(rawHtml);
  const selectors: string[] = [];
  const push = (s: string): void => {
    if (s && !selectors.includes(s)) selectors.push(s);
  };

  if (candidates.some((c) => c.dataExportReview)) push(PREFERRED_TRIGGER_SELECTOR);
  for (const c of candidates) {
    if (c.dataExportReview) continue;
    for (const s of selectorVariantsFor(c)) push(s);
  }
  // Defensive fallback: classify said SYNC but nothing built a selector.
  if (selectors.length === 0) push(PREFERRED_TRIGGER_SELECTOR);
  return selectors;
}

// A post-click confirmation/warning modal can sit between the export trigger and
// the actual download (the live milestone-1 verification clicked the export button
// successfully but no download fired — a confirm/warning dialog intervened). We
// confirm ONLY a safe action and never click cancel/close.
//
// Auto-confirm is intentionally limited to 확인 — the action the observed NAVER
// export modal uses. 동의 is too legally meaningful to auto-click; 계속 / 다운로드
// can appear in unrelated flows. Add others only when a specific observed modal
// requires them.
const SAFE_CONFIRM_WORDING: ReadonlyArray<{ re: RegExp; keyword: string }> = [
  { re: /확인/, keyword: "확인" },
];
const CANCEL_WORDING: readonly RegExp[] = [/취소/, /닫기/, /\bcancel\b/i, /\bclose\b/i];
const MODAL_MARKERS: readonly RegExp[] = [
  /role\s*=\s*["'](?:dialog|alertdialog)["']/i,
  /aria-modal\s*=\s*["']true["']/i,
  /\b(?:class|id)\s*=\s*["'][^"']*(?:modal|dialog|popup|layer|overlay)[^"']*["']/i,
];

export interface ModalConfirm {
  hasModal: boolean;
  /**
   * Ordered, deduped confirm-action selectors to try in turn. Empty when a modal
   * is present but offers no safe 확인 action (e.g. only 취소/닫기, or only 동의/계속)
   * — the caller must then NOT guess another control.
   */
  confirmSelectors: string[];
}

/** Is a class token (e.g. `modal-dialog`) present on any element's class attribute? */
function hasClass(html: string, cls: string): boolean {
  return new RegExp(`class\\s*=\\s*["'][^"']*\\b${cls}\\b[^"']*["']`, "i").test(html);
}

/**
 * Ordered modal scope selectors that are actually present in the HTML. NAVER's
 * export modal is class-based Bootstrap/Angular markup (`.modal-dialog`,
 * `.modal-content`, `.modal-footer`, `.seller-btn-area`) with no ARIA role, so
 * those class containers must be scoped BEFORE the precise role/aria scopes; only
 * then is a global match considered. `:visible` skips hidden/duplicate modals.
 */
function presentModalScopes(html: string): string[] {
  const scopes: string[] = [];
  for (const cls of ["modal-dialog", "modal-content", "modal-footer", "seller-btn-area"]) {
    if (hasClass(html, cls)) scopes.push(`.${cls}:visible`);
  }
  if (/role\s*=\s*["']dialog["']/i.test(html)) scopes.push('[role="dialog"]');
  if (/role\s*=\s*["']alertdialog["']/i.test(html)) scopes.push('[role="alertdialog"]');
  if (/aria-modal\s*=\s*["']true["']/i.test(html)) scopes.push('[aria-modal="true"]');
  return scopes;
}

/**
 * Pure: build the ordered confirm-action selectors for a detected modal whose safe
 * confirm element is `confirm` (only 확인; cancel/close already excluded). Within a
 * class-based dialog the footer's primary button is tried first, then any primary
 * button, then any 확인 button — each scoped to a visible modal container so a
 * stray/hidden 확인 elsewhere can't be hit. Role/aria scopes and the candidate's own
 * selectors follow, with a global 확인-only selector as the last resort.
 */
function buildConfirmSelectors(html: string, confirm: ExportCandidate): string[] {
  const kw = confirm.keyword; // "확인"
  const out: string[] = [];
  const push = (s: string): void => {
    if (s && !out.includes(s)) out.push(s);
  };

  if (confirm.id) push(`#${confirm.id}`); // a unique id is the most precise
  const scopes = presentModalScopes(html);
  for (const scope of scopes) {
    const isClassScope = scope.startsWith(".");
    if (scope.startsWith(".modal-dialog") || scope.startsWith(".modal-content")) {
      push(`${scope} .modal-footer button.btn-primary:has-text("${kw}"):not([disabled])`);
    }
    if (isClassScope) push(`${scope} button.btn-primary:has-text("${kw}"):not([disabled])`);
    push(`${scope} button:has-text("${kw}"):not([disabled])`);
  }
  // Candidate-derived fallbacks (anchor / role=button / aria-label / title / id),
  // scoped to the strongest present modal container to avoid a global text match.
  const strongest = scopes[0];
  for (const v of selectorVariantsFor(confirm)) {
    push(strongest && !v.startsWith("#") ? `${strongest} ${v}` : v);
  }
  // Global last resort — still 확인-only and only after modal markers matched.
  push(`button:has-text("${kw}"):not([disabled])`);
  return out;
}

/**
 * Pure: detect a post-click confirmation/warning modal and, if present, the ordered
 * SAFE confirm-action selectors (only 확인). Cancel/close controls are excluded, so a
 * modal that offers only 취소/닫기 (or only 동의/계속) returns `hasModal:true` with an
 * EMPTY `confirmSelectors` — the caller must not guess another control. Operates on
 * serialized HTML → offline-testable.
 */
export function findModalConfirm(rawHtml: string): ModalConfirm {
  const html = stripComments(rawHtml);
  if (!MODAL_MARKERS.some((re) => re.test(html))) return { hasModal: false, confirmSelectors: [] };
  const confirm = scanInteractiveElements(html, SAFE_CONFIRM_WORDING, CANCEL_WORDING)[0];
  if (!confirm) return { hasModal: true, confirmSelectors: [] };
  return { hasModal: true, confirmSelectors: buildConfirmSelectors(html, confirm) };
}

export interface ExportResult {
  outcome: ExportOutcome;
  filePath?: string;
}

export interface RunExportOptions {
  /**
   * Classify-only (milestone-1 discovery): prove the sync mechanism from the
   * Playwright download event WITHOUT persisting the real export. No `saveAs` is
   * called, so nothing is written into `downloadDir`; the browser's temporary
   * download artifact is discarded when the context closes. CAPTURED is returned
   * with no `filePath`, and the caller must not upload it.
   */
  classifyOnly?: boolean;
  /**
   * Validation-bridge guard (the same-session CAPTURE path): make the one-click
   * bound STRUCTURAL. The page must yield EXACTLY ONE trigger selector; that single
   * control is clicked at most once with NO fallback loop. If more than one (or zero)
   * trigger selector would be tried, refuse WITHOUT clicking (`DOWNLOAD_FAILED`); if
   * the single click fails or yields no download, return `DOWNLOAD_FAILED` with no
   * retry. The post-click safe-confirm (확인) of that single trigger is unchanged.
   * Default callers leave this unset and keep the ordered-fallback behavior.
   */
  strictSingleCandidate?: boolean;
}

/**
 * Live: on the export page, classify the mechanism and — only for a sync
 * download — trigger and capture the file. The trigger is found from the page's
 * actual actionable controls (see `buildTriggerSelectors`), trying each in order
 * until a download arrives; Playwright's actionability checks ensure a
 * disabled/hidden control is never clicked. Async jobs are DETECTED only (no
 * polling/loop in this slice). Every failure resolves to a specific ExportOutcome;
 * CAPTURED is returned only when a download actually arrived, so a fake success is
 * impossible. In classify-only mode the file is NOT persisted (no `saveAs`), so
 * CAPTURED carries no `filePath`. LIVE-ONLY.
 */
export type ExtensionCategory = "xlsx" | "xls" | "csv" | "zip" | "html" | "txt" | "unknown";

/**
 * Pure: categorize a suggested download filename by its extension WITHOUT echoing
 * the raw filename (which can carry a store name / date / id). Only the fixed
 * category enum is ever logged.
 */
export function extensionCategory(filename: string): ExtensionCategory {
  const ext = filename.toLowerCase().match(/\.([a-z0-9]+)\s*$/)?.[1] ?? "";
  switch (ext) {
    case "xlsx":
      return "xlsx";
    case "xls":
      return "xls";
    case "csv":
      return "csv";
    case "zip":
      return "zip";
    case "html":
    case "htm":
      return "html";
    case "txt":
      return "txt";
    default:
      return "unknown";
  }
}

/** Pure: collapse a Playwright failure string to a fixed category — never log the raw string. */
function downloadFailureCategory(failure: string | null): "canceled" | "failed" {
  return failure && /cancel/i.test(failure) ? "canceled" : "failed";
}

type ModalOutcome = "no-modal" | "confirmed" | "no-safe-confirm";

/**
 * Live: after the export trigger click, handle a confirmation/warning modal if one
 * intervened before the download. Tries the ordered SAFE confirm selectors (only
 * 확인) until one clicks; returns `no-safe-confirm` (so the caller halts as
 * DOWNLOAD_FAILED) when a modal is present but offers only cancel/close, or when
 * none of the safe selectors resolve. A short per-attempt budget keeps the ordered
 * fallback from stacking long waits. LIVE-ONLY.
 */
async function confirmExportModal(page: PwPage): Promise<ModalOutcome> {
  const modal = findModalConfirm(await page.content());
  if (!modal.hasModal) return "no-modal";
  if (modal.confirmSelectors.length === 0) return "no-safe-confirm";
  for (const selector of modal.confirmSelectors) {
    try {
      await page.click(selector, { timeout: MODAL_CONFIRM_CLICK_TIMEOUT_MS });
      return "confirmed";
    } catch {
      // This safe-confirm selector did not resolve; try the next, more general one.
    }
  }
  return "no-safe-confirm";
}

export async function runExport(
  page: PwPage,
  downloadDir: string,
  options: RunExportOptions = {},
): Promise<ExportResult> {
  const html = await page.content();
  const kind = classifyExportPage(html);
  if (kind === "UNRECOGNIZED") {
    log("export.classify", { kind, outcome: "LAYOUT_UNRECOGNIZED" });
    return { outcome: "LAYOUT_UNRECOGNIZED" };
  }
  if (kind === "ASYNC_JOB") {
    log("export.classify", { kind, outcome: "ASYNC_JOB_DETECTED" });
    return { outcome: "ASYNC_JOB_DETECTED" };
  }

  log("export.classify", { kind });
  const selectors = buildTriggerSelectors(html);
  if (options.strictSingleCandidate && selectors.length !== 1) {
    // Strict single-candidate (capture-export-same-session): only ONE unambiguous
    // trigger may be clicked, with no fallback. Anything but exactly one selector → do
    // NOT click; halt as DOWNLOAD_FAILED. `selectorCount` is a count, never a selector.
    log("export.strict_single_violation", { kind, selectorCount: selectors.length }, "error");
    return { outcome: "DOWNLOAD_FAILED" };
  }
  for (const selector of selectors) {
    const downloadPromise = page.waitForEvent("download", { timeout: DOWNLOAD_TIMEOUT_MS });
    try {
      await page.click(selector, { timeout: TRIGGER_CLICK_TIMEOUT_MS });
    } catch {
      // This selector did not resolve to an actionable control; abandon its
      // pending download wait and try the next candidate.
      void downloadPromise.catch(() => undefined);
      continue;
    }
    // A confirmation/warning modal may sit between the trigger and the download.
    const modal = await confirmExportModal(page);
    if (modal === "no-safe-confirm") {
      // Modal present but only unsafe actions (e.g. 취소/닫기) — do NOT guess; halt.
      void downloadPromise.catch(() => undefined);
      log("export.download_failed", { kind, reason: "modal_no_safe_confirm" }, "error");
      return { outcome: "DOWNLOAD_FAILED" };
    }
    try {
      const download = await downloadPromise;
      if (options.classifyOnly) {
        // The download event proves the export is sync, but the stream may still be
        // in flight — wait for it to FINISH (so we don't close Chrome mid-download),
        // WITHOUT persisting it. `download.path()` waits for completion and rejects
        // on a failed/canceled download; we never `saveAs`, never read contents, and
        // nothing lands in downloadDir — the browser's temp artifact is discarded on
        // context close. Only a sanitized extension category is logged.
        const suggestedExtensionCategory = extensionCategory(download.suggestedFilename());
        try {
          await download.path();
        } catch {
          const reason = downloadFailureCategory(await download.failure().catch(() => null));
          log("export.download_failed", { kind, classifyOnly: true, downloadCompleted: false, reason }, "error");
          return { outcome: "DOWNLOAD_FAILED" };
        }
        log("export.captured", {
          kind,
          classifyOnly: true,
          downloadCompleted: true,
          suggestedExtensionCategory,
        });
        return { outcome: "CAPTURED" };
      }
      const filePath = resolve(downloadDir, download.suggestedFilename());
      await download.saveAs(filePath);
      log("export.captured", { kind });
      return { outcome: "CAPTURED", filePath };
    } catch {
      // Clicked, but no download arrived for this candidate — try the next one.
      continue;
    }
  }
  log("export.download_failed", { kind }, "error");
  return { outcome: "DOWNLOAD_FAILED" };
}
