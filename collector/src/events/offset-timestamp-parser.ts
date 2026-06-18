/**
 * Phase 2b of the recency plan: a strict offset-bearing timestamp parser (offline,
 * deterministic, pure). Parses ONLY explicit-offset ISO-like strings to epoch
 * milliseconds; everything else → `null`.
 *
 * Per the timezone policy (recency-timezone-policy.md), timezone-LESS strings are not
 * parse-safe and are rejected. There is **no KST assumption**. The conversion uses
 * strict regex + manual calendar/offset arithmetic — it deliberately uses **no
 * `Date.*` API** (no `Date.parse`, `new Date`, `Date.now`, or `Date.UTC`) and never
 * reads the wall clock, so it stays deterministic and the codebase-wide no-wall-clock
 * rule holds.
 *
 * This slice is the parser ONLY. It is not wired into normalizers, no `eventTimeMs`
 * field is added, and no `recencyBucket` is wired into summaries (Phases 2c/2d/3/4,
 * deferred). No imports, no I/O.
 */

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// Strict: YYYY-MM-DDTHH:mm:ss(.SSS)?(Z | ±HH:MM). Uppercase T and Z only; offset needs a colon.
const ISO_OFFSET_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?(Z|[+-]\d{2}:\d{2})$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  const lengths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  // month is 1-based and already range-checked by the caller.
  return lengths[month - 1] ?? 0;
}

/** Days from 1970-01-01 (UTC, day 0) to the given civil date. Manual — no Date API. */
function daysSinceUnixEpoch(year: number, month: number, day: number): number {
  let days = 0;
  if (year >= 1970) {
    for (let y = 1970; y < year; y += 1) days += isLeapYear(y) ? 366 : 365;
  } else {
    for (let y = year; y < 1970; y += 1) days -= isLeapYear(y) ? 366 : 365;
  }
  for (let m = 1; m < month; m += 1) days += daysInMonth(year, m);
  days += day - 1;
  return days;
}

/**
 * Parse a strict explicit-offset ISO-like timestamp to epoch milliseconds, or `null`
 * for any timezone-less / invalid / ambiguous / non-string input.
 */
export function parseOffsetTimestampToEpochMs(raw: string | null | undefined): number | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (s.length === 0) return null;

  const m = ISO_OFFSET_RE.exec(s);
  if (m === null) return null;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  const ms = m[7] === undefined ? 0 : Number(m[7]);
  const offset = m[8] as string;

  // Calendar range validation (regex guarantees digit counts, not ranges).
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  if (hour > 23) return null;
  if (minute > 59) return null;
  if (second > 59) return null;

  // Offset → signed milliseconds. `Z` is 0.
  let offsetMs = 0;
  if (offset !== "Z") {
    const sign = offset[0] === "-" ? -1 : 1;
    const offHour = Number(offset.slice(1, 3));
    const offMinute = Number(offset.slice(4, 6));
    if (offHour > 23) return null;
    if (offMinute > 59) return null;
    offsetMs = sign * (offHour * HOUR_MS + offMinute * MINUTE_MS);
  }

  const localMs =
    daysSinceUnixEpoch(year, month, day) * DAY_MS +
    hour * HOUR_MS +
    minute * MINUTE_MS +
    second * SECOND_MS +
    ms;

  // The wall-clock components are at the given offset; UTC epoch = local − offset.
  return localMs - offsetMs;
}
