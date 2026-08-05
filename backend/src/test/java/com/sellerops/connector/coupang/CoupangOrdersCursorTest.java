package com.sellerops.connector.coupang;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import org.junit.jupiter.api.Test;

/**
 * The Coupang order cursor's window derivation — the "기간 경계" (period-boundary) contract: the first
 * run reaches back the initial backfill, routine runs re-sweep a small recent overlap, a scheduler gap
 * is covered, and every window is clamped to Coupang's official 31-day maximum.
 */
class CoupangOrdersCursorTest {

    private static final LocalDate TODAY = LocalDate.parse("2026-08-05");

    @Test
    void initialRunReachesBackTheBackfillWindowEndingToday() {
        CoupangOrdersCursor.DateWindow window = CoupangOrdersCursor.initial().windowFor(TODAY);

        assertThat(window.to()).isEqualTo(TODAY);
        assertThat(window.from()).isEqualTo(TODAY.minusDays(CoupangOrdersCursor.INITIAL_BACKFILL_DAYS));
    }

    @Test
    void routineRunAfterDailyScheduleReSweepsOnlyRecentDays() {
        // Swept through yesterday; a routine run re-sweeps a small overlap (never the full backfill).
        CoupangOrdersCursor cursor = CoupangOrdersCursor.initial().sweptThrough(TODAY.minusDays(1));

        CoupangOrdersCursor.DateWindow window = cursor.windowFor(TODAY);

        assertThat(window.to()).isEqualTo(TODAY);
        // min(today-overlap, throughDate-overlap) = (yesterday) - overlap.
        assertThat(window.from()).isEqualTo(TODAY.minusDays(1 + CoupangOrdersCursor.ROUTINE_OVERLAP_DAYS));
    }

    @Test
    void aSchedulerGapIsCoveredByReachingBackToTheLastSweptDate() {
        // The scheduler was down: last swept 10 days ago. The next window reaches back to cover the gap.
        CoupangOrdersCursor cursor = CoupangOrdersCursor.initial().sweptThrough(TODAY.minusDays(10));

        CoupangOrdersCursor.DateWindow window = cursor.windowFor(TODAY);

        assertThat(window.from()).isEqualTo(TODAY.minusDays(10 + CoupangOrdersCursor.ROUTINE_OVERLAP_DAYS));
    }

    @Test
    void windowNeverExceedsTheOfficialMaxSpan() {
        // A very old throughDate must never produce a window wider than 31 days.
        CoupangOrdersCursor cursor = CoupangOrdersCursor.initial().sweptThrough(TODAY.minusDays(365));

        CoupangOrdersCursor.DateWindow window = cursor.windowFor(TODAY);

        assertThat(window.from()).isEqualTo(TODAY.minusDays(CoupangOrdersCursor.MAX_WINDOW_DAYS));
    }

    @Test
    void aCorruptThroughDateFallsBackToTheRoutineOverlapWithoutInvertingTheWindow() {
        CoupangOrdersCursor cursor = new CoupangOrdersCursor(true, "not-a-date");

        CoupangOrdersCursor.DateWindow window = cursor.windowFor(TODAY);

        assertThat(window.to()).isEqualTo(TODAY);
        assertThat(window.from()).isEqualTo(TODAY.minusDays(CoupangOrdersCursor.ROUTINE_OVERLAP_DAYS));
        assertThat(window.from()).isBeforeOrEqualTo(window.to());
    }
}
