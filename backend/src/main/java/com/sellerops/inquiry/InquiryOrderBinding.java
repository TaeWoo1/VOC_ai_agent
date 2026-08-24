package com.sellerops.inquiry;

/**
 * How this inquiry's order was decided. <b>One value, and that is the design.</b>
 *
 * <p>{@link InquiryProductBinding} has two, because a person may legitimately look at a photo and say
 * which listing an inquiry is about. An order has no such lane. Nobody — not a person, not a model,
 * not a heuristic — can look at "3월에 주문했는데 아직 안 왔어요" and know WHICH order without the
 * channel saying so, and a wrong answer here is not a mislabelled queue row: it is a customer told
 * the state of a stranger's parcel.
 *
 * <p>So the vocabulary is closed at one, and the absence of a second value is the fence. There is no
 * {@code TEXT_EXTRACTED}, no {@code USER_CONFIRMED}, no {@code SINGLE_CANDIDATE}. A row either has
 * {@link #SOURCE_EXACT} or has nothing, and having nothing is the ordinary case on every Cafe24
 * board-6 article the Demo Org holds.
 */
public enum InquiryOrderBinding {

    /**
     * The channel itself named the order on this inquiry's own record.
     *
     * <p>Set by ingest from a {@code ChannelOrderRef} the source declared — NAVER 고객 문의's required
     * {@code orderId}, or a Cafe24 board article's {@code order_id}. Never derived from the inquiry
     * body, never from the buyer, never from a date/amount match.
     */
    SOURCE_EXACT
}
