/**
 * 「언제 기준인가」 — the last successful observation of a channel, in the seller's words.
 *
 * <b>One fact, one short phrase.</b> A coverage row's `lastSuccessfulSyncAt` is the newest SUCCESS/PARTIAL
 * collection for (channel, data type); the seller does not know or want the word "sync" — they want
 * to know whether the list in front of them is 「오늘 09:12 기준」 or 「8월 20일 기준」. Rendered in the
 * seller's own time zone (Asia/Seoul), relative only where it is unambiguous (today / yesterday), and
 * never as an elapsed-time guess.
 */
const SELLER_TIME_ZONE = "Asia/Seoul";

function partsOf(iso: string): { date: string; time: string } | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: SELLER_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  const time = new Intl.DateTimeFormat("ko-KR", { timeZone: SELLER_TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false }).format(at);
  return { date, time };
}

/** `2026-08-29` → `8월 29일`; a year is added only when it differs from the reference year. */
function monthDay(date: string, referenceDate: string): string {
  const [y, m, d] = date.split("-").map((s) => Number(s));
  const sameYear = referenceDate.slice(0, 4) === date.slice(0, 4);
  return `${sameYear ? "" : `${y}년 `}${m}월 ${d}일`;
}

/**
 * 「오늘 09:12」 / 「어제 18:40」 / 「8월 20일」 / 「2025년 8월 20일」 — null when there is no observation.
 * `referenceDate` is the seller's observation date (`YYYY-MM-DD`, Asia/Seoul).
 */
export function asOfWord(iso: string | null | undefined, referenceDate: string): string | null {
  if (!iso) return null;
  const p = partsOf(iso);
  if (!p) return null;
  if (p.date === referenceDate) return `오늘 ${p.time}`;
  const yesterday = new Date(`${referenceDate}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  if (p.date === yesterday.toISOString().slice(0, 10)) return `어제 ${p.time}`;
  return monthDay(p.date, referenceDate);
}

/** 「네이버 · 오늘 09:12 기준」 — the compact status the artifact footer shows. */
export function asOfStatus(channelName: string, iso: string | null | undefined, referenceDate: string): string {
  const word = asOfWord(iso, referenceDate);
  return word ? `${channelName} · ${word} 기준` : `${channelName} · 확인 기록 없음`;
}
