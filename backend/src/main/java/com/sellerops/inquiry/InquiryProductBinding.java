package com.sellerops.inquiry;

/**
 * How this inquiry's canonical product was decided.
 *
 * <p><b>Two ways of knowing, and they are not interchangeable.</b> Cafe24's 문의 board hands over a
 * product identifier on almost none of its articles — 3,312 REAL inquiries in the canonical Demo Org,
 * 5 attributed exactly — and guessing the rest from the inquiry text is forbidden for good reason.
 * The honest alternative is to let a person say which product it is; the dishonest one would be to
 * store that answer in the same field, with the same silence, as an identifier match.
 *
 * <p>So the field says which. It is not a confidence score: it is a statement about how the claim
 * could be falsified. A {@link #SOURCE_EXACT} binding is re-checkable by reading the channel again;
 * a {@link #USER_CONFIRMED} one can only be checked by asking the person who made it, whose name and
 * timestamp are therefore kept beside it.
 */
public enum InquiryProductBinding {

    /**
     * The channel's own product identifier matched {@code channel_products} exactly.
     *
     * <p>Set by ingest, never by a person. A later read may fill one in where there was none, but it
     * never replaces one — see {@code IngestionService#repairAttribution}.
     */
    SOURCE_EXACT,

    /**
     * A person picked this product on screen.
     *
     * <p>Never set by ingest, never inferred from text, and never overwritten by a later collection.
     * When the source later produces an identifier that disagrees, the disagreement is kept visible
     * ({@code source_product_ref} beside {@code product_id}) rather than silently resolved: a machine
     * overruling a human decision without saying so is the failure this whole split exists to avoid.
     */
    USER_CONFIRMED
}
