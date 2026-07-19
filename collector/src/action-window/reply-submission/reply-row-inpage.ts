/**
 * **In-page (browser) review-row extraction helpers** — the read-only JS the live driver and the calibration
 * CLI run inside `page.evaluate`, applied over the operator-calibrated relative structural paths. Everything
 * here is sanitized IN-PAGE: only coarse results (a 1..5 rating, a `RecencyBucket` enum, a 64-hex fingerprint,
 * an opaque page signature, structural counts) ever cross back — never a raw review body, date string, rating
 * markup, selector, or class name.
 *
 * Exports STRINGS (browser JS source) so the module stays browser-type-free and source-scannable. The row/element
 * addressing is by **element-child index path** (relative to the row root), matching the paths the calibration CLI
 * captures — no NAVER selector is ever embedded. The recency bucket is derived from an explicit KST as-of date
 * (passed in), replicating the backend `ReviewRecencyBucket` boundaries, using a pure civil-day computation (no
 * `Date` / wall-clock / timezone assumption).
 */
import { IN_PAGE_FINGERPRINT_FN } from "./review-body-fingerprint-inpage";
import { REVIEW_ROW_CONTAINER_GROUPS } from "./reply-row-mapping-artifact";

const GROUPS_JSON = JSON.stringify(REVIEW_ROW_CONTAINER_GROUPS);

/**
 * Shared in-page helpers (no I/O, no click, no mutation of NAVER state):
 *  - `__awDaysFromCivil(y,m,d)` — civil date → integer day number (Howard Hinnant), for tz-free date diffs.
 *  - `__awDescend(root, path)` — walk element-child indices from a row root; null if any step is out of range.
 *  - `__awParseRating(el)` — coarse 1..5 from an aria-label / text integer or filled-star count; null if unknown.
 *  - `__awParseBucket(el, asofY, asofM, asofD)` — coarse `TODAY`/`THIS_WEEK`/`OLDER` vs the KST as-of date; null
 *     if the row's date cannot be read. Raw dates never leave the page — only the bucket enum does.
 *  - `__awPageSignature(groupIdx)` — an opaque structural fingerprint of the row group (counts + tag skeleton),
 *     used to detect a drifted/other page; never content.
 * Plus the fingerprint functions from {@link IN_PAGE_FINGERPRINT_FN}.
 */
export const IN_PAGE_ROW_HELPERS = `${IN_PAGE_FINGERPRINT_FN}
var __awGroups = ${GROUPS_JSON};
function __awDaysFromCivil(y, m, d) {
  y -= m <= 2 ? 1 : 0;
  var era = Math.floor((y >= 0 ? y : y - 399) / 400);
  var yoe = y - era * 400;
  var doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  var doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}
function __awDescend(root, path) {
  var el = root;
  for (var i = 0; i < path.length; i++) {
    if (!el || !el.children || path[i] < 0 || path[i] >= el.children.length) { return null; }
    el = el.children[path[i]];
  }
  return el || null;
}
function __awRows(parentPath, rowTag) {
  var parent = __awDescend(document.body, parentPath);
  if (!parent || !parent.children) { return []; }
  return Array.prototype.filter.call(parent.children, function (c) { return c.tagName === rowTag; });
}
function __awParseRating(el) {
  if (!el) { return null; }
  var texts = [];
  var al = el.getAttribute && el.getAttribute('aria-label');
  if (al) { texts.push(al); }
  var inner = el.querySelectorAll ? el.querySelectorAll('[aria-label]') : [];
  for (var i = 0; i < inner.length; i++) { texts.push(inner[i].getAttribute('aria-label') || ''); }
  texts.push((el.textContent || ''));
  for (var j = 0; j < texts.length; j++) {
    var mm = texts[j].match(/([1-5])\\s*(?:점|stars?|\\/\\s*5|점만점|out of 5)/i);
    if (mm) { return parseInt(mm[1], 10); }
  }
  // Fallback: a bare 1..5 integer as the whole rating text.
  var t = (el.textContent || '').trim();
  if (/^[1-5]$/.test(t)) { return parseInt(t, 10); }
  // Fallback: count "filled" star-ish descendants.
  var filled = el.querySelectorAll ? el.querySelectorAll('[class*="on"], [class*="full"], [class*="filled"], [class*="active"], [aria-pressed="true"]') : [];
  var starish = 0;
  for (var k = 0; k < filled.length; k++) {
    var c = (filled[k].className && filled[k].className.toString ? filled[k].className.toString() : '').toLowerCase();
    if (c.indexOf('star') >= 0 || c.indexOf('rate') >= 0 || c.indexOf('rating') >= 0) { starish++; }
  }
  return starish >= 1 && starish <= 5 ? starish : null;
}
function __awParseBucket(el, ay, am, ad) {
  if (!el) { return null; }
  var y = null, mo = null, d = null;
  var dt = el.getAttribute && (el.getAttribute('datetime') || (el.querySelector && el.querySelector('[datetime]') ? el.querySelector('[datetime]').getAttribute('datetime') : ''));
  var txt = (dt || el.textContent || '').trim();
  var abs = txt.match(/(\\d{4})[.\\-\\/](\\d{1,2})[.\\-\\/](\\d{1,2})/);
  var asOfDays = __awDaysFromCivil(ay, am, ad);
  var rowDays = null;
  if (abs) {
    rowDays = __awDaysFromCivil(parseInt(abs[1], 10), parseInt(abs[2], 10), parseInt(abs[3], 10));
  } else if (/오늘|today/i.test(txt)) {
    rowDays = asOfDays;
  } else if (/어제|yesterday/i.test(txt)) {
    rowDays = asOfDays - 1;
  } else {
    var rel = txt.match(/(\\d+)\\s*(일|day|days|주|week|weeks)\\s*(?:전|ago)/i);
    if (rel) {
      var n = parseInt(rel[1], 10);
      rowDays = asOfDays - (/주|week/i.test(rel[2]) ? n * 7 : n);
    }
  }
  if (rowDays === null) { return null; }
  var before = asOfDays - rowDays;
  if (before <= 0) { return 'TODAY'; }
  if (before <= 6) { return 'THIS_WEEK'; }
  return 'OLDER';
}
function __awPageSignature() {
  // Group-independent structural fingerprint of the review region: per generic group, its row count and a
  // shallow tag/child skeleton. Sensitive to a drifted/other page, but computed WITHOUT needing to know which
  // group the mapping chose (so it can be evaluated once, before the artifact is loaded).
  var s = '';
  for (var g = 0; g < __awGroups.length; g++) {
    var rows = Array.prototype.slice.call(document.querySelectorAll(__awGroups[g]));
    s += 'G' + g + ':' + rows.length + ';';
    for (var i = 0; i < rows.length && i < 32; i++) {
      s += rows[i].tagName + '/' + (rows[i].children ? rows[i].children.length : 0) + ',';
    }
  }
  var fp = 0;
  for (var c = 0; c < s.length; c++) { fp = (fp * 31 + s.charCodeAt(c)) | 0; }
  return 'sig_' + (fp >>> 0).toString(16);
}`;

// The builders below embed the helper declarations INSIDE a single IIFE expression: `page.evaluate(string)`
// evaluates one expression, so helper statements must not sit at the top level beside the IIFE.

/** A standalone evaluate string returning the opaque, group-independent structural page signature. */
export function inPagePageSignature(): string {
  return `(() => {
${IN_PAGE_ROW_HELPERS}
return __awPageSignature();
})()`;
}

/**
 * A standalone evaluate string that censuses EVERY row in the group via the calibrated paths and returns a
 * sanitized per-row `{rating, recencyBucket, bodyFingerprint}` array (each field coarse or null). The mapping
 * paths + the KST as-of date are structural/date-only values (no text), safe to interpolate.
 */
export function inPageRowCensus(mapping: {
  parentPath: readonly number[];
  rowTag: string;
  ratingPath: readonly number[];
  datePath: readonly number[];
  bodyPath: readonly number[];
}, asOfDate: string): string {
  const [ay, am, ad] = asOfDate.split("-").map((x) => parseInt(x, 10));
  const m = JSON.stringify(mapping);
  return `(async () => {
${IN_PAGE_ROW_HELPERS}
  var M = ${m};
  var rows = __awRows(M.parentPath, M.rowTag);
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var rating = __awParseRating(__awDescend(row, M.ratingPath));
    var bucket = __awParseBucket(__awDescend(row, M.datePath), ${ay}, ${am}, ${ad});
    var bodyEl = __awDescend(row, M.bodyPath);
    var fp = bodyEl ? await __awReviewBodyFingerprint(bodyEl.textContent || '') : null;
    out.push({ rating: rating, recencyBucket: bucket, bodyFingerprint: fp });
  }
  return out;
})()`;
}

/**
 * A standalone evaluate string that fingerprints the body of a SINGLE row (the calibrated `rowIndex`) via the
 * body path — for the cross-source equality preflight. Returns the 64-hex fingerprint, or null if the row/body
 * cannot be addressed. The raw body never crosses back.
 */
export function inPageRowFingerprintAt(mapping: {
  parentPath: readonly number[];
  rowTag: string;
  rowIndex: number;
  bodyPath: readonly number[];
}): string {
  const m = JSON.stringify(mapping);
  return `(async () => {
${IN_PAGE_ROW_HELPERS}
  var M = ${m};
  var rows = __awRows(M.parentPath, M.rowTag);
  var row = rows[M.rowIndex];
  if (!row) { return null; }
  var bodyEl = __awDescend(row, M.bodyPath);
  if (!bodyEl) { return null; }
  return await __awReviewBodyFingerprint(bodyEl.textContent || '');
})()`;
}

/** A standalone evaluate string returning how many rows the mapped parent holds (for calibrated-row locate). */
export function inPageRowCount(mapping: { parentPath: readonly number[]; rowTag: string }): string {
  const m = JSON.stringify(mapping);
  return `(() => {
${IN_PAGE_ROW_HELPERS}
  var M = ${m};
  return __awRows(M.parentPath, M.rowTag).length;
})()`;
}

/**
 * READ-ONLY annotation of the uniquely-matched row (`matchedRowIndex`, the DOM index the driver's census
 * decided) and its reply control: sets `data-aw-reply-row-target` / `data-aw-reply-control-target` markers and a
 * visible outline the seated operator can see, and scrolls it into view. NEVER clicks, types, or submits — a
 * marker + outline are inert visual annotations, exactly the reply driver's existing read-only idiom. Returns 1
 * when the row was found and annotated, else 0.
 */
export function inPageAnnotateRow(mapping: {
  parentPath: readonly number[];
  rowTag: string;
  matchedRowIndex: number;
  replyControlPath: readonly number[];
}): string {
  const m = JSON.stringify(mapping);
  return `(() => {
${IN_PAGE_ROW_HELPERS}
  var M = ${m};
  var rows = __awRows(M.parentPath, M.rowTag);
  var row = rows[M.matchedRowIndex];
  if (!row) { return 0; }
  row.setAttribute('data-aw-reply-row-target', '1');
  row.style.outline = '3px solid #2b6cff';
  row.style.outlineOffset = '2px';
  var ctrl = __awDescend(row, M.replyControlPath);
  if (ctrl && ctrl.setAttribute) {
    ctrl.setAttribute('data-aw-reply-control-target', '1');
    ctrl.style.outline = '2px dashed #2b6cff';
  }
  if (row.scrollIntoView) { row.scrollIntoView({ block: 'center' }); }
  return 1;
})()`;
}

/** Arm a plain observer for the operator's OWN click that opens the reply control — records a boolean only. */
export const IN_PAGE_ARM_ROW_OBSERVER = `(() => {
  window.__awReplyRowObserved = false;
  var ctrl = document.querySelector('[data-aw-reply-control-target]') || document.querySelector('[data-aw-reply-row-target]');
  var handler = function () { window.__awReplyRowObserved = true; };
  window.__awReplyRowHandler = handler;
  if (ctrl) { ctrl.addEventListener('click', handler, true); }
  return true;
})()`;

/** Tear down the row markers, outlines, observer, and flag. Idempotent; read-only. */
export const IN_PAGE_ROW_TEARDOWN = `(() => {
  var row = document.querySelector('[data-aw-reply-row-target]');
  if (row) { row.removeAttribute('data-aw-reply-row-target'); row.style.outline = ''; row.style.outlineOffset = ''; }
  var ctrl = document.querySelector('[data-aw-reply-control-target]');
  if (ctrl) {
    ctrl.removeAttribute('data-aw-reply-control-target');
    ctrl.style.outline = '';
    if (window.__awReplyRowHandler) { ctrl.removeEventListener('click', window.__awReplyRowHandler, true); }
  }
  try { delete window.__awReplyRowObserved; delete window.__awReplyRowHandler; }
  catch (e) { window.__awReplyRowObserved = undefined; window.__awReplyRowHandler = undefined; }
  return true;
})()`;
