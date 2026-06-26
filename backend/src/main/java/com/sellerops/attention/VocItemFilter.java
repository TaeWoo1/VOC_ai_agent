package com.sellerops.attention;

/**
 * The DB predicate set a single {@link AttentionSignalType} drills down to —
 * channel-generic, computed (not stored). {@code replyStatus}/{@code minRating}/
 * {@code maxRating} are nullable: a null means "no constraint on that column" so
 * the same shape covers reply-filtered, rating-bucketed, and unconstrained signals.
 *
 * <p>{@code sourceKind} uses the stored normalized name (REVIEW / PRODUCT_INQUIRY);
 * {@code replyStatus} uses a {@link com.sellerops.community.CommunityReplyStatus}
 * name. The mapping itself lives in {@link AttentionItemFilters}.
 */
public record VocItemFilter(String sourceKind, String replyStatus, Integer minRating, Integer maxRating) {
}
