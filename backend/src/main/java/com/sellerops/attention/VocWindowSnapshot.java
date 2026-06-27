package com.sellerops.attention;

/**
 * Channel-generic aggregate VOC counts for one account over one window — the
 * deterministic input to {@link AttentionSignalRules}. Built from exact DB counts:
 * no article body is ever loaded into memory. {@code lowRatingReviews} is the 1–2★
 * bucket, {@code midRatingReviews} the 3★ bucket; both are subsets of
 * {@code newReviews}. Counts cover known-date rows only (unknown source dates are
 * excluded upstream, a conservative undercount).
 *
 * <p>{@code previousReviews}/{@code previousInquiries} are the same review/inquiry
 * counts over the immediately preceding equal-length window — the baseline for the
 * spike lenses. They never surface directly; only the comparison does.
 */
public record VocWindowSnapshot(
        long newReviews,
        long newInquiries,
        long unansweredInquiries,
        long unknownReplyInquiries,
        long lowRatingReviews,
        long midRatingReviews,
        long previousReviews,
        long previousInquiries) {
}
