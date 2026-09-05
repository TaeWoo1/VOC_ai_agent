/**
 * **In-page (browser) census of the review list's own RANGE controls — read-only, numbers out.**
 *
 * Why this exists, stated as the observation that produced it (live, 2026-09-05): a guided reply run swept
 * fifteen screens of the seller center's review grid, reached the bottom of the scroll pane, and matched
 * nothing — while every row it saw was `TODAY` or `THIS_WEEK` and the review it was looking for was eight
 * days old. Two days earlier the SAME screen had found a review of the same date on the ninth screen. The
 * list had not changed shape; the review had aged out of the period the screen shows by default. A locate
 * that only scrolls can therefore only ever find reviews inside whatever window the screen happens to be
 * showing, and it reports that limit as `TARGET_NOT_FOUND` — "the review is not there", which is false.
 *
 * So the run has to be able to tell those two apart, and to do that it has to read the screen's own period
 * filter. That is all this does. It answers, in numbers only:
 *
 *  - how many date inputs the seller could act on (the grounded predicate `naver/import-locate` already
 *    uses live: `input[type=date]`, or a class naming date/calendar/picker),
 *  - how many of them currently hold a parseable date, and how many days before the run's as-of date each
 *    one is — **an offset, never a date string**,
 *  - whether the grid carries a numeric pager at all, and the highest page number it admits to.
 *
 * **Page text never leaves the page.** Values are parsed and reduced to integers inside the browser; no
 * date string, selector, class name, attribute value or review text is returned. Nothing is clicked,
 * focused, typed into, navigated or mutated — this is a read.
 */

/** Sanitized range facts. Every field is a count or a day offset; `-1` means "not established". */
export interface ReviewListRangeCensus {
  /** Actionable date inputs found by the grounded predicate. */
  dateInputCount: number;
  /** How many of those held a parseable date. */
  valuesParsed: number;
  /** Days between the earliest parsed date and the as-of date (`-1` when none parsed). */
  startDaysBefore: number;
  /** Days between the latest parsed date and the as-of date (`-1` when none parsed). */
  endDaysBefore: number;
  /** Repeated numeric page controls — 0 when the grid shows no pager. */
  pagerNumberCount: number;
  /** The highest page number the pager prints (0 when there is no pager). */
  highestPagerNumber: number;
}

/** `-1` in every field: what a census that could not run reports, so an unknown never reads as a fact. */
export const UNREAD_RANGE_CENSUS: ReviewListRangeCensus = {
  dateInputCount: -1,
  valuesParsed: -1,
  startDaysBefore: -1,
  endDaysBefore: -1,
  pagerNumberCount: -1,
  highestPagerNumber: -1,
};

/** Validates whatever the page returned into the census shape — the page is untrusted input. */
export function parseRangeCensus(raw: unknown): ReviewListRangeCensus {
  const r = (raw ?? {}) as Record<string, unknown>;
  const int = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : -1);
  return {
    dateInputCount: int(r.dateInputCount),
    valuesParsed: int(r.valuesParsed),
    startDaysBefore: int(r.startDaysBefore),
    endDaysBefore: int(r.endDaysBefore),
    pagerNumberCount: int(r.pagerNumberCount),
    highestPagerNumber: int(r.highestPagerNumber),
  };
}

/**
 * The in-page script. `asOf` is the run's KST civil date, passed in so the browser can reduce a date to an
 * offset and the offset — not the date — is what crosses back.
 */
export function inPageReviewListRange(asOf: { year: number; month: number; day: number }): string {
  return `(() => {
var ASOF = Date.UTC(${asOf.year}, ${asOf.month - 1}, ${asOf.day});
function visibleAndEnabled(el) {
  if (el.disabled) { return false; }
  var st = window.getComputedStyle(el);
  if (st.display === 'none' || st.visibility === 'hidden') { return false; }
  var r = el.getBoundingClientRect();
  return r.width > 0 || r.height > 0;
}
// The grounded date predicate: type=date, or a class naming a date/calendar/picker widget. Readonly is
// NOT an exclusion — a calendar-backed field is almost always readonly, and treating that as unusable is
// how an earlier probe reported zero date inputs on a surface that had two.
function isDateInput(el) {
  var type = String(el.getAttribute('type') || '').toLowerCase();
  if (type === 'date') { return true; }
  var cls = typeof el.className === 'string' ? el.className.toLowerCase() : '';
  return cls.indexOf('date') >= 0 || cls.indexOf('calendar') >= 0 || cls.indexOf('picker') >= 0;
}
// One date, reduced to whole days before the as-of date. Accepts the delimited and compact forms Korean
// pickers emit. Returns null for anything that is not a plausible calendar date.
function daysBefore(value) {
  var s = String(value || '').trim();
  var m = /^(\\d{4})[.\\-\\/]\\s?(\\d{1,2})[.\\-\\/]\\s?(\\d{1,2})\\.?$/.exec(s) || /^(\\d{4})(\\d{2})(\\d{2})$/.exec(s);
  if (!m) { return null; }
  var y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) { return null; }
  var t = Date.UTC(y, mo - 1, d);
  if (!isFinite(t)) { return null; }
  return Math.round((ASOF - t) / 86400000);
}
var inputs = document.querySelectorAll('input');
var count = 0, parsed = 0, offsets = [];
for (var i = 0; i < inputs.length; i++) {
  var el = inputs[i];
  if (!isDateInput(el) || !visibleAndEnabled(el)) { continue; }
  count++;
  var off = daysBefore(el.value);
  if (off !== null) { parsed++; offsets.push(off); }
}
var start = -1, end = -1;
for (var o = 0; o < offsets.length; o++) {
  if (start < 0 || offsets[o] > start) { start = offsets[o]; }   // earliest date = the largest offset
  if (end < 0 || offsets[o] < end) { end = offsets[o]; }         // latest date = the smallest offset
}
// A page number is only a pager when it repeats: a lone printed '3' is a quantity. Counted over controls
// only (anchor/button/li), and the digits are compared to a shape, never returned.
var pagerNodes = document.querySelectorAll('a, button, li');
var pageNumbers = [];
for (var p = 0; p < pagerNodes.length && p < 2000; p++) {
  var text = String(pagerNodes[p].textContent || '').trim();
  if (/^[0-9]{1,3}$/.test(text)) { pageNumbers.push(Number(text)); }
}
var highest = 0;
for (var h = 0; h < pageNumbers.length; h++) { if (pageNumbers[h] > highest) { highest = pageNumbers[h]; } }
var isPager = pageNumbers.length >= 2;
return {
  dateInputCount: count,
  valuesParsed: parsed,
  startDaysBefore: start,
  endDaysBefore: end,
  pagerNumberCount: isPager ? pageNumbers.length : 0,
  highestPagerNumber: isPager ? highest : 0
};
})()`;
}
