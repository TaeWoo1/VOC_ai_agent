package com.sellerops.connector.coupang;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * The Coupang inquiry cursor's two-phase window derivation. Coupang caps this endpoint's query at
 * <b>7 days</b>, so an initial import cannot be one sweep — it is a backward walk of 7-day windows,
 * and the properties that matter are: the walk <b>tiles</b> (no gap, no overlap), it <b>terminates</b>
 * at the backfill floor, it <b>resumes</b> from a persisted cursor rather than restarting, and no
 * window it ever produces exceeds the official cap.
 */
class CoupangInquiryCursorTest {

    private static final LocalDate TODAY = LocalDate.parse("2026-08-05");

    /** Drive the walk to completion, collecting every window the cursor asks for. */
    private static List<CoupangInquiryCursor.DateWindow> walk(LocalDate today, int maxSteps) {
        List<CoupangInquiryCursor.DateWindow> windows = new ArrayList<>();
        CoupangInquiryCursor cursor = CoupangInquiryCursor.initial();
        for (int i = 0; i < maxSteps; i++) {
            CoupangInquiryCursor.Sweep sweep = cursor.sweepFor(today);
            windows.add(sweep.window());
            cursor = cursor.swept(sweep.window(), sweep.more());
            if (!sweep.more()) {
                break;
            }
        }
        return windows;
    }

    @Test
    void theFirstBackfillWindowEndsTodayAndSpansExactlyTheOfficialCap() {
        CoupangInquiryCursor.Sweep sweep = CoupangInquiryCursor.initial().sweepFor(TODAY);

        assertThat(sweep.window().to()).isEqualTo(TODAY);
        assertThat(sweep.window().from())
                .isEqualTo(TODAY.minusDays(CoupangInquiryCursor.MAX_WINDOW_DAYS - 1));
        // 7 dates end to end — the inclusive reading of "≤ 7 days".
        assertThat(sweep.window().from().datesUntil(sweep.window().to().plusDays(1)).count()).isEqualTo(7);
        assertThat(sweep.more()).isTrue();
    }

    @Test
    void theBackfillWalkTilesWithoutGapOrOverlapAndTerminatesAtTheFloor() {
        List<CoupangInquiryCursor.DateWindow> windows = walk(TODAY, 50);

        // Terminates — the guard is the assertion, not the loop bound.
        assertThat(windows.size()).isLessThan(50);
        assertThat(windows.get(0).to()).isEqualTo(TODAY);
        for (int i = 1; i < windows.size(); i++) {
            // Each window starts the day before the previous one began: no day is swept twice, and
            // no day between them is missed. A gap here is silently lost inquiries.
            assertThat(windows.get(i).to())
                    .as("window %d must resume the day before window %d began", i, i - 1)
                    .isEqualTo(windows.get(i - 1).from().minusDays(1));
        }
        // The walk reaches the floor and stops there — never past it.
        LocalDate floor = TODAY.minusDays(CoupangInquiryCursor.INITIAL_BACKFILL_DAYS);
        assertThat(windows.get(windows.size() - 1).from()).isEqualTo(floor);
    }

    @Test
    void everyWindowInTheWalkStaysWithinTheOfficialCap() {
        for (CoupangInquiryCursor.DateWindow window : walk(TODAY, 50)) {
            long span = window.from().datesUntil(window.to().plusDays(1)).count();
            assertThat(span)
                    .as("window %s..%s", window.fromParam(), window.toParam())
                    .isBetween(1L, (long) CoupangInquiryCursor.MAX_WINDOW_DAYS);
            assertThat(window.from()).isBeforeOrEqualTo(window.to());
        }
    }

    @Test
    void anInterruptedBackfillResumesFromThePersistedCursorRatherThanRestarting() {
        CoupangInquiryCursor cursor = CoupangInquiryCursor.initial();
        CoupangInquiryCursor.Sweep first = cursor.sweepFor(TODAY);
        cursor = cursor.swept(first.window(), first.more());

        // Simulate a crash: the cursor survives, nothing else does.
        CoupangInquiryCursor resumed = new CoupangInquiryCursor(
                cursor.backfillComplete(), cursor.earliestSwept(), cursor.throughDate());

        CoupangInquiryCursor.Sweep second = resumed.sweepFor(TODAY);
        assertThat(second.window().to()).isEqualTo(first.window().from().minusDays(1));
        assertThat(second.window().to()).isNotEqualTo(TODAY);
    }

    @Test
    void onceTheBackfillCompletesEveryRunIsTheTerminalRoutineWindow() {
        List<CoupangInquiryCursor.DateWindow> windows = walk(TODAY, 50);
        CoupangInquiryCursor cursor = CoupangInquiryCursor.initial();
        for (CoupangInquiryCursor.DateWindow ignored : windows) {
            CoupangInquiryCursor.Sweep sweep = cursor.sweepFor(TODAY);
            cursor = cursor.swept(sweep.window(), sweep.more());
        }
        assertThat(cursor.backfillComplete()).isTrue();

        CoupangInquiryCursor.Sweep routine = cursor.sweepFor(TODAY);
        assertThat(routine.more()).isFalse();
        assertThat(routine.window().to()).isEqualTo(TODAY);
        assertThat(routine.window().from()).isEqualTo(TODAY.minusDays(CoupangInquiryCursor.ROUTINE_OVERLAP_DAYS));
    }

    @Test
    void theRoutineWindowCoversASchedulerGapButNeverExceedsTheCap() {
        // Backfill done, then the scheduler was down for a long time.
        CoupangInquiryCursor stale =
                new CoupangInquiryCursor(true, TODAY.minusDays(90).toString(), TODAY.minusDays(60).toString());

        CoupangInquiryCursor.Sweep sweep = stale.sweepFor(TODAY);

        assertThat(sweep.window().to()).isEqualTo(TODAY);
        // Clamped to the cap. This is the documented permanent hole: everything between the gap and
        // the cap is NOT recovered by a routine run, and the cursor still advances to today.
        assertThat(sweep.window().from()).isEqualTo(TODAY.minusDays(CoupangInquiryCursor.MAX_WINDOW_DAYS - 1));
        assertThat(sweep.more()).isFalse();
    }

    @Test
    void aShortGapIsFullyCoveredByReachingBackToTheLastSweptDate() {
        CoupangInquiryCursor cursor =
                new CoupangInquiryCursor(true, TODAY.minusDays(30).toString(), TODAY.minusDays(3).toString());

        CoupangInquiryCursor.Sweep sweep = cursor.sweepFor(TODAY);

        assertThat(sweep.window().from())
                .isEqualTo(TODAY.minusDays(3 + CoupangInquiryCursor.ROUTINE_OVERLAP_DAYS));
    }

    @Test
    void corruptOrFutureCursorDatesNeverInvertOrRunawayTheWindow() {
        for (CoupangInquiryCursor cursor : List.of(
                new CoupangInquiryCursor(true, "not-a-date", "also-not-a-date"),
                new CoupangInquiryCursor(false, "not-a-date", null),
                // A future earliestSwept would otherwise walk the backfill FORWARD past today.
                new CoupangInquiryCursor(false, TODAY.plusDays(400).toString(), null),
                new CoupangInquiryCursor(true, null, TODAY.plusDays(400).toString()))) {
            CoupangInquiryCursor.Sweep sweep = cursor.sweepFor(TODAY);
            assertThat(sweep.window().from()).isBeforeOrEqualTo(sweep.window().to());
            assertThat(sweep.window().to()).isBeforeOrEqualTo(TODAY);
            long span = sweep.window().from().datesUntil(sweep.window().to().plusDays(1)).count();
            assertThat(span).isBetween(1L, (long) CoupangInquiryCursor.MAX_WINDOW_DAYS);
        }
    }

    @Test
    void throughDateOnlyEverMovesForwardWhileTheBackfillWalksBackward() {
        CoupangInquiryCursor cursor = CoupangInquiryCursor.initial();
        CoupangInquiryCursor.Sweep first = cursor.sweepFor(TODAY);
        cursor = cursor.swept(first.window(), first.more());
        String afterFirst = cursor.throughDate();

        CoupangInquiryCursor.Sweep second = cursor.sweepFor(TODAY);
        cursor = cursor.swept(second.window(), second.more());

        // The second window ENDS earlier than the first, but the high-water mark must not rewind —
        // otherwise the routine phase would later re-sweep from an old date and think it was current.
        assertThat(second.window().to()).isBefore(first.window().to());
        assertThat(cursor.throughDate()).isEqualTo(afterFirst);
        assertThat(cursor.earliestSwept()).isEqualTo(second.window().from().toString());
    }
}
