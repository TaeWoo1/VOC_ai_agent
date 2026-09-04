package com.sellerops.report;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.LocalDate;
import org.junit.jupiter.api.Test;

class ReportPeriodTest {

    @Test
    void theLatestWeeklyPeriodIsTheLastCompletedMondayToSunday() {
        // 2026-09-04 is a Friday.
        ReportPeriod p = ReportPeriod.latestCompleted(ReportKind.WEEKLY, LocalDate.of(2026, 9, 4));
        assertThat(p.start()).isEqualTo(LocalDate.of(2026, 8, 24));
        assertThat(p.end()).isEqualTo(LocalDate.of(2026, 8, 30));
        assertThat(p.previousStart()).isEqualTo(LocalDate.of(2026, 8, 17));
        assertThat(p.previousEnd()).isEqualTo(LocalDate.of(2026, 8, 23));
        assertThat(p.labelKo()).isEqualTo("2026년 8월 24일 ~ 30일");
    }

    @Test
    void onAMondayLastWeekEndedYesterday() {
        ReportPeriod p = ReportPeriod.latestCompleted(ReportKind.WEEKLY, LocalDate.of(2026, 9, 7));
        assertThat(p.start()).isEqualTo(LocalDate.of(2026, 8, 31));
        assertThat(p.end()).isEqualTo(LocalDate.of(2026, 9, 6));
        assertThat(p.labelKo()).isEqualTo("2026년 8월 31일 ~ 9월 6일");
    }

    @Test
    void theLatestMonthlyPeriodIsThePreviousCalendarMonth() {
        ReportPeriod p = ReportPeriod.latestCompleted(ReportKind.MONTHLY, LocalDate.of(2026, 9, 4));
        assertThat(p.start()).isEqualTo(LocalDate.of(2026, 8, 1));
        assertThat(p.end()).isEqualTo(LocalDate.of(2026, 8, 31));
        assertThat(p.previousStart()).isEqualTo(LocalDate.of(2026, 7, 1));
        assertThat(p.previousEnd()).isEqualTo(LocalDate.of(2026, 7, 31));
        assertThat(p.labelKo()).isEqualTo("2026년 8월");
    }

    @Test
    void anUnalignedStartIsRefusedRatherThanReinterpreted() {
        assertThatThrownBy(() -> ReportPeriod.startingAt(ReportKind.WEEKLY, LocalDate.of(2026, 9, 2)))
                .hasMessageContaining("월요일");
        assertThatThrownBy(() -> ReportPeriod.startingAt(ReportKind.MONTHLY, LocalDate.of(2026, 9, 2)))
                .hasMessageContaining("1일");
    }

    @Test
    void aPeriodIsCompleteOnlyOnceItsEndHasPassed() {
        ReportPeriod p = ReportPeriod.startingAt(ReportKind.WEEKLY, LocalDate.of(2026, 8, 31));
        assertThat(p.completedBy(LocalDate.of(2026, 9, 6))).isFalse();
        assertThat(p.completedBy(LocalDate.of(2026, 9, 7))).isTrue();
    }
}
