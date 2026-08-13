package com.sellerops.connector.coupang;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;

/**
 * The opaque {@code cursorValue} of the Coupang INQUIRY stream, serialized as JSON
 * ({@code sync_cursors.cursor_value} is {@code text}).
 *
 * <p>Coupang's official 상품별 고객문의 query ({@code onlineInquiries}) filters by an
 * {@code inquiryAt} <b>date</b> range in KST and caps a single query at <b>7 days</b> —
 * a quarter of the order endpoint's 31. A 7-day reach is not an initial import, so unlike
 * {@link CoupangOrdersCursor} this cursor has two phases:
 *
 * <ul>
 *   <li><b>Backfill</b> — walk BACKWARD from today in ≤7-day windows until
 *       {@link #INITIAL_BACKFILL_DAYS} of history is covered. Each window is one
 *       {@code fetch} that returns {@code hasMore=true}, so the executor's existing paging
 *       loop drives the walk and persists the cursor after every window: an interrupted
 *       backfill resumes where it stopped instead of restarting.</li>
 *   <li><b>Routine</b> — once the floor is reached, every run sweeps a short trailing
 *       window ({@link #ROUTINE_OVERLAP_DAYS} back, plus any scheduler gap) up to the
 *       7-day cap, and returns {@code hasMore=false}.</li>
 * </ul>
 *
 * <p>Re-sweeping recent days re-fetches those inquiries; ingestion is idempotent (upsert
 * by {@code externalId}), so this is safe and is exactly how an inquiry that gets answered
 * on the platform is picked up — the re-collected row flips UNANSWERED → ANSWERED and the
 * open work item is reconciled.
 *
 * <p><b>The bound, stated honestly.</b> A scheduler outage longer than the 7-day cap
 * leaves a permanent hole: inquiries received before {@code today - MAX_WINDOW_DAYS} are
 * never swept by the routine phase, and {@code throughDate} still advances to today. This
 * is inherent to Coupang's 7-day query limit. It is narrower than the order stream's
 * 31-day equivalent, so it is likelier to be hit — recovery is a deliberate re-backfill
 * (clearing the cursor), not something the routine window will heal on its own.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
record CoupangInquiryCursor(boolean backfillComplete, String earliestSwept, String throughDate) {

    /** How far back the initial import reaches, walked in {@link #MAX_WINDOW_DAYS} chunks. */
    static final int INITIAL_BACKFILL_DAYS = 30;
    /** Routine re-sweep of recent days, to catch answers and late inquiries. */
    static final int ROUTINE_OVERLAP_DAYS = 2;
    /**
     * Coupang's officially documented maximum single-query span for this endpoint: 7 days.
     * Expressed as the inclusive span, so a window is {@code [to - (MAX_WINDOW_DAYS - 1), to]}
     * — 7 dates end to end. The conservative reading: the doc says "≤ 7 days" without saying
     * whether both endpoints count, and a window one day too wide is an HTTP 400 for the whole
     * run, while one day too narrow costs nothing (the next window covers it).
     */
    static final int MAX_WINDOW_DAYS = 7;

    private static final DateTimeFormatter DATE = DateTimeFormatter.ISO_LOCAL_DATE;

    /** First-ever cursor: nothing swept, backfill not started. */
    static CoupangInquiryCursor initial() {
        return new CoupangInquiryCursor(false, null, null);
    }

    /**
     * The inclusive KST window to sweep this run, and whether more windows remain.
     *
     * <p>During backfill the window marches backward from the earliest date already swept;
     * {@code more} stays true until the window's {@code from} reaches the backfill floor.
     * In the routine phase the window ends at today and reaches back over the routine overlap
     * and any scheduler gap, clamped to the 7-day cap.
     */
    Sweep sweepFor(LocalDate today) {
        LocalDate floor = today.minusDays(INITIAL_BACKFILL_DAYS);
        if (!backfillComplete) {
            LocalDate to = earliest(today);
            // The first backfill window ends today; each later one ends the day before the
            // earliest date already swept, so windows tile without gaps and without overlap.
            LocalDate windowTo = to == null ? today : to.minusDays(1);
            if (windowTo.isBefore(floor)) {
                // Already past the floor (e.g. INITIAL_BACKFILL_DAYS was lowered between runs) —
                // nothing left to backfill; fall through to the routine window this run.
                return routineSweep(today);
            }
            LocalDate windowFrom = maxDate(windowTo.minusDays(MAX_WINDOW_DAYS - 1), floor);
            boolean reachedFloor = !windowFrom.isAfter(floor);
            return new Sweep(new DateWindow(windowFrom, windowTo), !reachedFloor);
        }
        return routineSweep(today);
    }

    /** The trailing routine window: overlap + scheduler gap, clamped to the official cap. */
    private Sweep routineSweep(LocalDate today) {
        LocalDate cap = today.minusDays(MAX_WINDOW_DAYS - 1);
        LocalDate routineFrom = today.minusDays(ROUTINE_OVERLAP_DAYS);
        LocalDate lastThrough = parseOrNull(throughDate);
        LocalDate desiredFrom = lastThrough == null
                ? routineFrom
                : earlierDate(routineFrom, lastThrough.minusDays(ROUTINE_OVERLAP_DAYS));
        LocalDate from = maxDate(desiredFrom, cap);
        // A future/garbage throughDate must never invert the window.
        if (from.isAfter(today)) {
            from = today;
        }
        return new Sweep(new DateWindow(from, today), false);
    }

    /**
     * The cursor to persist after sweeping {@code window}. {@code more} is what
     * {@link #sweepFor} just reported: once it goes false the backfill is complete and every
     * later run takes the routine branch. {@code throughDate} only ever moves forward, so a
     * backward-walking backfill window never rewinds the routine phase's high-water mark.
     */
    CoupangInquiryCursor swept(DateWindow window, boolean more) {
        LocalDate previousEarliest = parseOrNull(earliestSwept);
        LocalDate previousThrough = parseOrNull(throughDate);
        LocalDate nextEarliest = previousEarliest == null
                ? window.from()
                : earlierDate(previousEarliest, window.from());
        LocalDate nextThrough = previousThrough == null
                ? window.to()
                : maxDate(previousThrough, window.to());
        return new CoupangInquiryCursor(!more, nextEarliest.format(DATE), nextThrough.format(DATE));
    }

    private LocalDate earliest(LocalDate today) {
        LocalDate parsed = parseOrNull(earliestSwept);
        // A garbage or future earliest date must not push the walk forward past today.
        return parsed == null || parsed.isAfter(today) ? null : parsed;
    }

    private static LocalDate earlierDate(LocalDate a, LocalDate b) {
        return a.isBefore(b) ? a : b;
    }

    private static LocalDate maxDate(LocalDate a, LocalDate b) {
        return a.isBefore(b) ? b : a;
    }

    private static LocalDate parseOrNull(String date) {
        try {
            return LocalDate.parse(date, DATE);
        } catch (Exception e) {
            return null;
        }
    }

    /** One window plus whether the backfill walk has further windows after it. */
    record Sweep(DateWindow window, boolean more) {
    }

    /** An inclusive KST date window; the params render the official {@code yyyy-MM-dd} form. */
    record DateWindow(LocalDate from, LocalDate to) {
        String fromParam() {
            return from.format(DATE);
        }

        String toParam() {
            return to.format(DATE);
        }
    }
}
