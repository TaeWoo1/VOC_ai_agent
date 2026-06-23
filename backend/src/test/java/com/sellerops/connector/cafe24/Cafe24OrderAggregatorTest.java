package com.sellerops.connector.cafe24;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.ingest.canonical.CanonicalOrderSummary;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * The load-bearing fold: Cafe24 order rows → per-day {@link CanonicalOrderSummary}.
 * Covers KST bucketing (incl. an offset instant crossing midnight), distinct-order
 * counting, payment_amount decimal→long summing, and the fail-loud contract checks.
 */
class Cafe24OrderAggregatorTest {

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    private static Cafe24OrderRow order(String id, String date, String amount) {
        return new Cafe24OrderRow(id, date, amount);
    }

    @Test
    void bucketsByDaySummingAmountsAndCountingDistinctOrders() {
        List<CanonicalOrderSummary> out = Cafe24OrderAggregator.aggregate(List.of(
                order("o1", "2026-06-20T10:00:00+09:00", "1000"),
                order("o2", "2026-06-20T23:00:00+09:00", "2000.00"),
                order("o3", "2026-06-21T09:00:00+09:00", "500")), KST);

        assertThat(out).extracting(CanonicalOrderSummary::summaryDate)
                .containsExactly(LocalDate.parse("2026-06-20"), LocalDate.parse("2026-06-21"));
        assertThat(out.get(0).orderCount()).isEqualTo(2);
        assertThat(out.get(0).salesAmount()).isEqualTo(3000L);
        assertThat(out.get(0).sourceRow()).isEqualTo(1);
        assertThat(out.get(1).orderCount()).isEqualTo(1);
        assertThat(out.get(1).salesAmount()).isEqualTo(500L);
        assertThat(out.get(1).sourceRow()).isEqualTo(2);
    }

    @Test
    void convertsOffsetInstantToTheCorrectKstDay() {
        // 2026-06-20T20:00Z == 2026-06-21T05:00 KST → lands on the 21st;
        // the same wall-time at +09:00 stays on the 20th.
        List<CanonicalOrderSummary> out = Cafe24OrderAggregator.aggregate(List.of(
                order("a", "2026-06-20T20:00:00+00:00", "1000"),
                order("b", "2026-06-20T20:00:00+09:00", "1000")), KST);

        assertThat(out).extracting(CanonicalOrderSummary::summaryDate)
                .containsExactly(LocalDate.parse("2026-06-20"), LocalDate.parse("2026-06-21"));
    }

    @Test
    void acceptsZonelessDatetimeAndDateOnly() {
        List<CanonicalOrderSummary> out = Cafe24OrderAggregator.aggregate(List.of(
                order("a", "2026-06-20T23:30:00", "1000"),
                order("b", "2026-06-20", "2000")), KST);

        assertThat(out).hasSize(1);
        assertThat(out.get(0).summaryDate()).isEqualTo(LocalDate.parse("2026-06-20"));
        assertThat(out.get(0).orderCount()).isEqualTo(2);
        assertThat(out.get(0).salesAmount()).isEqualTo(3000L);
    }

    @Test
    void countsADuplicateOrderIdOnce() {
        List<CanonicalOrderSummary> out = Cafe24OrderAggregator.aggregate(List.of(
                order("dup", "2026-06-20T10:00:00+09:00", "1000"),
                order("dup", "2026-06-20T10:00:00+09:00", "1000")), KST);

        assertThat(out.get(0).orderCount()).isEqualTo(1);
        assertThat(out.get(0).salesAmount()).isEqualTo(1000L);
    }

    @Test
    void countsBlankOrderIdsEachTime() {
        List<CanonicalOrderSummary> out = Cafe24OrderAggregator.aggregate(List.of(
                order("", "2026-06-20T10:00:00+09:00", "1000"),
                order(null, "2026-06-20T11:00:00+09:00", "1000")), KST);

        assertThat(out.get(0).orderCount()).isEqualTo(2);
        assertThat(out.get(0).salesAmount()).isEqualTo(2000L);
    }

    @Test
    void emptyInputYieldsNoRows() {
        assertThat(Cafe24OrderAggregator.aggregate(List.of(), KST)).isEmpty();
    }

    @Test
    void treatsBlankAmountAsZero() {
        List<CanonicalOrderSummary> out = Cafe24OrderAggregator.aggregate(List.of(
                order("a", "2026-06-20T10:00:00+09:00", ""),
                order("b", "2026-06-20T11:00:00+09:00", "1500")), KST);

        assertThat(out.get(0).orderCount()).isEqualTo(2);
        assertThat(out.get(0).salesAmount()).isEqualTo(1500L);
    }

    @Test
    void nonIntegerAmountThrows() {
        assertThatThrownBy(() -> Cafe24OrderAggregator.aggregate(List.of(
                order("a", "2026-06-20T10:00:00+09:00", "1000.50")), KST))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("결제 금액");
    }

    @Test
    void malformedDateThrows() {
        assertThatThrownBy(() -> Cafe24OrderAggregator.aggregate(List.of(
                order("a", "not-a-date", "1000")), KST))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("일자");
    }
}
