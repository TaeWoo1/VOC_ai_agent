/**
 * **Safe-allowlist WING `유효기간` (validity-period) reader — the PURE half + the ONE allowlisted in-page read.**
 *
 * Coupang WING's open-API page shows, next to a fixed `유효기간` (validity period) label, the DATE the issued key
 * expires. That date is a NON-secret operational fact SellerOps legitimately needs (to warn a seller before their
 * credential lapses and to offer guided renewal). This module reads THAT DATE and nothing else.
 *
 * **The hard allowlist ({@link WING_SAFE_READ_ALLOWLIST}).** The ONLY value this reader ever extracts is the date
 * adjacent to the fixed `유효기간` anchor, and the ONLY thing that ever leaves the page is a sanitized ISO date
 * (`YYYY-MM-DD`) or `null`. It NEVER reads — by label or by value — the Access Key, the Secret Key, or the 업체코드
 * (vendor id): those labels do not appear in this module's code, the in-page extract queries ONLY the `유효기간`
 * anchor's own row, and a STRICT date regex means a secret token (base64 / hex) can never leave the page even if a
 * mis-scoped read reached one — it simply is not date-shaped, so it sanitizes to `null`. No `.value` /
 * `.inputValue`, no clipboard, no screenshot, no `innerHTML` / `outerHTML` / `page.content`. A source guard
 * (`wing-validity-reader.test.ts`) proves all of this structurally.
 *
 * **Two gates, one truth.** The in-page {@link buildValidityDateExtractScript} applies {@link VALIDITY_DATE_RE}
 * so only a date-SHAPED substring can leave the browser; the Node-side {@link sanitizeValidityDate} re-parses the
 * SAME regex and does the authoritative calendar validation (manual, no `Date`), so a garbled or out-of-range
 * value becomes `null` rather than a guess. Both share {@link VALIDITY_DATE_RE_SOURCE}, so they can never disagree.
 *
 * ⚠ **CALIBRATION PENDING (`LIVE_DOM_CALIBRATION_PENDING`).** {@link WING_VALIDITY_LABELS} is a CANDIDATE fixed
 * label proposed from WING's Korean UI — NOT proven against the real WING DOM. Pure: no I/O, no browser, no clock.
 */
import { LIVE_DOM_CALIBRATION_PENDING } from "../../cli/coupang-wing-classifier";

export { LIVE_DOM_CALIBRATION_PENDING };

/**
 * The single-source ALLOWLIST record: the fixed label whose adjacent value may be read, WHAT is read (a date),
 * and the exact output shape. Deliberately carries ONLY the positive allowlist — the forbidden key labels are
 * named in prose above and enforced by the source guard, never embedded here as query strings.
 */
export const WING_SAFE_READ_ALLOWLIST = Object.freeze({
  /** The ONLY label whose adjacent value is ever read. */
  label: "유효기간",
  /** WHAT is read next to it — a date, nothing else. */
  reads: "date",
  /** The ONLY thing that ever leaves the page. */
  outputShape: "YYYY-MM-DD|null",
  /** Unvalidated until a live WING walk proves the anchor resolves. */
  calibration: LIVE_DOM_CALIBRATION_PENDING,
} as const);

/**
 * CANDIDATE / `LIVE_DOM_CALIBRATION_PENDING`. The fixed `유효기간` anchor label(s). Value-free: the in-page read
 * compares an element's normalized text against these KNOWN labels and returns only the adjacent DATE — never the
 * label text, never any other cell.
 */
export const WING_VALIDITY_LABELS = ["유효기간"] as const;

/** The structural candidate query for the `유효기간` label element (generic HTML only — no WING selectors). */
export const VALIDITY_ANCHOR_CANDIDATE_QUERY = "th,dt,label,span,div,strong,b,td,p,legend";

/**
 * The date grammar, shared by the in-page extract and the Node sanitizer so they can never diverge. Matches a
 * `YYYY <sep> M <sep> D` date with `.`/`-`/`/`/`년`/`월` separators (WING renders e.g. `2027. 03. 15` or
 * `2027년 3월 15일`). `년`=`년`, `월`=`월` as escapes so the source stays ASCII-safe across page runtimes.
 */
export const VALIDITY_DATE_RE_SOURCE = "(\\d{4})\\s*[.\\-/\\uB144]\\s*(\\d{1,2})\\s*[.\\-/\\uC6D4]\\s*(\\d{1,2})";

/** A fresh compiled matcher (never a shared stateful `/g` instance). */
export function validityDateRe(): RegExp {
  return new RegExp(VALIDITY_DATE_RE_SOURCE);
}

function daysInMonth(year: number, month: number): number {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const table = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return table[month - 1] ?? 0;
}

function isValidYmd(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1000 || year > 9999) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  return true;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Parse a candidate token to a sanitized ISO date (`YYYY-MM-DD`) or `null`. This is the authoritative gate: it
 * re-applies {@link VALIDITY_DATE_RE_SOURCE} and validates the calendar with manual month/leap arithmetic (no
 * `Date`, so it is deterministic and clock-free). Anything that is not a clean, in-range date — a missing value, a
 * garbled string, an out-of-range day, or a secret-shaped token — returns `null`, NEVER a guess. Idempotent on an
 * already-ISO input.
 */
export function sanitizeValidityDate(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 200) return null;
  const m = validityDateRe().exec(raw);
  if (!m || m[1] === undefined || m[2] === undefined || m[3] === undefined) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!isValidYmd(year, month, day)) return null;
  return `${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(day)}`;
}

/**
 * Build the ALLOWLISTED in-page read as a **string** IIFE (never a passed function: tsx/esbuild's `__name` shim
 * is absent in the page and a serialized function throws). Kept ES5-plain.
 *
 * It finds the element whose normalized text EXACTLY equals a fixed {@link WING_VALIDITY_LABELS} label, then reads
 * ONLY that anchor's adjacent value — its next sibling cell, else its own row — applies {@link VALIDITY_DATE_RE}
 * IN-PAGE, and returns `{ raw: <the date-shaped match> }` or `{ raw: null }`. It NEVER inspects any other row, so
 * an Access Key / Secret Key / 업체코드 row is never reached; and because ONLY a date-shaped substring is returned,
 * no secret can ever leave the page. It reads `.textContent` SOLELY to (a) match the fixed label and (b) extract
 * the date — the single, documented, allowlisted read. No `.value`, no attribute read, no clipboard/screenshot.
 */
export function buildValidityDateExtractScript(): string {
  return `(function () {
  /* coupang-renewal-validity-date (ALLOWLISTED read: ONLY the 유효기간 date leaves the page) */
  var slice = Function.prototype.call.bind(Array.prototype.slice);
  function nrm(s) { return String(s == null ? '' : s).replace(/\\s+/g, ' ').trim(); }
  var LABELS = ${JSON.stringify([...WING_VALIDITY_LABELS])};
  var DATE_RE = new RegExp(${JSON.stringify(VALIDITY_DATE_RE_SOURCE)});
  function isLabel(t) { for (var i = 0; i < LABELS.length; i++) { if (t === LABELS[i]) { return true; } } return false; }
  var cands = slice(document.querySelectorAll(${JSON.stringify(VALIDITY_ANCHOR_CANDIDATE_QUERY)}));
  var anchor = null;
  for (var i = 0; i < cands.length && i < 6000; i++) { if (isLabel(nrm(cands[i].textContent))) { anchor = cands[i]; break; } }
  if (!anchor) { return { raw: null }; }
  /* Read ONLY the value adjacent to THIS 유효기간 anchor — its sibling cell first, then its own row. Never any
     other row, so a key/vendor-code row is never inspected. A strict date regex means ONLY a date-shaped token
     can leave the page; a secret never matches. */
  var sources = [];
  if (anchor.nextElementSibling) { sources.push(anchor.nextElementSibling); }
  if (anchor.parentElement) { sources.push(anchor.parentElement); }
  for (var s = 0; s < sources.length; s++) {
    var txt = nrm(sources[s].textContent);
    if (txt.length === 0 || txt.length > 200) { continue; }
    var m = DATE_RE.exec(txt);
    if (m) { return { raw: m[0] }; }
  }
  return { raw: null };
})()`;
}

/** The value-free shape the in-page extract returns: a date-shaped token, or null. */
export interface ValidityDateExtractResult {
  raw: string | null;
}
