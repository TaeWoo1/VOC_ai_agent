// A channel's own word for a data type, where it differs from the generic one.
//
// One answer, because the alternative is what the screen already did: the record panel said 상품평,
// the capability badge said 리뷰, and they were the same 22 rows. A seller reading two names for one
// thing has to work out that it is one thing.
//
// Scoped by channel on purpose — 상품평 is Coupang's word (its WING screen, the /connect entry point,
// the record panel), not a rename of REVIEW everywhere. A channel with no entry keeps the generic
// label the backend sent.
const CHANNEL_DATA_TYPE_LABEL: Record<string, Record<string, string>> = {
  COUPANG: { REVIEW: "상품평" },
};

/**
 * What to call `dataType` on `channelCode`, falling back to the generic label.
 *
 * Deliberately does NOT cover the 제외 범위 notes: `리뷰 API 없음 (쿠팡 미제공)` names an **API** that
 * Coupang itself calls a review API, not the seller's record of 상품평, and it is the connector's own
 * sentence rather than a label this file may rewrite.
 */
export function channelDataTypeLabel(
  channelCode: string | null | undefined,
  dataType: string,
  genericLabel: string,
): string {
  if (!channelCode) {
    return genericLabel;
  }
  return CHANNEL_DATA_TYPE_LABEL[channelCode]?.[dataType] ?? genericLabel;
}

/**
 * What one review is called here.
 *
 * The product's word is 리뷰 (the nav item, the workflow); a channel with its own word for the same
 * thing (Coupang: 상품평) keeps it. Before a channel is known there is no channel yet, so the generic
 * word — which is also the honest answer while a read is in flight.
 *
 * It lived inside `ChannelReviews.tsx` while the record was the only screen that named a review. The
 * Decision Workspace names one in six places, and a second copy of this two-line function is how one
 * screen ends up calling a Coupang row 상품평 while the screen it links to calls it 리뷰.
 */
export function reviewWord(channelCode: string | null | undefined): string {
  return channelDataTypeLabel(channelCode, "REVIEW", "리뷰");
}
