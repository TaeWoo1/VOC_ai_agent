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

export function relativeTime(iso: string | null): string {
  if (!iso) {
    return "-";
  }
  const then = new Date(iso).getTime();
  const diffMin = Math.round((Date.now() - then) / 60000);
  if (diffMin < 1) {
    return "방금 전";
  }
  if (diffMin < 60) {
    return `${diffMin}분 전`;
  }
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) {
    return `${diffHr}시간 전`;
  }
  return `${Math.round(diffHr / 24)}일 전`;
}

export function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
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
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) {
    return `${diffHr}시간 후`;
  }
  return `${Math.round(diffHr / 24)}일 후`;
}
