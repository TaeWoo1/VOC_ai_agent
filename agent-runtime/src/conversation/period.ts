/**
 * A closed period token → the calendar window it names, on a given reference day.
 *
 * <b>Dates only, no clock, no zone.</b> The backend's windows are KST calendar days and this runtime
 * never reads a wall clock for a window: the run's `referenceDate` (or the observation date) is the
 * anchor, and every bound is derived from it by whole-day arithmetic. A token the planner did not name
 * produces no window — the caller decides what "no period" means for its read (a default the capability
 * declares, never one this file invents).
 */
import type { DateWindow, PeriodToken } from "./contract";

const DAY_MS = 86_400_000;

function toIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function dayMs(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

/** ISO weekday of a date-only string: 1 = Monday … 7 = Sunday. */
function isoWeekday(iso: string): number {
  const d = new Date(dayMs(iso)).getUTCDay();
  return d === 0 ? 7 : d;
}

/** The window a token names, ending on (or before) `today`. */
export function windowOf(token: PeriodToken, today: string): DateWindow {
  const t = dayMs(today);
  switch (token) {
    case "TODAY":
      return { from: today, to: today, token };
    case "YESTERDAY": {
      const y = toIso(t - DAY_MS);
      return { from: y, to: y, token };
    }
    case "LAST_7_DAYS":
      return { from: toIso(t - 6 * DAY_MS), to: today, token };
    case "LAST_14_DAYS":
      return { from: toIso(t - 13 * DAY_MS), to: today, token };
    case "LAST_30_DAYS":
      return { from: toIso(t - 29 * DAY_MS), to: today, token };
    case "THIS_WEEK": {
      const monday = t - (isoWeekday(today) - 1) * DAY_MS;
      return { from: toIso(monday), to: today, token };
    }
    case "LAST_WEEK": {
      const thisMonday = t - (isoWeekday(today) - 1) * DAY_MS;
      return { from: toIso(thisMonday - 7 * DAY_MS), to: toIso(thisMonday - DAY_MS), token };
    }
  }
}

/** The trailing-day count a token maps onto for the overview read (7 | 14 | 30). */
export function overviewDaysOf(token: PeriodToken | null): 7 | 14 | 30 {
  switch (token) {
    case "LAST_14_DAYS":
    case "THIS_WEEK":
    case "LAST_WEEK":
      return 14;
    case "LAST_30_DAYS":
      return 30;
    default:
      return 7;
  }
}

/** Whole days between two date-only strings, `to - from`. */
export function daysBetween(from: string, to: string): number {
  const ms = dayMs(to) - dayMs(from);
  return Number.isNaN(ms) ? 0 : Math.round(ms / DAY_MS);
}

/** The seller's word for a token. */
export function periodLabel(token: PeriodToken | null): string {
  switch (token) {
    case "TODAY": return "오늘";
    case "YESTERDAY": return "어제";
    case "LAST_7_DAYS": return "최근 7일";
    case "LAST_14_DAYS": return "최근 14일";
    case "LAST_30_DAYS": return "최근 30일";
    case "THIS_WEEK": return "이번 주";
    case "LAST_WEEK": return "지난주";
    default: return "최근";
  }
}

/** The date part of an ISO instant, or null. */
export function dateOf(instant: string | null | undefined): string | null {
  return instant ? instant.slice(0, 10) : null;
}
