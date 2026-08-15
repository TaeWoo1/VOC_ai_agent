/**
 * Where a channel's 상품평 record lives, and which channels have one.
 *
 * **Why this is one module and not two inline checks.** The record was reachable only from a header
 * button inside the channel workspace, and twice in a row a seller sitting in front of the product
 * could not find it — the page had to be reached by typing its URL. The fix is an entry on the
 * channel list as well, which means two surfaces now decide the same question. Answered separately
 * they would drift: a channel would offer the entry in one place and not the other, and the seller
 * would learn that the button's absence means nothing.
 *
 * The predicate is deliberately a channel-code allowlist rather than "does this account have
 * reviews". A channel that collects reviews but happens to have none yet must still show the entry —
 * an empty record is a state the page explains, while a missing button is a feature the seller
 * concludes does not exist.
 */

/** Channels whose acquisition writes a 상품평 record this product can show. */
const REVIEW_RECORD_CHANNELS: readonly string[] = ["COUPANG"];

/**
 * Does this channel keep a 상품평 record?
 *
 * Only where the channel actually collects reviews this way. Offered on a channel with no record it
 * would open a page that can only say "아직 없습니다", which reads as a failure rather than as a
 * capability the channel does not have.
 */
export function hasReviewRecord(channelCode: string | null | undefined): boolean {
  return !!channelCode && REVIEW_RECORD_CHANNELS.includes(channelCode);
}

/** The record's route. One definition, so a link and a redirect cannot disagree about the path. */
export function reviewRecordPath(accountId: string): string {
  return `/connect/channels/${accountId}/reviews`;
}

/**
 * The entry's label, carrying the count when it is known.
 *
 * A count that failed to load, or has not arrived yet, drops out of the label — it never becomes a
 * `0`, and it never disables the entry. The seller can always open the record; the number is the
 * part that is allowed to be missing.
 */
export function reviewEntryLabel(count: number | null | undefined): string {
  return isCountable(count) ? `상품평 ${count}개 보기` : "상품평 보기";
}

/**
 * What the workspace panel says above the entry. Three honest states, and none of them removes the
 * way in: a real count, an empty record with the reason it is empty, and a count we could not read.
 */
export function reviewRecordSummary(count: number | null | undefined): string {
  if (!isCountable(count)) {
    return "수집한 상품평 수를 지금 확인하지 못했습니다. 목록은 그대로 열 수 있습니다.";
  }
  if (count === 0) {
    return "아직 수집된 상품평이 없습니다. 상품평 수집을 한 번 실행하면 이 목록에 쌓입니다.";
  }
  return `지금까지 수집한 상품평 ${count}개를 모아 두었습니다.`;
}

/** A count is usable only if the server actually sent a whole, non-negative number. */
function isCountable(count: number | null | undefined): count is number {
  return typeof count === "number" && Number.isInteger(count) && count >= 0;
}
