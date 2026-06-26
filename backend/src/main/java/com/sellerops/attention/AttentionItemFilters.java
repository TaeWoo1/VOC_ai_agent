package com.sellerops.attention;

import com.sellerops.community.CommunityReplyStatus;

/**
 * Pure mapping from an {@link AttentionSignalType} to the {@link VocItemFilter}
 * that selects exactly the rows behind that signal's count. The companion to
 * {@link AttentionSignalRules}: where the rules turn aggregate counts into ranked
 * signals, this turns one chosen signal back into the row-level predicates for the
 * drill-down list — so a "N건" signal and its drilled rows stay consistent.
 *
 * <p>No DB, no clock; source-kind constants and rating bounds mirror
 * {@link OperatorAttentionService}'s count queries. {@code LOW_RATING_REVIEW}
 * intentionally spans 1–3★ (the union of the 1–2★/3★ count buckets).
 */
public final class AttentionItemFilters {

    static final String SOURCE_KIND_REVIEW = "REVIEW";
    static final String SOURCE_KIND_INQUIRY = "PRODUCT_INQUIRY";

    private AttentionItemFilters() {
    }

    /** The row predicates behind one signal type. */
    public static VocItemFilter forType(AttentionSignalType type) {
        return switch (type) {
            case UNANSWERED_INQUIRY ->
                    new VocItemFilter(SOURCE_KIND_INQUIRY, CommunityReplyStatus.PENDING.name(), null, null);
            case UNKNOWN_REPLY_STATUS ->
                    new VocItemFilter(SOURCE_KIND_INQUIRY, CommunityReplyStatus.UNKNOWN.name(), null, null);
            case NEW_INQUIRY -> new VocItemFilter(SOURCE_KIND_INQUIRY, null, null, null);
            case NEW_REVIEW -> new VocItemFilter(SOURCE_KIND_REVIEW, null, null, null);
            // 1–2★ (HIGH) and 3★ (MEDIUM) count cards share this type; the drill-down
            // shows their union (1–3★). Null-rating reviews are excluded by minRating=1.
            case LOW_RATING_REVIEW -> new VocItemFilter(SOURCE_KIND_REVIEW, null, 1, 3);
        };
    }
}
