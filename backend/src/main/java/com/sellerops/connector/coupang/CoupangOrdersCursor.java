package com.sellerops.connector.coupang;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;

/**
 * The opaque {@code cursorValue} of the Coupang ORDER_SUMMARY stream, serialized as
 * JSON ({@code sync_cursors.cursor_value} is {@code text}).
 *
 * <p>Coupang's official order list ("PO list query, paging by day", v5
 * {@code ordersheets}) filters by a {@code createdAt} <b>date</b> range in KST and
 * caps a single query at <b>31 days</b>. Unlike NAVER's last-changed stream, one
 * {@code fetch} sweeps a whole rolling date window in full (every required
 * {@code status}, following {@code nextToken} to the end), so each swept day's
 * summary is <b>complete</b> — the shared aggregate upsert overwrites by (channel,
 * date) and therefore converges without carrying per-day running totals in the
 * cursor. That makes this cursor deliberately tiny:
 *
 * <ul>
 *   <li>{@code initialized} — false until the first backfill runs, then true. The
 *       first run reaches back {@link #INITIAL_BACKFILL_DAYS}; later routine runs use
 *       the lighter {@link #ROUTINE_OVERLAP_DAYS} re-sweep.</li>
 *   <li>{@code throughDate} — the last KST date swept (observability + gap recovery).
 *       If the scheduler was down for a while, the next window reaches back far enough
 *       to cover the gap, still clamped to the official {@link #MAX_WINDOW_DAYS}.</li>
 * </ul>
 *
 * <p>Re-sweeping recent days each routine run re-fetches those orders; ingestion is
 * idempotent (dedup by {@code shipmentBoxId}), so this is safe and is how in-window
 * status changes are picked up. Orders whose status changes after they age out of the
 * routine window are a documented bound, not a silent gap.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
record CoupangOrdersCursor(boolean initialized, String throughDate) {

    /** First-ever backfill reach (KST days). */
    static final int INITIAL_BACKFILL_DAYS = 7;
    /** Routine re-sweep of recent days, to catch in-window status changes and late orders. */
    static final int ROUTINE_OVERLAP_DAYS = 2;
    /** Coupang's officially documented maximum single-query span. */
    static final int MAX_WINDOW_DAYS = 31;

    private static final DateTimeFormatter DATE = DateTimeFormatter.ISO_LOCAL_DATE;

    /** First-ever cursor: no backfill has run yet. */
    static CoupangOrdersCursor initial() {
        return new CoupangOrdersCursor(false, null);
    }

    /**
     * The inclusive KST {@code [from, to]} date window to sweep this run. {@code to} is
     * always today (KST); {@code from} reaches back the initial backfill on the first run,
     * else far enough to re-sweep recent days AND cover any scheduler gap since
     * {@code throughDate} — then clamped to the official 31-day cap so a request can never
     * exceed it.
     */
    DateWindow windowFor(LocalDate today) {
        LocalDate desiredFrom;
        if (initialized && throughDate != null) {
            LocalDate lastThrough = parseOrNull(throughDate);
            LocalDate routineFrom = today.minusDays(ROUTINE_OVERLAP_DAYS);
            desiredFrom = lastThrough == null
                    ? routineFrom
                    : earlier(routineFrom, lastThrough.minusDays(ROUTINE_OVERLAP_DAYS));
        } else {
            desiredFrom = today.minusDays(INITIAL_BACKFILL_DAYS);
        }
        LocalDate cap = today.minusDays(MAX_WINDOW_DAYS);
        LocalDate from = desiredFrom.isBefore(cap) ? cap : desiredFrom;
        // A future/garbage throughDate must never invert the window.
        if (from.isAfter(today)) {
            from = today;
        }
        return new DateWindow(from, today);
    }

    /** The cursor to persist after a run that swept through {@code today} (KST). */
    CoupangOrdersCursor sweptThrough(LocalDate today) {
        return new CoupangOrdersCursor(true, today.format(DATE));
    }

    private static LocalDate earlier(LocalDate a, LocalDate b) {
        return a.isBefore(b) ? a : b;
    }

    private static LocalDate parseOrNull(String date) {
        try {
            return LocalDate.parse(date, DATE);
        } catch (Exception e) {
            return null;
        }
    }

    /** An inclusive KST date window; {@link #fromParam}/{@link #toParam} render the query dates. */
    record DateWindow(LocalDate from, LocalDate to) {
        String fromParam() {
            return from.format(DATE);
        }

        String toParam() {
            return to.format(DATE);
        }
    }
}
