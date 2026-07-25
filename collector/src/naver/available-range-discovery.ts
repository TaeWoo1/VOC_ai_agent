/**
 * **Pure: what historical review range does the marketplace currently let this seller reach?**
 *
 * An onboarding import should not begin by asking the seller to guess a period. It should find what is
 * actually available and plan from that. This module is the decision half of that discovery: a live probe
 * hands it what it read off the export surface's range controls, and it returns either a range or an honest
 * admission that it could not tell.
 *
 * **Two facts that look alike and are not.** A date input's `min`/`max` bounds say how far back the seller
 * may reach — the depth. A notice like `조회 기간은 최대 3개월` says how wide ONE query may be — a span cap.
 * Deriving a start date from a span cap would silently claim "3 months of history exists" about a store
 * with three years of it, so the two are returned in separate fields and only the bounds ever produce a
 * range.
 *
 * **Unreadable is a first-class answer.** Failing to read the bounds yields `UNREADABLE`, and the caller's
 * job is then to guide the seller to select the earliest allowed date and confirm it — recorded as an
 * operator confirmation, never as something SellerOps verified. Guessing a plausible depth here would be
 * indistinguishable, downstream, from having measured it.
 *
 * Pure and clock-free: dates stay `YYYY-MM-DD` strings, which sort chronologically on their own. Its one
 * import is the scope matcher's date normalization — shared deliberately, so the two modules can never
 * disagree about what counts as a date.
 */
import { extractDates } from "./export-scope-match";

/** How the available range was established. Mirrors the backend's `RangeDiscoveryEvidence`. */
export type RangeEvidence = "MACHINE_DISCOVERED" | "UNREADABLE";

/** Which structure produced the answer — for diagnosis, and to keep the derivation auditable. */
export type RangeSource = "MIN_MAX_ATTR" | "NONE";

/**
 * What a live probe read off the range controls. Raw strings, because this module runs in-process and
 * reduces them; nothing here is transported as-is.
 */
export interface RangeControlProbe {
  /** `min` attributes of date controls, if any expose one. */
  minAttrs: readonly string[];
  /** `max` attributes of date controls, if any expose one. */
  maxAttrs: readonly string[];
  /**
   * Text of notices found near the range controls. Read for a span cap ONLY — never to derive a start
   * date, and never surfaced verbatim.
   */
  noticeTexts: readonly string[];
}

/** Sanitized discovery outcome: dates the backend will store, plus enums. No page text. */
export interface AvailableRangeVerdict {
  evidence: RangeEvidence;
  /** Earliest reachable date (`YYYY-MM-DD`), or null when unreadable. */
  availableStart: string | null;
  /** Latest reachable date (`YYYY-MM-DD`), or null when unreadable. */
  availableEnd: string | null;
  /**
   * A per-query span cap in months, when a notice states one. Independent of the range above — it bounds
   * how wide each export may be, which is a segmentation concern, NOT how far back history goes.
   */
  maxSpanMonths: number | null;
  source: RangeSource;
}

/**
 * `조회 기간은 최대 3개월`, `최대 6개월까지 조회`, `1년 이내` … — a cap on ONE query's width.
 *
 * Requires an explicit 최대/이내/까지 qualifier: a bare `3개월` appears in ordinary page copy (and in
 * product names), and treating that as a limit would invent a constraint the marketplace never stated.
 */
const SPAN_CAP_PATTERNS: readonly RegExp[] = [
  /최대\s*(\d{1,2})\s*개월/,
  /(\d{1,2})\s*개월\s*(?:이내|까지)/,
  /최대\s*(\d{1,2})\s*년/,
  /(\d{1,2})\s*년\s*(?:이내|까지)/,
];

/** Whether a pattern counted years rather than months (both are expressed as months in the verdict). */
const isYearPattern = (re: RegExp): boolean => re.source.includes("년");

/**
 * Pure: read a per-query span cap in months from range-area notices, or null when none states one.
 *
 * The SMALLEST stated cap wins: when a surface states more than one, the tightest is the one that will
 * actually reject an export.
 */
export function readSpanCapMonths(noticeTexts: readonly string[]): number | null {
  let smallest: number | null = null;
  for (const text of noticeTexts) {
    for (const re of SPAN_CAP_PATTERNS) {
      const m = re.exec(text);
      if (!m) continue;
      const n = Number(m[1]);
      if (!Number.isInteger(n) || n < 1) continue;
      const months = isYearPattern(re) ? n * 12 : n;
      if (smallest === null || months < smallest) smallest = months;
    }
  }
  return smallest;
}

/**
 * Pure: decide the available historical range from what the probe read.
 *
 * Requires BOTH a readable earliest and a readable latest bound, and requires them to be ordered. A
 * half-known range is not a range: with only a `min` we would have to invent the end (almost certainly
 * "today"), and that invented value would then be indistinguishable from a measured one.
 */
export function discoverAvailableRange(probe: RangeControlProbe): AvailableRangeVerdict {
  const maxSpanMonths = readSpanCapMonths(probe.noticeTexts);
  // Reuse the same tolerant date normalization the scope matcher uses, so a bound written `2023.08.01`
  // is read identically to `2023-08-01` — the two modules must never disagree about what a date is.
  const mins = extractDates(probe.minAttrs);
  const maxs = extractDates(probe.maxAttrs);
  const availableStart = mins[0] ?? null; // earliest stated lower bound
  const availableEnd = maxs.length > 0 ? maxs[maxs.length - 1]! : null; // latest stated upper bound

  if (availableStart === null || availableEnd === null || availableStart > availableEnd) {
    return { evidence: "UNREADABLE", availableStart: null, availableEnd: null, maxSpanMonths, source: "NONE" };
  }
  return { evidence: "MACHINE_DISCOVERED", availableStart, availableEnd, maxSpanMonths, source: "MIN_MAX_ATTR" };
}
