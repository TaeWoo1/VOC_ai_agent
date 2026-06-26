// Pure date-range + selection logic for the operator backfill panel. Kept out of
// the component so it can be unit-tested without a DOM. Dates are local calendar
// dates (yyyy-MM-dd); the channel policy zone (KST for Cafe24) is the server's
// concern — the operator picks calendar days.

export type PresetKey = "today" | "recent3" | "recent7" | "custom";

export interface DateRange {
  from: string; // ISO yyyy-MM-dd
  to: string;
}

/** The collectable data types the backfill panel offers, in display order. */
export const BACKFILL_DATA_TYPES: Array<{ value: string; label: string }> = [
  { value: "ORDER_SUMMARY", label: "주문·매출" },
  { value: "REVIEW", label: "리뷰" },
  { value: "INQUIRY", label: "문의" },
];

export const PRESETS: Array<{ key: PresetKey; label: string }> = [
  { key: "today", label: "오늘" },
  { key: "recent3", label: "최근 3일" },
  { key: "recent7", label: "최근 7일" },
  { key: "custom", label: "직접 선택" },
];

/** Format a Date as a local ISO calendar date (no UTC shift). */
export function toIsoDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** N calendar days before `today` (inclusive count): recent3 = today + 2 prior. */
function daysBefore(today: Date, days: number): string {
  const d = new Date(today);
  d.setDate(d.getDate() - days);
  return toIsoDate(d);
}

/**
 * Resolve a preset to a concrete [from, to] range given "today". For `custom`,
 * the caller's typed range is returned as-is (validated separately).
 */
export function resolvePresetRange(preset: PresetKey, today: Date, custom?: DateRange): DateRange {
  const to = toIsoDate(today);
  switch (preset) {
    case "today":
      return { from: to, to };
    case "recent3":
      return { from: daysBefore(today, 2), to };
    case "recent7":
      return { from: daysBefore(today, 6), to };
    case "custom":
      return { from: custom?.from ?? "", to: custom?.to ?? "" };
  }
}

export interface BackfillValidation {
  ok: boolean;
  error?: string;
}

/**
 * Validate an operator backfill selection: at least one data type, both dates
 * present, and a non-inverted range. Mirrors the backend's fail-closed window rule
 * so the UI rejects bad input before any request.
 */
export function validateBackfill(range: DateRange, types: string[]): BackfillValidation {
  if (types.length === 0) {
    return { ok: false, error: "수집할 데이터 유형을 한 개 이상 선택해 주세요." };
  }
  if (!range.from || !range.to) {
    return { ok: false, error: "수집 기간을 선택해 주세요." };
  }
  if (range.from > range.to) {
    return { ok: false, error: "시작일은 종료일보다 늦을 수 없습니다." };
  }
  return { ok: true };
}
