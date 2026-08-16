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
