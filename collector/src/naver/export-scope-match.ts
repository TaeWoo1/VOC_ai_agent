/**
 * **Pure: does the range the seller actually selected match the segment we asked them to export?**
 *
 * The live driver can already read the export surface's date controls (`readExportScope`), but those raw
 * values are OPERATOR-LOCAL by contract — they may never be logged, persisted, or transported. This module
 * is what makes them usable anyway: it consumes them in-process and reduces them to a three-value verdict,
 * which is the only thing that leaves. So a guided import run can genuinely check the scope without the
 * seller's selected values crossing the sanitization boundary.
 *
 * **Fail closed on both kinds of doubt.** A range that cannot be read yields `UNREADABLE` (the caller falls
 * back to asking the seller to confirm — honestly labelled as their confirmation, never as a machine
 * check), and anything that reads but does not match yields `MISMATCH`, which must pause the run rather
 * than accept a file covering the wrong window. Notably, extra date controls elsewhere on the page widen
 * the observed span and therefore read as `MISMATCH` — the safe direction, since the alternative is
 * ingesting an export whose scope we only *assumed*.
 *
 * Zero imports, no `Date`: dates are normalized to `YYYY-MM-DD`, which sorts chronologically as a plain
 * string, so ordering needs no calendar arithmetic and no wall clock.
 */

/** What we concluded about the selected scope. Only this (never a raw value) may be transported. */
export type ScopeMatch = "MATCH" | "MISMATCH" | "UNREADABLE";

/** A required segment window, as ISO `YYYY-MM-DD` dates (inclusive). */
export interface RequiredRange {
  start: string;
  end: string;
}

/** Sanitized verdict: an enum plus structural counts. Carries no date and no page content. */
export interface ScopeMatchVerdict {
  match: ScopeMatch;
  /** How many distinct dates were parseable out of the controls (structural; 0 ⇒ nothing readable). */
  datesParsed: number;
  /** True when the observed span extends outside the required window (the usual MISMATCH cause). */
  spanDiffers: boolean;
}

/**
 * Every date shape a NAVER date control has been seen to hold, plus the ordinary ISO one. Deliberately
 * anchored on a 4-digit year first: a 2-digit year would make `06-16-26` ambiguous, and guessing an
 * ordering there is exactly the kind of silent wrong answer this module exists to avoid.
 *
 * Matched globally because ONE control may hold a whole range (`2026-06-16 ~ 2026-06-30`).
 */
const DATE_TOKEN_RE = /(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*일?/g;
/** Compact `YYYYMMDD`, which some pickers emit. Kept separate so it cannot swallow a delimited date. */
const COMPACT_DATE_RE = /\b(\d{4})(\d{2})(\d{2})\b/g;

const pad = (n: string): string => (n.length === 1 ? `0${n}` : n);

/**
 * Pure: normalize one date-ish string to `YYYY-MM-DD`, or null when it is not a plausible calendar date.
 *
 * Range-checks month and day rather than trusting the shape: a picker holding `2026-13-45` is corrupt
 * input, and treating it as a date would let a nonsense scope read as a confident MISMATCH/MATCH.
 */
export function normalizeDateToken(year: string, month: string, day: string): string | null {
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(m) || !Number.isInteger(d) || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * Pure: every distinct `YYYY-MM-DD` date found across the given control values, sorted ascending.
 *
 * Values are concatenated before scanning so a single control holding both ends of a range is read the
 * same as two controls holding one end each — the surface's choice of one input or two must not change
 * the verdict.
 */
export function extractDates(values: readonly string[]): string[] {
  const joined = values.join(" ");
  const found = new Set<string>();

  for (const m of joined.matchAll(DATE_TOKEN_RE)) {
    const iso = normalizeDateToken(m[1]!, m[2]!, m[3]!);
    if (iso) found.add(iso);
  }
  // Only consider compact dates in text with the delimited dates removed, so `2026-06-16` cannot also
  // yield a bogus compact reading from its own digits.
  const withoutDelimited = joined.replace(DATE_TOKEN_RE, " ");
  for (const m of withoutDelimited.matchAll(COMPACT_DATE_RE)) {
    const iso = normalizeDateToken(m[1]!, m[2]!, m[3]!);
    if (iso) found.add(iso);
  }
  return [...found].sort(); // ISO strings sort chronologically
}

/**
 * Pure: compare the seller's selected scope against the segment we asked them to export.
 *
 * Fewer than two readable dates is `UNREADABLE`, not `MISMATCH`: a surface whose picker keeps its value
 * somewhere we cannot see is a limit of our reading, not evidence the seller chose the wrong window, and
 * calling it a mismatch would strand a correct export.
 */
export function matchExportScope(values: readonly string[], required: RequiredRange): ScopeMatchVerdict {
  const dates = extractDates(values);
  if (dates.length < 2) {
    return { match: "UNREADABLE", datesParsed: dates.length, spanDiffers: false };
  }
  const observedStart = dates[0]!;
  const observedEnd = dates[dates.length - 1]!;
  const spanDiffers = observedStart !== required.start || observedEnd !== required.end;
  return {
    match: spanDiffers ? "MISMATCH" : "MATCH",
    datesParsed: dates.length,
    spanDiffers,
  };
}
