/**
 * Where a channel's review record lives, and which channels have one.
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
import { channelDataTypeLabel } from "./channelVocabulary";

/**
 * Channels whose acquisition writes a review record this product can show, each with what the record
 * screen may honestly say about that channel.
 *
 * Product assembly (2026-08-17): the record is the 리뷰 workflow surface (`/reviews`,
 * `docs/product_assembly_ia_v1.md` §3), and every product channel keeps one — NAVER (review export
 * import), Coupang (Action Window acquisition), Cafe24 (board articles). What differs per channel is
 * capability, and the record page reads that from the server (`ReviewChannelCapabilityView`), not
 * from this list.
 *
 * **The note is stored beside the channel and not written into the panel** so that adding a channel
 * here cannot silently carry one channel's claim onto another. "쿠팡은 판매자 답글 기능이 없어" is true
 * of Coupang and false of NAVER; a hardcoded sentence under a growing allowlist becomes a support claim
 * about a channel nobody checked the moment the list grows by one.
 */
const REVIEW_RECORD_CHANNELS: Record<string, { note: string }> = {
  NAVER: {
    note:
      "수집한 리뷰를 읽고, 확인이 필요한 리뷰부터 볼 수 있습니다. " +
      "답글은 스마트스토어센터에서 직접 작성하며, SellerOps는 대신 작성하거나 등록하지 않습니다.",
  },
  COUPANG: {
    note:
      "상품평을 고르면 전체 내용을 읽고, 그 상품평이 쿠팡 화면 어디에 있는지 찾아 볼 수 있습니다. " +
      "쿠팡은 판매자 답글 기능이 없어 답변 작성 기능은 제공하지 않습니다.",
  },
  CAFE24: {
    note:
      "게시판에서 수집한 리뷰를 읽고, 확인이 필요한 리뷰부터 볼 수 있습니다. " +
      "이 화면에서는 답변을 작성하지 않습니다.",
  },
};

/**
 * Does this channel keep a review record?
 *
 * Only where the channel actually collects reviews this way. Offered on a channel with no record it
 * would open a page that can only say "아직 없습니다", which reads as a failure rather than as a
 * capability the channel does not have.
 */
export function hasReviewRecord(channelCode: string | null | undefined): boolean {
  return !!channelCode && Object.prototype.hasOwnProperty.call(REVIEW_RECORD_CHANNELS, channelCode);
}

/**
 * What this channel's record screen may say about itself, or null when the caller did not name a
 * channel. Never a default sentence: a claim we cannot attribute to a channel is not made at all.
 */
export function reviewRecordNote(channelCode: string | null | undefined): string | null {
  if (!channelCode) {
    return null;
  }
  return REVIEW_RECORD_CHANNELS[channelCode]?.note ?? null;
}

/**
 * The record's route — the 리뷰 workflow surface, keyed by account. One definition, so a link and a
 * redirect cannot disagree about the path. The pre-assembly path
 * `/connect/channels/:accountId/reviews` redirects here.
 */
export function reviewRecordPath(accountId: string): string {
  return `/reviews/${accountId}`;
}

/** The product's word for one review on `channelCode` — 리뷰, or the channel's own (Coupang: 상품평). */
export function reviewWord(channelCode?: string | null): string {
  return channelDataTypeLabel(channelCode, "REVIEW", "리뷰");
}

/**
 * The entry's label, carrying the count when it is known.
 *
 * A count that failed to load, or has not arrived yet, drops out of the label — it never becomes a
 * `0`, and it never disables the entry. The seller can always open the record; the number is the
 * part that is allowed to be missing.
 */
export function reviewEntryLabel(count: number | null | undefined, channelCode?: string | null): string {
  const word = reviewWord(channelCode);
  return isCountable(count) ? `${word} ${count}개 보기` : `${word} 보기`;
}

/**
 * What the workspace panel says above the entry. Three honest states, and none of them removes the
 * way in: a real count, an empty record with the reason it is empty, and a count we could not read.
 */
export function reviewRecordSummary(count: number | null | undefined, channelCode?: string | null): string {
  const word = reviewWord(channelCode);
  if (!isCountable(count)) {
    return `수집한 ${word} 수를 지금 확인하지 못했습니다. 목록은 그대로 열 수 있습니다.`;
  }
  if (count === 0) {
    return `아직 수집된 ${josa(word, "이", "가")} 없습니다. ${word} 수집을 한 번 실행하면 이 목록에 쌓입니다.`;
  }
  return `지금까지 수집한 ${word} ${count}개를 모아 두었습니다.`;
}

/** `word` + the particle that fits its last syllable — 리뷰가 / 상품평이. */
function josa(word: string, afterConsonant: string, afterVowel: string): string {
  const last = word.charCodeAt(word.length - 1);
  const hangul = last >= 0xac00 && last <= 0xd7a3;
  return `${word}${hangul && (last - 0xac00) % 28 !== 0 ? afterConsonant : afterVowel}`;
}

/** A count is usable only if the server actually sent a whole, non-negative number. */
function isCountable(count: number | null | undefined): count is number {
  return typeof count === "number" && Number.isInteger(count) && count >= 0;
}
