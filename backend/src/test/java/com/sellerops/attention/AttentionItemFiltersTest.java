package com.sellerops.attention;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/**
 * Pins the signal-type → row-predicate mapping that keeps a signal's count and its
 * drilled rows consistent. Pure: no DB, no clock.
 */
class AttentionItemFiltersTest {

    @Test
    void unansweredInquiryFiltersPendingInquiries() {
        VocItemFilter f = AttentionItemFilters.forType(AttentionSignalType.UNANSWERED_INQUIRY);
        assertThat(f.sourceKind()).isEqualTo("PRODUCT_INQUIRY");
        assertThat(f.replyStatus()).isEqualTo("PENDING");
        assertThat(f.minRating()).isNull();
        assertThat(f.maxRating()).isNull();
    }

    @Test
    void unknownReplyStatusFiltersUnknownInquiries() {
        VocItemFilter f = AttentionItemFilters.forType(AttentionSignalType.UNKNOWN_REPLY_STATUS);
        assertThat(f.sourceKind()).isEqualTo("PRODUCT_INQUIRY");
        assertThat(f.replyStatus()).isEqualTo("UNKNOWN");
        assertThat(f.minRating()).isNull();
        assertThat(f.maxRating()).isNull();
    }

    @Test
    void newInquiryFiltersInquiriesWithNoReplyOrRatingConstraint() {
        VocItemFilter f = AttentionItemFilters.forType(AttentionSignalType.NEW_INQUIRY);
        assertThat(f.sourceKind()).isEqualTo("PRODUCT_INQUIRY");
        assertThat(f.replyStatus()).isNull();
        assertThat(f.minRating()).isNull();
        assertThat(f.maxRating()).isNull();
    }

    @Test
    void newReviewFiltersReviewsWithNoRatingConstraint() {
        VocItemFilter f = AttentionItemFilters.forType(AttentionSignalType.NEW_REVIEW);
        assertThat(f.sourceKind()).isEqualTo("REVIEW");
        assertThat(f.replyStatus()).isNull();
        assertThat(f.minRating()).isNull();
        assertThat(f.maxRating()).isNull();
    }

    @Test
    void lowRatingReviewSpansOneToThreeStars() {
        VocItemFilter f = AttentionItemFilters.forType(AttentionSignalType.LOW_RATING_REVIEW);
        assertThat(f.sourceKind()).isEqualTo("REVIEW");
        assertThat(f.replyStatus()).isNull();
        assertThat(f.minRating()).isEqualTo(1);
        assertThat(f.maxRating()).isEqualTo(3);
    }
}
