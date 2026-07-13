import { urlCategory } from "./session-check";
import type { UrlCategory } from "./session-probe";
import type { SessionVerdict } from "./session-verdict";
import {
  traceExportTargetReadiness,
  type ExportTargetReadiness,
  type ExportTargetReadinessBranch,
} from "./export-target-readiness";

/**
 * Debug-safe EXPORT-AREA structural probe — PURE + SANITIZED.
 *
 * Companion to `session-probe.ts`. The session probe answered "are we logged
 * in?"; this one answers "where is the review-export affordance, and why didn't
 * `review-export.ts` recognize it?". The last live milestone-1 run passed the
 * session gate (LOGGED_IN) but classified the export area as
 * LAYOUT_UNRECOGNIZED with `exportCandidateCount:"none"`. Before guessing new
 * selectors we observe the page structure with a fixed, non-sensitive signal
 * set so the next live run can distinguish:
 *
 *   - a *missing selector* (export keywords/controls ARE on the main document,
 *     our placeholder markers just don't match them),
 *   - a *hidden / gated export UI* (export controls exist but are disabled, or
 *     only appear after a search/date-filter step), and
 *   - an *iframe / sub-route* (export keywords are absent from the main document
 *     but a child frame, or a different route, hosts them).
 *
 * SAFETY CONTRACT: identical to `session-probe.ts`. Every field of
 * `SanitizedExportProbeSignals` is a boolean, a small bucketed number, a fixed
 * category enum, an array of fixed category enums, or the readiness gate's own
 * sanitized result object (itself only enums + one coarse bucket). No field is
 * derived by copying a substring of the input — they are all match/no-match
 * booleans, counts bucketed to a category, or URL/decision categories. So
 * `JSON.stringify(extractExportProbeSignals(x))` can never contain a store name,
 * account, product, review text, id, token, label, selector, or raw URL from the
 * input. This is asserted by an offline hostile-fixture test.
 */

export type CountBucket = "none" | "one" | "few" | "some" | "many";
/** Same buckets, plus "unknown" for live-only scalars not supplied offline. */
export type OptionalCountBucket = "unknown" | CountBucket;

/** Raw, un-sanitized snapshot. The CLI fills this from a live page; tests pass it directly. */
export interface RawExportProbeInput {
  /** Raw URL — used ONLY to derive a coarse category; never echoed back. */
  url: string;
  /** Serialized DOM HTML — scanned for marker presence/counts; never echoed back. */
  html: string;
  /**
   * Live-only: raw URLs of every frame on the page (from `page.frames()`). Each
   * is reduced to a coarse `UrlCategory`; the raw frame URLs are never echoed.
   * Omit offline → `frameUrlCategories` is empty.
   */
  frameUrls?: string[];
  /** Live-only: number of DOM elements that host an open shadow root. */
  shadowRootHostCount?: number;
  /** Live-only: count of keyword-matched interactive export candidates (total). */
  exportCandidateTotal?: number;
  /** Live-only: how many of those candidates are visible (rendered, non-collapsed). */
  exportCandidateVisible?: number;
  /** Live-only: how many of those candidates are enabled (not disabled/aria-disabled). */
  exportCandidateEnabled?: number;
}

/** The ONLY shape ever printed/logged by the export probe. All fields are non-sensitive. */
export interface SanitizedExportProbeSignals {
  urlCategory: UrlCategory;
  reviewRouteLike: boolean;
  // Structural context (HTML-derived counts, bucketed).
  iframeCount: CountBucket;
  buttonCount: CountBucket;
  anchorCount: CountBucket;
  roleButtonCount: CountBucket;
  disabledControlCount: CountBucket;
  downloadAttributeCount: CountBucket;
  dateInputCount: CountBucket;
  tableGridListCount: CountBucket;
  // Row-shape signals — the diagnostic pair for the Run-1 false-positive-empty finding.
  // `semanticRowCount` mirrors EXACTLY what the readiness gate's `countDataRows` sees
  // (`<tbody><tr>` + `role="row"`); `dataRowLikeCount` is a strict superset that also
  // counts div-based / virtualized / ARIA-attribute grid rows the readiness counter
  // misses. A gap (semantic `none`, dataRowLike `some`/`many`) is a false-positive-empty.
  semanticRowCount: CountBucket;
  dataRowLikeCount: CountBucket;
  // The REAL readiness-gate decision for this document, emitted verbatim. `semanticRowCount`
  // above is only a row-count proxy — this pair is what `evaluateExportTargetReadiness` (the
  // gate the live driver actually consults) DECIDES on the same HTML: `readiness` is its exact
  // sanitized output (enums/coarse bucket only) and `readinessBranch` records which precedence
  // rung fired (e.g. an empty MARKER short-circuiting before rows are counted vs. `zero_rows`).
  // Added so the read-only probe OBSERVES the gate's live decision instead of inferring it from
  // row proxies — the §8-11/Run-2 diagnostic gap.
  readiness: ExportTargetReadiness;
  readinessBranch: ExportTargetReadinessBranch;
  // Generic export-intent keyword categories (presence only; never the matched text).
  excelLike: boolean;
  downloadLike: boolean;
  exportLike: boolean;
  csvOrXlsxLike: boolean;
  reviewLike: boolean;
  searchLike: boolean;
  // Live-only signals (degrade to empty / "unknown" offline).
  frameUrlCategories: UrlCategory[];
  shadowRootHostCount: OptionalCountBucket;
  exportCandidateCount: OptionalCountBucket;
  visibleExportCandidateCount: OptionalCountBucket;
  enabledExportCandidateCount: OptionalCountBucket;
}

/** Exact set of keys the probe may emit — used by the offline allow-list test. */
export const SANITIZED_EXPORT_PROBE_KEYS: ReadonlyArray<keyof SanitizedExportProbeSignals> = [
  "urlCategory",
  "reviewRouteLike",
  "iframeCount",
  "buttonCount",
  "anchorCount",
  "roleButtonCount",
  "disabledControlCount",
  "downloadAttributeCount",
  "dateInputCount",
  "tableGridListCount",
  "semanticRowCount",
  "dataRowLikeCount",
  "readiness",
  "readinessBranch",
  "excelLike",
  "downloadLike",
  "exportLike",
  "csvOrXlsxLike",
  "reviewLike",
  "searchLike",
  "frameUrlCategories",
  "shadowRootHostCount",
  "exportCandidateCount",
  "visibleExportCandidateCount",
  "enabledExportCandidateCount",
];

// Generic keyword categories — drive only booleans; the matched text is never returned.
// PLACEHOLDERS in the observation sense: confirmed/extended via this probe, NOT yet
// promoted into `review-export.ts` selectors (observation first, not selector guessing).
const EXCEL_MARKERS = [/엑셀/, /excel/i, /\bxls\b/i];
const DOWNLOAD_MARKERS = [/다운로드/, /download/i, /내려받기/];
const EXPORT_MARKERS = [/내보내기/, /export/i, /추출/];
const CSV_XLSX_MARKERS = [/\.csv\b/i, /\bcsv\b/i, /\.xlsx?\b/i, /\bxlsx\b/i];
const REVIEW_MARKERS = [/리뷰/, /review/i, /구매평|상품평|평점/];
const SEARCH_MARKERS = [/검색/, /조회/, /search/i, /필터/, /filter/i];

// Counted structural markers (global flags so `.match` returns every occurrence).
const IFRAME_RE = /<iframe\b/gi;
const BUTTON_RE = /<button\b/gi;
const ANCHOR_RE = /<a\b/gi;
const ROLE_BUTTON_RE = /role=["']button["']/gi;
const DISABLED_RE = /\sdisabled(?=[\s=>/])/gi;
const DOWNLOAD_ATTR_RE = /\sdownload(?=[\s=>/])/gi;
const DATE_INPUT_RE = /type=["']date["']|date[-_]?picker|calendar|달력|날짜\s*선택/gi;
const TABLE_GRID_LIST_RE = /<table\b|role=["'](?:grid|table|row|list)["']|<ul\b|<ol\b/gi;

// --- row-shape markers (drive only bucketed counts; matched text is never returned) ---
// Semantic rows — exactly what the readiness gate's `countDataRows` counts.
const TBODY_BLOCK_RE = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/gi;
const TR_RE = /<tr[\s>]/gi;
const ROLE_ROW_RE = /role=["']row["']/gi;
const ROLE_COLHEADER_RE = /role=["']columnheader["']/gi;
// Broad div-grid / virtualized row estimators (each ≈ one row; used via MAX, not summed,
// so a row carrying several markers is not double-counted). Deliberately targeted to
// data-row semantics — bare layout utilities like `flex-row` are excluded to avoid
// inflating the count on every page.
const ARIA_ROWINDEX_RE = /\baria-rowindex\s*=/gi;
const DATA_ROW_ATTR_RE = /\bdata-(?:row-?key|row-?index|rowindex|row-?id|rowid|index)\s*=/gi;
const ROLE_LISTITEM_RE = /role=["']listitem["']/gi;
const ROW_CLASS_RE =
  /class\s*=\s*["'][^"']*(?:list[-_]?item|table[-_]?row|grid[-_]?row|data[-_]?row|row[-_]?item|__row\b|--row\b)[^"']*["']/gi;

const anyMatch = (markers: RegExp[], html: string): boolean => markers.some((re) => re.test(html));
const countMatches = (re: RegExp, html: string): number => (html.match(re) ?? []).length;

function bucket(n: number): CountBucket {
  if (n <= 0) return "none";
  if (n === 1) return "one";
  if (n <= 5) return "few";
  if (n <= 20) return "some";
  return "many";
}

function optionalBucket(n?: number): OptionalCountBucket {
  if (n === undefined || n < 0) return "unknown";
  return bucket(n);
}

/**
 * Pure: count SEMANTIC data rows — the exact shape the readiness gate's `countDataRows`
 * sees (`<tbody><tr>` + `role="row"` minus a header row). Kept structurally identical so
 * the probe's `semanticRowCount` bucket faithfully reflects what the gate would count.
 */
function countSemanticRows(html: string): number {
  let bodyRows = 0;
  for (const block of html.matchAll(TBODY_BLOCK_RE)) {
    bodyRows += countMatches(TR_RE, block[1] ?? "");
  }
  const roleRows = countMatches(ROLE_ROW_RE, html);
  const headerRows = countMatches(ROLE_COLHEADER_RE, html) > 0 ? 1 : 0;
  return bodyRows + Math.max(0, roleRows - headerRows);
}

/**
 * Pure: broad "data-row-like" estimate — a strict SUPERSET of `countSemanticRows` that
 * also recognizes div-based / virtualized / ARIA-attribute grid rows (the shape the Run-1
 * probe confirmed NAVER renders and the readiness gate misses). Each estimator independently
 * approximates the row count; we take the MAX (not the sum) so a single row carrying several
 * markers is not double-counted, and the result is `>= countSemanticRows` by construction.
 * Observational only — this signal informs a later readiness correction; it does not itself
 * decide anything (per collector §6, correct the gate from observed findings, never guess-tune).
 */
function countDataRowLike(html: string): number {
  return Math.max(
    countSemanticRows(html),
    countMatches(ARIA_ROWINDEX_RE, html),
    countMatches(DATA_ROW_ATTR_RE, html),
    countMatches(ROLE_LISTITEM_RE, html),
    countMatches(ROW_CLASS_RE, html),
  );
}

/** Categorize live frame URLs, dedupe, and sort — order-independent, sanitized. */
function frameCategories(frameUrls?: string[]): UrlCategory[] {
  if (!frameUrls || frameUrls.length === 0) return [];
  const cats = new Set<UrlCategory>();
  for (const u of frameUrls) cats.add(urlCategory(u));
  return [...cats].sort();
}

/**
 * Pure: raw export-area snapshot → sanitized signals. No field copies input
 * text; see the SAFETY CONTRACT above. Deterministic and browser-free, so it is
 * fully offline-unit-tested (including a hostile PII fixture). Live-only inputs
 * (frames, shadow roots, visible/enabled candidate counts) degrade to empty /
 * "unknown" when not supplied, so the same function runs identically offline.
 */
export function extractExportProbeSignals(input: RawExportProbeInput): SanitizedExportProbeSignals {
  const { url } = input;
  // Strip HTML comments before scanning: they are never rendered affordances, and
  // marker words inside a comment (e.g. "excel"/"disabled" in a doc note) would
  // otherwise inflate the keyword booleans and disabled-control count.
  const html = input.html.replace(/<!--[\s\S]*?-->/g, " ");
  // Feed the gate the RAW html (not `html`): `traceExportTargetReadiness` does its own
  // comment-stripping AND passes the raw string to the pre-click range reader, so this mirrors
  // EXACTLY what the live driver's readiness call decides on the same page.
  const readinessTrace = traceExportTargetReadiness(input.html);
  return {
    urlCategory: urlCategory(url),
    reviewRouteLike: /review/i.test(url) || /#\/review/i.test(url) || /리뷰|review/i.test(html),
    iframeCount: bucket(countMatches(IFRAME_RE, html)),
    buttonCount: bucket(countMatches(BUTTON_RE, html)),
    anchorCount: bucket(countMatches(ANCHOR_RE, html)),
    roleButtonCount: bucket(countMatches(ROLE_BUTTON_RE, html)),
    disabledControlCount: bucket(countMatches(DISABLED_RE, html)),
    downloadAttributeCount: bucket(countMatches(DOWNLOAD_ATTR_RE, html)),
    dateInputCount: bucket(countMatches(DATE_INPUT_RE, html)),
    tableGridListCount: bucket(countMatches(TABLE_GRID_LIST_RE, html)),
    semanticRowCount: bucket(countSemanticRows(html)),
    dataRowLikeCount: bucket(countDataRowLike(html)),
    readiness: readinessTrace.readiness,
    readinessBranch: readinessTrace.branch,
    excelLike: anyMatch(EXCEL_MARKERS, html),
    downloadLike: anyMatch(DOWNLOAD_MARKERS, html),
    exportLike: anyMatch(EXPORT_MARKERS, html),
    csvOrXlsxLike: anyMatch(CSV_XLSX_MARKERS, html),
    reviewLike: anyMatch(REVIEW_MARKERS, html),
    searchLike: anyMatch(SEARCH_MARKERS, html),
    frameUrlCategories: frameCategories(input.frameUrls),
    shadowRootHostCount: optionalBucket(input.shadowRootHostCount),
    exportCandidateCount: optionalBucket(input.exportCandidateTotal),
    visibleExportCandidateCount: optionalBucket(input.exportCandidateVisible),
    enabledExportCandidateCount: optionalBucket(input.exportCandidateEnabled),
  };
}

/* ------------------------------------------------------------------------- *
 * Frame-aware aggregation (PURE).
 *
 * `extractExportProbeSignals` above sanitizes ONE document. The frame-aware
 * probe runs it once per frame (top document + every child frame) and then
 * folds the per-frame results into a single sanitized summary with this pure,
 * browser-free aggregator. Keeping the fold here (not inline in the live CLI)
 * makes the summary fields unit-testable and keeps the no-leak contract in one
 * place: the aggregator only reads already-sanitized signals + category enums,
 * so it can never reintroduce raw URL/HTML/label/PII. Asserted by an offline
 * allow-list + hostile-fixture test, exactly like the per-document sanitizer.
 * ------------------------------------------------------------------------- */

/** Why a child frame's sanitized signals are present, blocked, or empty. */
export type FrameReadResult = "read" | "blocked" | "empty";

/** One child frame's read outcome. `signals` is null unless `readResult === "read"`. */
export interface FrameExportProbe {
  /** Coarse category of the frame's URL — never the raw URL. */
  frameUrlCategory: UrlCategory;
  readResult: FrameReadResult;
  signals: SanitizedExportProbeSignals | null;
}

/** The ONLY shape ever printed by the frame-aware probe. Every leaf is non-sensitive. */
export interface FrameAwareExportProbe {
  /** Five-state session judgment (gate), from the top document's session probe. */
  sessionVerdict: SessionVerdict;
  /** Bucketed total frame count (top document + child frames). */
  frameCount: CountBucket;
  /** True iff some frame (top or child) exposes a visible AND enabled export candidate. */
  anyFrameExportCandidates: boolean;
  /** The top (main) document's sanitized export signals. */
  topDocument: SanitizedExportProbeSignals;
  /** One entry per child frame (the top document is reported separately, above). */
  frames: FrameExportProbe[];
}

/** Exact set of top-level keys the frame-aware probe may emit — used by the allow-list test. */
export const FRAME_AWARE_EXPORT_PROBE_KEYS: ReadonlyArray<keyof FrameAwareExportProbe> = [
  "sessionVerdict",
  "frameCount",
  "anyFrameExportCandidates",
  "topDocument",
  "frames",
];

/** Exact set of per-child-frame keys — used by the allow-list test. */
export const FRAME_EXPORT_PROBE_KEYS: ReadonlyArray<keyof FrameExportProbe> = [
  "frameUrlCategory",
  "readResult",
  "signals",
];

/** A count bucket that actually indicates ≥1 (excludes "none" and the live-only "unknown"). */
function isPositiveBucket(b: OptionalCountBucket): boolean {
  return b !== "none" && b !== "unknown";
}

/** A document exposes an actionable export control iff it has a visible AND enabled candidate. */
function hasActionableExportCandidate(signals: SanitizedExportProbeSignals): boolean {
  return (
    isPositiveBucket(signals.visibleExportCandidateCount) &&
    isPositiveBucket(signals.enabledExportCandidateCount)
  );
}

/**
 * Pure: fold the top document + per-frame sanitized signals into one summary.
 * `frameCount` buckets the total frames (top + children); `anyFrameExportCandidates`
 * ORs the actionable-candidate test across the top document and every successfully
 * read child frame. No field copies input text — see the SAFETY CONTRACT above.
 */
export function summarizeFrameExportProbes(input: {
  sessionVerdict: SessionVerdict;
  topDocument: SanitizedExportProbeSignals;
  frames: FrameExportProbe[];
}): FrameAwareExportProbe {
  const { sessionVerdict, topDocument, frames } = input;
  const anyChildHasCandidate = frames.some(
    (f) => f.signals !== null && hasActionableExportCandidate(f.signals),
  );
  return {
    sessionVerdict,
    frameCount: bucket(frames.length + 1),
    anyFrameExportCandidates: hasActionableExportCandidate(topDocument) || anyChildHasCandidate,
    topDocument,
    frames,
  };
}
