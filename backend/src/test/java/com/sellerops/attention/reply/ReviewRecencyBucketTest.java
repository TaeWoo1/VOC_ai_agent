package com.sellerops.attention.reply;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;

/**
 * Coarse KST recency bucketing, bound to an explicit as-of date. All instants are chosen so their KST
 * (UTC+9) calendar date is unambiguous (T02:00Z → 11:00 KST, well clear of a date rollover).
 */
class ReviewRecencyBucketTest {

    private static final LocalDate AS_OF = LocalDate.parse("2026-05-12");

    @Test
    void asOfKstDateUsesTheSeoulCalendarDate() {
        // 2026-05-11T20:00Z = 2026-05-12T05:00 KST → 2026-05-12.
        assertThat(ReviewRecencyBucket.asOfKstDate(Instant.parse("2026-05-11T20:00:00Z")))
                .isEqualTo(LocalDate.parse("2026-05-12"));
        // 2026-05-11T14:00Z = 2026-05-11T23:00 KST → still 2026-05-11.
        assertThat(ReviewRecencyBucket.asOfKstDate(Instant.parse("2026-05-11T14:00:00Z")))
                .isEqualTo(LocalDate.parse("2026-05-11"));
    }

    @Test
    void sameKstDateIsToday() {
        assertThat(ReviewRecencyBucket.of(Instant.parse("2026-05-12T02:00:00Z"), AS_OF))
                .isEqualTo(ReviewRecencyBucket.TODAY);
    }

    @Test
    void oneToSixKstDaysBeforeIsThisWeek() {
        assertThat(ReviewRecencyBucket.of(Instant.parse("2026-05-11T02:00:00Z"), AS_OF)) // 1 day
                .isEqualTo(ReviewRecencyBucket.THIS_WEEK);
        assertThat(ReviewRecencyBucket.of(Instant.parse("2026-05-06T02:00:00Z"), AS_OF)) // 6 days
                .isEqualTo(ReviewRecencyBucket.THIS_WEEK);
    }

    @Test
    void sevenOrMoreKstDaysBeforeIsOlder() {
        assertThat(ReviewRecencyBucket.of(Instant.parse("2026-05-05T02:00:00Z"), AS_OF)) // 7 days
                .isEqualTo(ReviewRecencyBucket.OLDER);
        assertThat(ReviewRecencyBucket.of(Instant.parse("2026-01-01T02:00:00Z"), AS_OF))
                .isEqualTo(ReviewRecencyBucket.OLDER);
    }

    @Test
    void futureClampsToTodayAndNullDateIsOlder() {
        assertThat(ReviewRecencyBucket.of(Instant.parse("2026-06-01T02:00:00Z"), AS_OF))
                .isEqualTo(ReviewRecencyBucket.TODAY);
        assertThat(ReviewRecencyBucket.of(null, AS_OF)).isEqualTo(ReviewRecencyBucket.OLDER);
    }
}
