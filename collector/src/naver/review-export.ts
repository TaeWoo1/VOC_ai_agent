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

function matchWording(text: string): { re: RegExp; keyword: string } | undefined {
  return EXPORT_WORDING.find(({ re }) => re.test(text));
}

/**
 * Pure: find top-document interactive elements that read like an actionable export
 * trigger — matching export/download wording AND visible AND enabled. A disabled or
 * hidden control is deliberately excluded (it is not actionable yet, e.g. gated
 * behind a search step), so it is not treated as a sync trigger. Comment text is
 * stripped first so a marker word inside an HTML comment can't fabricate a
 * candidate. Operates on serialized HTML, so it is fully offline-testable.
 */
export function findExportCandidates(rawHtml: string): ExportCandidate[] {
  const html = stripComments(rawHtml);
  const out: ExportCandidate[] = [];

  const consider = (tag: string, attrs: string, inner: string): void => {
    if (isDisabled(attrs) || isHidden(attrs)) return;
    // Accessible name only — visible text + aria-label/title/value. Deliberately
    // NOT the whole attribute string, so a class/href like `excel-btn` can't
    // false-match. `value` counts as visible-ish text (e.g. <input value="...">).
    const visibleText = `${stripTags(inner)} ${readAttr(attrs, "value") ?? ""}`;
    const ariaLabel = readAttr(attrs, "aria-label") ?? "";
    const title = readAttr(attrs, "title") ?? "";
    const matched = matchWording(`${visibleText} ${ariaLabel} ${title}`);
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
export function buildTriggerSelectors(rawHtml: string): string[] {
  const candidates = findExportCandidates(rawHtml);
  const selectors: string[] = [];
  const push = (s: string): void => {
    if (s && !selectors.includes(s)) selectors.push(s);
  };

  if (candidates.some((c) => c.dataExportReview)) push(PREFERRED_TRIGGER_SELECTOR);
  for (const c of candidates) {
    if (c.dataExportReview) continue;
    if (c.id) {
      push(`#${c.id}`);
      continue;
    }
    const isRoleButton = c.tag !== "button" && c.tag !== "a" && c.tag !== "input";
    // Scope prefix + the enabled guard, parallel across visible-text and attribute
    // selectors so a gated control is still never targeted.
    const scope = isRoleButton ? `${c.tag}[role="button"]` : c.tag;
    const guard = isRoleButton ? ':not([aria-disabled="true"])' : ":not([disabled])";

    if (c.tag === "input") {
      push(`input[type="button"][value*="${c.keyword}"], input[type="submit"][value*="${c.keyword}"]`);
    } else if (c.inText) {
      push(`${scope}:has-text("${c.keyword}")${guard}`);
    }
    // Attribute fallbacks for controls whose keyword is only in aria-label/title
    // (e.g. an icon button with no visible text).
    if (c.inAriaLabel) push(`${scope}[aria-label*="${c.keyword}"]${guard}`);
    if (c.inTitle) push(`${scope}[title*="${c.keyword}"]${guard}`);
  }
  // Defensive fallback: classify said SYNC but nothing built a selector.
  if (selectors.length === 0) push(PREFERRED_TRIGGER_SELECTOR);
  return selectors;
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
    try {
      const download = await downloadPromise;
      if (options.classifyOnly) {
        // The download event alone proves the export is sync. Do NOT persist the
        // real file — milestone-1 is discovery, not ingestion. The browser's temp
        // artifact is discarded on context close; nothing lands in downloadDir.
        log("export.captured", { kind, classifyOnly: true });
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
