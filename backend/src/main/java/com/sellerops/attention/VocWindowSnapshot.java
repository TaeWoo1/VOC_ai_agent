package com.sellerops.attention;

/**
 * Channel-generic aggregate VOC counts for one account over one window — the
 * deterministic input to {@link AttentionSignalRules}. Built from exact DB counts:
 * no article body is ever loaded into memory. {@code lowRatingReviews} is the 1–2★
 * bucket, {@code midRatingReviews} the 3★ bucket; both are subsets of
 * {@code newReviews}. Counts cover known-date rows only (unknown source dates are
 * excluded upstream, a conservative undercount).
 */
public record VocWindowSnapshot(
        long newReviews,
        long newInquiries,
        long unansweredInquiries,
        long unknownReplyInquiries,
        long lowRatingReviews,
        long midRatingReviews) {
}
