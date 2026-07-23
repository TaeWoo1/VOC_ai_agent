package com.sellerops.attention;

/**
 * Channel-generic kinds of operator attention signal derived from collected VOC
 * data. Independent of any one marketplace — Cafe24 is today's only source, but a
 * NAVER/ESM+/Coupang adapter produces the same types.
 */
public enum AttentionSignalType {
    UNANSWERED_INQUIRY,
    LOW_RATING_REVIEW,
    NEW_INQUIRY,
    NEW_REVIEW,
    UNKNOWN_REPLY_STATUS,
    // Volume changed vs the immediately preceding equal-length window. REVIEW and
    // INQUIRY are kept as distinct types so the type-only drill-down stays unambiguous.
    RECENT_REVIEW_SPIKE_CANDIDATE,
    RECENT_INQUIRY_SPIKE_CANDIDATE;

    /**
     * Whether this lens accepts a classification facet.
     *
     * <p>Only the WORKLIST lens does. The arrival lenses ({@code NEW_*}, the spike drill-downs)
     * report what came in over a window — a record, not a queue to slice up — and the inquiry
     * lenses have no analysis-backed rows on the faceted source at all.
     *
     * <p>Stated on the type rather than inside one adapter because it is a property of the
     * REQUEST, and the request has to be answered before any adapter is chosen: a category sent
     * with a lens that cannot use it must be REFUSED, not dropped. Silently ignoring it is the
     * worse half of the failure the unknown-category 400 exists to prevent — the caller believes
     * a filter applied and receives strictly more rows than they asked for, with nothing in the
     * response saying so.
     */
    public boolean supportsCategoryFacet() {
        return this == LOW_RATING_REVIEW;
    }
}
