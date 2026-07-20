/**
 * **In-page (browser) review-id DISCOVERY LADDER** — the read-only JS that looks for the channel's own review
 * identifier on a live review list, in a fixed inspection order.
 *
 * Everything is sanitized **inside the page**: every candidate identifier is fingerprinted in-page via
 * `review-id-fingerprint/v1` and only the 64-hex digest crosses back. **No raw identifier, review body, date
 * string, selector, class name, URL, or attribute name ever leaves the browser.** The runtime therefore cannot
 * leak a review id even by logging its own probe result verbatim.
 *
 * Strictly read-only: it queries and reads the DOM. It never clicks, focuses, navigates, types, dispatches an
 * event, or mutates page state — with the single exception of {@link inPageOutlineRowAt}, which sets an outline
 * on the matched row (and {@link IN_PAGE_ID_OUTLINE_TEARDOWN}, which removes it).
 *
 * ## The ladder
 *
 * | # | Rung | Row-attributable? |
 * |---|---|---|
 * | 1 | `visible-text` — text rendered in the row | yes |
 * | 2 | `anchor-href` — path segments + query values of `<a href>` inside the row | yes |
 * | 3 | `input-value` — `value` of inputs/checkboxes/options inside the row | yes |
 * | 4 | `data-attribute` — `data-*`, `id`, `name` attribute values inside the row | yes |
 * | 5 | `page-state` — embedded JSON blobs (`__NEXT_DATA__`, `application/json` scripts, …) | **no** |
 *
 * Rung 5 (and the CLI-side `network-response` rung) can prove the identifier is **exposed by the surface**, but
 * cannot say **which row** it belongs to — a page-level JSON blob has no row binding the runtime may rely on.
 * They are therefore reported as *presence evidence only* and are never fed to the locator as row candidates.
 * That distinction is deliberate: locating the wrong row is the failure this whole milestone exists to prevent.
 */
import { IN_PAGE_REVIEW_ID_FINGERPRINT_FN } from "./review-id-fingerprint-inpage";
import { IN_PAGE_ROW_HELPERS } from "./reply-row-inpage";
import { REVIEW_ROW_CONTAINER_GROUPS } from "./reply-row-mapping-artifact";

const GROUPS_JSON = JSON.stringify(REVIEW_ROW_CONTAINER_GROUPS);

/** Hard caps so a hostile or enormous page can never turn the probe into an unbounded scan. */
export const MAX_CANDIDATE_ROWS = 200;
export const MAX_TOKENS_PER_RUNG = 32;
/** A row container with less text than this is chrome (a header, a toolbar), not a review. */
export const MIN_ROW_TEXT_LENGTH = 30;
/** How far the scan may widen from an innermost row to an ancestor that exclusively contains it. */
export const MAX_SCOPE_ASCENT = 6;
/** The marker attribute the outline helper sets — the ONLY page mutation in this module. */
export const ID_MATCH_MARKER_ATTRIBUTE = "data-aw-id-match";

/**
 * Shared in-page ladder helpers. Builds on {@link IN_PAGE_ROW_HELPERS} (rating/bucket/descend/signature) and
 * {@link IN_PAGE_REVIEW_ID_FINGERPRINT_FN} (the id canonicalizer + digest).
 *
 *  - `__awIdRows()` — the candidate review rows: elements matching the generic structural groups, deduped,
 *    reduced to the INNERMOST containers (an element containing another candidate is dropped, so a `li` wrapping
 *    an `article` never double-counts), text-thresholded, and capped. Sets `__awIdRowsTruncated` when the cap
 *    bit, because a dropped row means "not found" would be a claim the scan never established.
 *  - `__awIdTokens(text)` — id-shaped tokens: digit runs of 6..20, and alphanumeric/`-`/`_` runs of 8..40.
 *    Returns `{list, truncated}` for the same reason: a dropped token can be the target.
 *  - `__awFingerprintAll(tokens)` — `Promise<string[]>` of distinct non-null fingerprints, capped.
 *  - `__awUniqueRowRating(row)` — a 1..5 rating, read **aria-labels first** (the rating control's own
 *    semantics, which a review body never occupies) and falling back to the row's text only if no label
 *    offers one. Either way it demands a **single distinct reading**: a row whose text says "별점 1점 주고
 *    싶네요" beside a rendered "5점" yields null, which the locator treats as *unavailable* rather than as a
 *    disagreement. This matters because the row is scanned whole here — unlike the calibrated-path parser,
 *    which is handed just the rating element — so a naive read would find the rating inside the review body
 *    and fail a CORRECT identity match on a fabricated secondary conflict.
 */
export const IN_PAGE_ID_HELPERS = `${IN_PAGE_ROW_HELPERS}
${IN_PAGE_REVIEW_ID_FINGERPRINT_FN}
var __awIdGroups = ${GROUPS_JSON};
var __awIdRowsTruncated = false;
var __awIdTokensTruncated = false;
function __awIdRows() {
  var all = [];
  for (var g = 0; g < __awIdGroups.length; g++) {
    var found = document.querySelectorAll(__awIdGroups[g]);
    for (var i = 0; i < found.length; i++) {
      if (all.indexOf(found[i]) < 0) { all.push(found[i]); }
    }
  }
  var innermost = [];
  for (var a = 0; a < all.length; a++) {
    var containsAnother = false;
    for (var b = 0; b < all.length; b++) {
      if (a !== b && all[a].contains(all[b])) { containsAnother = true; break; }
    }
    if (containsAnother) { continue; }
    var text = (all[a].textContent || '').trim();
    if (text.length < ${MIN_ROW_TEXT_LENGTH}) { continue; }
    innermost.push(all[a]);
    if (innermost.length >= ${MAX_CANDIDATE_ROWS}) { __awIdRowsTruncated = a < all.length - 1; break; }
  }
  return innermost;
}
function __awIdTokens(text) {
  var out = [];
  var s = text == null ? '' : String(text);
  var digits = s.match(/[0-9]{6,20}/g) || [];
  for (var i = 0; i < digits.length; i++) { if (out.indexOf(digits[i]) < 0) { out.push(digits[i]); } }
  var alnum = s.match(/[A-Za-z0-9][A-Za-z0-9_-]{7,39}/g) || [];
  for (var j = 0; j < alnum.length; j++) { if (out.indexOf(alnum[j]) < 0) { out.push(alnum[j]); } }
  if (out.length > ${MAX_TOKENS_PER_RUNG}) { __awIdTokensTruncated = true; }
  return out.slice(0, ${MAX_TOKENS_PER_RUNG});
}
async function __awFingerprintAll(tokens) {
  var out = [];
  for (var i = 0; i < tokens.length; i++) {
    if (out.length >= ${MAX_TOKENS_PER_RUNG}) { __awIdTokensTruncated = true; break; }
    var fp = await __awReviewIdFingerprint(tokens[i]);
    if (fp && out.indexOf(fp) < 0) { out.push(fp); }
  }
  return out;
}
function __awUniqueRowRating(row) {
  // Collect every 1..5 reading the row offers. Ambiguity is answered with null, never with a guess: a wrong
  // secondary fact would fail a CORRECT identity match, which is worse than asserting nothing.
  // The Korean rating suffixes are written as \\u escapes to keep this emitted source ASCII-only.
  var readings = [];
  var collect = function (text) {
    var m = (text || '').match(/([1-5])\\s*(?:\\uc810|stars?|\\/\\s*5|\\uc810\\ub9cc\\uc810|out of 5)/gi) || [];
    for (var i = 0; i < m.length; i++) {
      var d = m[i].match(/[1-5]/);
      if (d && readings.indexOf(d[0]) < 0) { readings.push(d[0]); }
    }
  };
  var labelled = row.querySelectorAll ? row.querySelectorAll('[aria-label]') : [];
  for (var l = 0; l < labelled.length && l < 64; l++) { collect(labelled[l].getAttribute('aria-label')); }
  if (readings.length === 1) { return parseInt(readings[0], 10); }
  if (readings.length > 1) { return null; }
  collect(row.textContent || '');
  return readings.length === 1 ? parseInt(readings[0], 10) : null;
}
function __awDecode(s) {
  // A single malformed escape anywhere on the page must not abort the whole ladder.
  try { return decodeURIComponent(s); } catch (e) { return s; }
}
function __awScopeFor(row, rows) {
  // The innermost-container rule keeps an <article> and drops the <li> that wraps it, but a surface may
  // carry the review number on that OUTER wrapper. Walk up while the parent EXCLUSIVELY contains this row
  // (no other candidate row inside it): anything on such an ancestor belongs to this row alone, so widening
  // the scan to it cannot create a second claimant and cannot break the exactly-one rule.
  var scope = row;
  for (var depth = 0; depth < ${MAX_SCOPE_ASCENT}; depth++) {
    var parent = scope.parentElement;
    if (!parent || parent === document.body || parent === document.documentElement) { break; }
    var exclusive = true;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i] !== row && parent.contains(rows[i])) { exclusive = false; break; }
    }
    if (!exclusive) { break; }
    scope = parent;
  }
  return scope;
}
function __awHrefTokens(row) {
  var texts = [];
  var anchors = row.querySelectorAll ? row.querySelectorAll('a[href]') : [];
  var list = Array.prototype.slice.call(anchors);
  if (row.tagName === 'A' && row.getAttribute('href')) { list.push(row); }
  for (var i = 0; i < list.length && i < 64; i++) {
    var raw = list[i].getAttribute('href') || '';
    if (!raw || raw.charAt(0) === '#') { continue; }
    var url;
    try { url = new URL(raw, document.baseURI); } catch (e) { continue; }
    var segments = url.pathname.split('/');
    for (var s = 0; s < segments.length; s++) { if (segments[s]) { texts.push(__awDecode(segments[s])); } }
    url.searchParams.forEach(function (v) { if (v) { texts.push(v); } });
    if (url.hash && url.hash.length > 1) { texts.push(__awDecode(url.hash.slice(1))); }
  }
  return texts;
}
function __awValueTokens(row) {
  var texts = [];
  var nodes = row.querySelectorAll ? row.querySelectorAll('input, option, select, textarea') : [];
  for (var i = 0; i < nodes.length && i < 64; i++) {
    var v = nodes[i].getAttribute('value');
    if (v) { texts.push(v); }
  }
  return texts;
}
function __awAttributeTokens(row) {
  var texts = [];
  var nodes = [row];
  var descendants = row.querySelectorAll ? row.querySelectorAll('*') : [];
  for (var d = 0; d < descendants.length && d < 512; d++) { nodes.push(descendants[d]); }
  for (var n = 0; n < nodes.length; n++) {
    var attrs = nodes[n].attributes;
    if (!attrs) { continue; }
    for (var a = 0; a < attrs.length; a++) {
      var name = attrs[a].name;
      if (name.indexOf('data-') !== 0 && name !== 'id' && name !== 'name') { continue; }
      if (name === '${ID_MATCH_MARKER_ATTRIBUTE}') { continue; }
      if (attrs[a].value) { texts.push(attrs[a].value); }
    }
  }
  return texts;
}
function __awPageStateText() {
  var chunks = [];
  var scripts = document.querySelectorAll('script[type="application/json"], script[type="application/ld+json"], script#__NEXT_DATA__');
  for (var i = 0; i < scripts.length && i < 16; i++) { chunks.push(scripts[i].textContent || ''); }
  var keys = ['__NEXT_DATA__', '__PRELOADED_STATE__', '__INITIAL_STATE__', '__NUXT__', '__APOLLO_STATE__'];
  for (var k = 0; k < keys.length; k++) {
    try {
      var v = window[keys[k]];
      if (v) { chunks.push(typeof v === 'string' ? v : JSON.stringify(v)); }
    } catch (e) { /* inaccessible page globals are simply absent evidence */ }
  }
  return chunks.join(' ').slice(0, 2000000);
}`;

/**
 * A standalone evaluate string running rungs 1–4 over every candidate row plus the rung-5 page-state sweep.
 *
 * Returns `{ rows, pageStateFingerprints, rowCount, rowsTruncated, tokensTruncated }` where each row is
 * `{ rowIndex, idFingerprints: [{source, fingerprint}], secondary: {rating, recencyBucket} }`. Every value is
 * either a digest, a coarse enum, a count, or a boolean — the raw sources stay in the page.
 *
 * The two truncation flags exist so a miss is never reported as a proven absence: if a cap dropped rows or
 * tokens, "this surface does not expose the id" is a claim the scan did not establish.
 *
 * `asOfDate` is the explicit KST as-of civil date the recency bucket is computed against (no clock is read).
 */
export function inPageReviewIdLadder(asOfDate: { year: number; month: number; day: number }): string {
  return `(async () => {
${IN_PAGE_ID_HELPERS}
var rows = __awIdRows();
var out = [];
var scopeExpandedRows = 0;
for (var i = 0; i < rows.length; i++) {
  var row = rows[i];
  // Scan the widest ancestor that contains THIS row and no other (see __awScopeFor).
  var scope = __awScopeFor(row, rows);
  if (scope !== row) { scopeExpandedRows++; }
  var fingerprints = [];
  var rungs = [
    ['visible-text', __awIdTokens(scope.innerText || scope.textContent || '')],
    ['anchor-href', __awIdTokens(__awHrefTokens(scope).join(' '))],
    ['input-value', __awIdTokens(__awValueTokens(scope).join(' '))],
    ['data-attribute', __awIdTokens(__awAttributeTokens(scope).join(' '))]
  ];
  for (var r = 0; r < rungs.length; r++) {
    var fps = await __awFingerprintAll(rungs[r][1]);
    for (var f = 0; f < fps.length; f++) { fingerprints.push({ source: rungs[r][0], fingerprint: fps[f] }); }
  }
  out.push({
    rowIndex: i,
    idFingerprints: fingerprints,
    secondary: {
      rating: __awUniqueRowRating(row),
      recencyBucket: __awParseBucket(row, ${asOfDate.year}, ${asOfDate.month}, ${asOfDate.day})
    }
  });
}
var pageState = await __awFingerprintAll(__awIdTokens(__awPageStateText()));
return {
  rows: out,
  pageStateFingerprints: pageState,
  rowCount: rows.length,
  rowsTruncated: __awIdRowsTruncated,
  tokensTruncated: __awIdTokensTruncated,
  scopeExpandedRows: scopeExpandedRows
};
})()`;
}

/** What the outline attempt found at the requested index. Anything but `outlined` must fail the run. */
export type OutlineOutcome =
  /** The row at that index still carries the target identity, and is now outlined. */
  | "outlined"
  /** No row at that index — the list shrank between the two evaluates. */
  | "absent"
  /** A row is there, but it is no longer the one that matched — the list re-rendered. Nothing was outlined. */
  | "row-changed";

/**
 * A standalone evaluate string that outlines the matched row, so the operator can visually confirm the runtime
 * resolved the row they expect.
 *
 * **It re-verifies the identity in the page before outlining anything.** The ladder and the outline are two
 * separate `page.evaluate` round-trips, and a live list can re-render between them (lazy load, virtualization,
 * a polling refresh) — in which case index *n* is a different row. Re-checking the (already one-way) target
 * fingerprint at that index is what makes the operator's visual confirmation evidence about the right review
 * rather than about whatever slid into that position.
 *
 * This is the only page mutation in the module: an outline, a scroll-into-view, and a marker attribute. It does
 * **not** click, focus, navigate, or change any NAVER value.
 */
export function inPageOutlineRowAt(rowIndex: number, targetFingerprint: string): string {
  const safeFingerprint = /^[0-9a-f]{64}$/.test(targetFingerprint) ? targetFingerprint : "";
  return `(async () => {
${IN_PAGE_ID_HELPERS}
var rows = __awIdRows();
var row = rows[${Math.trunc(rowIndex)}];
if (!row) { return 'absent'; }
var target = '${safeFingerprint}';
var still = false;
// Must widen EXACTLY as the ladder did, or a row matched via its exclusive wrapper would fail its own
// re-verification and be reported as 'row-changed' on a page that never changed.
var scope = __awScopeFor(row, rows);
var rungs = [
  __awIdTokens(scope.innerText || scope.textContent || ''),
  __awIdTokens(__awHrefTokens(scope).join(' ')),
  __awIdTokens(__awValueTokens(scope).join(' ')),
  __awIdTokens(__awAttributeTokens(scope).join(' '))
];
for (var r = 0; r < rungs.length && !still; r++) {
  var fps = await __awFingerprintAll(rungs[r]);
  if (fps.indexOf(target) >= 0) { still = true; }
}
if (!still) { return 'row-changed'; }
row.setAttribute('${ID_MATCH_MARKER_ATTRIBUTE}', '1');
row.style.outline = '3px solid #0b8f3a';
row.style.outlineOffset = '2px';
if (row.scrollIntoView) { row.scrollIntoView({ block: 'center' }); }
return 'outlined';
})()`;
}

/**
 * Removes the outline and marker set by {@link inPageOutlineRowAt}, leaving **no trace** of the probe: if
 * clearing the two style properties empties the `style` attribute entirely, the attribute itself is removed,
 * so the DOM is byte-identical to before the probe ran (proven in the browser rung). An element that already
 * carried inline styles keeps them — only a now-empty attribute is dropped.
 */
export const IN_PAGE_ID_OUTLINE_TEARDOWN = `(() => {
var marked = document.querySelectorAll('[${ID_MATCH_MARKER_ATTRIBUTE}]');
for (var i = 0; i < marked.length; i++) {
  marked[i].style.outline = '';
  marked[i].style.outlineOffset = '';
  if (!(marked[i].getAttribute('style') || '').trim()) { marked[i].removeAttribute('style'); }
  marked[i].removeAttribute('${ID_MATCH_MARKER_ATTRIBUTE}');
}
return marked.length;
})()`;
