package com.sellerops.dashboard;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.dashboard.dto.DashboardCards;
import java.lang.reflect.RecordComponent;
import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * <b>No card on the legacy dashboard may be a combined or ranked quantity.</b>
 *
 * <p>{@code urgentCount} was {@code unansweredInquiries + negativeReviews} — measured at 43 (24 + 19)
 * on the demo org — and {@code unhandledCount} was a second name for {@code unansweredInquiries}.
 * Neither described a set of rows a seller could open, and both were removed once the audit found no
 * consumer anywhere (no screen calls the summary endpoint; the agent runtime's type reads only
 * {@code topProductIssues} and {@code cards.negativeReviews}).
 *
 * <p>This test exists because the next person to want a single "얼마나 급한가" number will reach for
 * exactly this record. The rule is not "these two names are banned" — it is that every card answers
 * one question over one population and says in its own name which one.
 */
class DashboardCardsShapeTest {

    private static List<String> components() {
        return Arrays.stream(DashboardCards.class.getRecordComponents())
                .map(RecordComponent::getName).toList();
    }

    @Test
    void carriesNoCombinedOrRankedQuantity() {
        assertThat(components()).noneSatisfy(name -> assertThat(name.toLowerCase())
                .containsAnyOf("urgent", "urgency", "unhandled", "score", "priority", "weight",
                        "combined"));
    }

    /**
     * And nothing anonymous: a bare {@code total} or {@code count} would be a figure whose population
     * a reader has to guess, which is how the combined one was written in the first place.
     */
    @Test
    void everyCardNamesThePopulationItCounts() {
        assertThat(components()).doesNotContain("total", "count", "pending", "all");
        assertThat(components()).containsExactly(
                "todayOrders", "todaySales", "newInquiries", "unansweredInquiries",
                "newReviews", "negativeReviews");
    }
}
