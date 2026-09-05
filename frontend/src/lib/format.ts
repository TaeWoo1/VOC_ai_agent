import { elapsedSince } from "./elapsed";

export function won(amount: number): string {
  return `₩${amount.toLocaleString("ko-KR")}`;
}

export function wonShort(amount: number): string {
  if (amount >= 100_000_000) {
    return `${(amount / 100_000_000).toFixed(1)}억`;
  }
  if (amount >= 10_000) {
    return `${Math.round(amount / 10_000).toLocaleString("ko-KR")}만`;
  }
  return amount.toLocaleString("ko-KR");
}

export function count(n: number): string {
  return n.toLocaleString("ko-KR");
}

/**
 * When something happened, as a person would say it — 「17분 전」.
 *
 * The rung comes from {@link elapsedSince}, shared with `waitedLabel`, so a list row and the pane
 * beside it never disagree about the same timestamp. Only the wording is this function's own.
 */
export function relativeTime(iso: string | null): string {
  const elapsed = elapsedSince(iso);
  if (!elapsed) {
    return "-";
  }
  switch (elapsed.unit) {
    case "just":
      return "방금 전";
    case "minute":
      return `${elapsed.value}분 전`;
    case "hour":
      return `${elapsed.value}시간 전`;
    case "day":
      return `${elapsed.value}일 전`;
    case "week":
      return `${elapsed.value}주 전`;
    case "month":
      return `${elapsed.value}개월 전`;
    default:
      return "1년 넘음";
  }
}

export function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * A history row's date, with the year.
 *
 * `shortDate`'s `M/D` is right for something recent, and wrong for a list that can reach back past a
 * year: a row from last May would read exactly like one from this May. History says the year.
 */
export function importDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

/** Future counterpart of relativeTime — "다음 수집 5분 후" style. */
export function untilTime(iso: string | null): string {
  if (!iso) {
    return "-";
  }
  const diffMin = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  if (diffMin < 1) {
    return "곧";
  }
  if (diffMin < 60) {
    return `${diffMin}분 후`;
  }
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) {
    return `${diffHr}시간 후`;
  }
  return `${Math.round(diffHr / 24)}일 후`;
}

/**
 * A calendar date the seller would write, from an instant — in the seller's own day, not UTC's.
 *
 * `iso.slice(0, 10)` on a stored instant is the UTC date, which is yesterday for anything that happened
 * before 09:00 in Seoul. Measured on the product knowledge library, 2026-09-05 01:xx KST: a note the
 * seller had just saved was dated 2026-09-04 (Full Pilot Walkthrough v1). Same day rule as the review
 * import calendar on the backend (Asia/Seoul, one zone, no setting).
 */
export function kstDate(iso: string | null | undefined): string {
  if (!iso) {
    return "-";
  }
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    return iso.slice(0, 10);
  }
  return new Date(ms).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}
