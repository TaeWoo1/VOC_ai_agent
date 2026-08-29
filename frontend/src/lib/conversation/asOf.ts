/**
 * 「언제 기준인가」 — a channel's last successful observation in the seller's words: 「오늘 09:12」 ·
 * 「어제 18:40」 · 「8월 20일」 · 「2025년 12월 31일」. Seller time (Asia/Seoul); relative only where it is
 * unambiguous. Mirrors `agent-runtime/src/conversation/asOf.ts` so a card and the sentence above it
 * name the same instant the same way.
 */
const SELLER_TIME_ZONE = "Asia/Seoul";

function seoulDate(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: SELLER_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export function asOfWord(iso: string | null | undefined, reference: Date = new Date()): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const date = seoulDate(at);
  const time = new Intl.DateTimeFormat("ko-KR", { timeZone: SELLER_TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false }).format(at);
  const today = seoulDate(reference);
  if (date === today) return `오늘 ${time}`;
  const y = new Date(reference.getTime() - 24 * 60 * 60 * 1000);
  if (date === seoulDate(y)) return `어제 ${time}`;
  const [year, month, day] = date.split("-").map((s) => Number(s));
  return `${year === Number(today.slice(0, 4)) ? "" : `${year}년 `}${month}월 ${day}일`;
}

/** 「네이버 · 오늘 09:12 기준」, or 「네이버 · 확인 기록 없음」 when the channel was never observed. */
export function asOfStatus(channelName: string, iso: string | null | undefined, reference: Date = new Date()): string {
  const word = asOfWord(iso, reference);
  return word ? `${channelName} · ${word} 기준` : `${channelName} · 확인 기록 없음`;
}
