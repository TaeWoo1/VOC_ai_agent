/**
 * ONE ladder of elapsed-time buckets, for every screen that says how long ago something happened.
 *
 * <b>Why it exists.</b> Two formatters used to compute this independently — `relativeTime` on a list
 * row and `waitedLabel` in the pane beside it — and they disagreed twice over. First on rounding
 * (fixed in Executive Readiness Fix v1: a 13h40m inquiry read 「14시간 전」 and 「13시간째」 at once).
 * Then on the buckets themselves, which is how one inquiry showed 「17분 전」 in the list and 「방금」 in
 * its own detail: `waitedLabel` had no minute bucket, and `relativeTime` had no week bucket, so the
 * same instant landed in different rungs depending on which component asked.
 *
 * <b>The number and the unit are decided here; only the wording is not.</b> A list row says WHEN
 * something arrived (「17분 전」) and a work pane says HOW LONG it has waited (「17분째」) — different
 * sentences about the same fact, which is fine. Two different NUMBERS about the same fact is not, so
 * the rung is computed once and each caller renders it.
 *
 * FLOOR at every rung: elapsed time is never over-stated.
 */
export type ElapsedUnit = "just" | "minute" | "hour" | "day" | "week" | "month" | "overYear";

export interface Elapsed {
  unit: ElapsedUnit;
  /** How many of `unit`. Always 0 for `just` and `overYear`, which carry no count. */
  value: number;
}

/** The rung one timestamp falls on, or null when it is unparseable or in the future. */
export function elapsedSince(iso: string | null | undefined, now: Date = new Date()): Elapsed | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  const minutes = Math.floor((now.getTime() - at) / 60_000);
  if (minutes < 0) return null;
  if (minutes < 1) return { unit: "just", value: 0 };
  if (minutes < 60) return { unit: "minute", value: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { unit: "hour", value: hours };
  const days = Math.floor(hours / 24);
  if (days < 7) return { unit: "day", value: days };
  if (days < 31) return { unit: "week", value: Math.floor(days / 7) };
  // Past a month the day count stops being information — the 문의 queue was rendering 「4150일 전」 on
  // a backlog reaching back to 2015, which is arithmetic nobody acts on differently from 4,000.
  if (days < 365) return { unit: "month", value: Math.floor(days / 30) };
  return { unit: "overYear", value: 0 };
}
