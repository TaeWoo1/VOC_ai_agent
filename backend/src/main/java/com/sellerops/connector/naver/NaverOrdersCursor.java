package com.sellerops.connector.naver;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * The opaque {@code cursorValue} of the Naver ORDER_SUMMARY stream, serialized
 * as JSON ({@code sync_cursors.cursor_value} is {@code text} since V3).
 *
 * <p>Two levels of progress:
 * <ul>
 *   <li><b>Window</b> — {@code [windowFrom, windowTo]} over {@code lastChangedDate},
 *       at most 24h per the official constraint. Windows advance contiguously
 *       ({@code next windowFrom == previous windowTo}), satisfying the official
 *       gap-avoidance rule (previous {@code lastChangedTo} ≥ next
 *       {@code lastChangedFrom}).</li>
 *   <li><b>Intra-window continuation</b> — when the response carries a
 *       {@code data.more} block, {@code moreFrom}/{@code moreSequence} resume the
 *       same window on the next fetch.</li>
 * </ul>
 *
 * <p>{@code dayTotals} carries the running per-{@code summaryDate} totals for
 * dates still being collected. The shared {@code IngestionService} upserts order
 * summaries by (channel, date) and <b>overwrites</b> the stored values, so each
 * page must emit cumulative-so-far totals, not per-page deltas — the carry is
 * what makes successive overwrites converge to the true daily total. Entries
 * older than the pruning horizon are dropped, keeping the cursor small; items
 * whose summary date falls before that horizon are skipped at collection time
 * (never emitted), so a pruned date's stored total is never overwritten with a
 * partial recount.
 *
 * <p>Because adjacent windows share their boundary instant, an event stamped
 * exactly on the boundary can be re-delivered by both windows. {@code edgeIds}
 * accumulates this window's boundary-stamped product orders;
 * {@link #advanced} promotes them to {@code dedupeIds}, which the next window
 * skips — bounded (boundary-exact timestamps only), so the cursor stays small.
 *
 * <p><b>{@code bounds}</b> — the range this cursor may write, and how far it may walk.
 * An operator's bounded window (a {@code backfill}-lane run) carries both ends: without an
 * end instant, an operator asking for two recent weeks gets a walk from wherever the cursor
 * happened to be stuck. A routine cursor carries only the floor, and only after a
 * {@link #routineRestart}; it walks 24h at a time until it reaches "now" and has no other end.
 * The floor is what pins emission to the run's own start date: without it, the
 * {@link #DAY_TOTAL_RETENTION_DAYS} carry lets the first window emit totals for the two days
 * BEFORE the range, counting only the orders that happened to change inside it — and ingestion
 * overwrites daily totals by (channel, date), so a partial recount would replace a complete one.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
record NaverOrdersCursor(
        String windowFrom,
        String windowTo,
        String moreFrom,
        String moreSequence,
        Map<String, DayTotal> dayTotals,
        List<String> dedupeIds,
        List<String> edgeIds,
        Bounds bounds) {

    /**
     * What a cursor may write, and how far it may walk.
     *
     * <p>{@code from} is the first KST calendar date whose daily total this cursor may write — the
     * emission floor, and the reason both lanes need this record. {@code toExclusive} is the instant
     * the walk stops at, and it is <b>null on the routine lane</b>: routine has no end, it walks to
     * "now" forever. So a non-null {@code toExclusive} is exactly the operator's bounded backfill, and
     * {@link NaverOrdersCursor#isRoutine()} reads it that way rather than guessing from the dates.
     *
     * @param from        inclusive KST calendar date — the emission floor
     * @param toExclusive ISO instant (this cursor's wire format) the walk never passes, or null for
     *                    the routine lane, which stops only at "now"
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    record Bounds(String from, String toExclusive) {

        LocalDate fromDate() {
            return LocalDate.parse(from);
        }

        Instant toInstant() {
            return OffsetDateTime.parse(toExclusive).toInstant();
        }
    }

    /** Officially confirmed maximum query window. */
    static final Duration MAX_WINDOW = Duration.ofHours(24);
    /** How far back the very first collection reaches (one full window). */
    static final Duration INITIAL_BACKFILL = Duration.ofHours(24);
    /** Keep running totals for dates within this many days of the window start. */
    static final int DAY_TOTAL_RETENTION_DAYS = 2;
    /**
     * Fixed wire format for the window bounds: ISO-8601 with exactly 3 millisecond
     * digits and an explicit offset, as Naver's order query params require (official
     * example, commerce-api discussion #587: {@code 2023-04-05T15:34:29.826+09:00}).
     * {@code OffsetDateTime.toString()} emits VARIABLE precision — minute-only when
     * seconds/nanos are zero, 6-digit microseconds for a wall clock — which the
     * gateway rejects with HTTP 400. {@code SSS} always renders 3 digits; {@code XXX}
     * renders {@code +09:00}.
     */
    private static final DateTimeFormatter NAVER_DATETIME =
            DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSSXXX");

    NaverOrdersCursor {
        // Normalize JSON-missing collections so no later code path sees null.
        dayTotals = dayTotals == null ? Map.of() : Map.copyOf(dayTotals);
        dedupeIds = dedupeIds == null ? List.of() : List.copyOf(dedupeIds);
        edgeIds = edgeIds == null ? List.of() : List.copyOf(edgeIds);
    }

    /** Running total for one summary date; cumulative across pages. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    record DayTotal(int orders, long amount) {

        DayTotal plus(int moreOrders, long moreAmount) {
            return new DayTotal(orders + moreOrders, amount + moreAmount);
        }
    }

    /**
     * A minimal read-only window {@code [now - span, now]} for the connect-test
     * order-access probe. Reuses the authoritative wire format ({@link #iso}) so a
     * probe request can never fail as a malformed-parameter 400 — the format is the
     * same one the proven first-collection call uses. No cursor built here is ever
     * persisted; the probe reads a single page's status and discards it.
     */
    static NaverOrdersCursor probeWindow(Instant now, ZoneId zone, Duration span) {
        Instant from = now.minus(span);
        return new NaverOrdersCursor(
                iso(from, zone), iso(now, zone), null, null, Map.of(), List.of(), List.of(), null);
    }

    /**
     * Seed for an operator's bounded window over {@code [startDate, endDate]} (inclusive KST
     * calendar dates), starting at the range's first instant and walking no further than its
     * last. Capped at {@code now}: a range reaching into the future would otherwise ask NAVER
     * for a window it cannot answer.
     *
     * <p>Lives on its own cursor lane, so the routine stream's place is untouched — the point
     * of the whole thing. An operator reading the last two weeks must not become the routine
     * cursor's new idea of where it is.
     */
    static NaverOrdersCursor bounded(LocalDate startDate, LocalDate endDate, Instant now, ZoneId zone) {
        Instant from = startDate.atStartOfDay(zone).toInstant();
        Instant toExclusive = endDate.plusDays(1).atStartOfDay(zone).toInstant();
        if (toExclusive.isAfter(now)) {
            toExclusive = now;
        }
        return new NaverOrdersCursor(
                iso(from, zone), iso(windowEnd(from, toExclusive), zone), null, null,
                Map.of(), List.of(), List.of(), new Bounds(startDate.toString(), iso(toExclusive, zone)));
    }

    /**
     * The routine lane, restarted at a bounded recent horizon, discarding the backlog behind it.
     *
     * <p><b>Why a routine cursor is ever thrown away.</b> This cursor resumes where it left off, which
     * is right when "where it left off" is an hour ago and wrong when it is ten weeks ago. The demo
     * org's NAVER primary cursor sat at 2026-06-14 for 70 days while its schedule was paused; enabling
     * that schedule would have made the next routine run walk 69 consecutive 24h windows before it
     * reached today, and write a daily total for every date it passed. Both halves of that are the
     * wrong lane: routine exists to notice what is new, and historical recovery is an operator's
     * bounded backfill, approved as its own run. Cafe24's board lanes were corrected the same way
     * ({@code Cafe24ApiConnector#ROUTINE_WINDOW_DAYS}) — this is the same rule against NAVER's actual
     * cursor semantics, where windows are ≤24h and must stay contiguous.
     *
     * <p>The restart is aligned to the KST start of day so every date this cursor emits is one it
     * covered in full — a window opening mid-day would count only part of that date and overwrite a
     * complete stored total with it. The same start date becomes the emission floor, which is what
     * keeps the {@link #DAY_TOTAL_RETENTION_DAYS} carry from reaching back past it.
     *
     * <p>Not a gap-free guarantee, and it does not pretend to be: the skipped span is left for an
     * operator's backfill, and the caller says so out loud.
     */
    static NaverOrdersCursor routineRestart(Instant now, ZoneId zone, Duration maxLag) {
        LocalDate startDate = now.minus(maxLag).atZone(zone).toLocalDate();
        Instant from = startDate.atStartOfDay(zone).toInstant();
        return new NaverOrdersCursor(
                iso(from, zone), iso(windowEnd(from, now), zone), null, null,
                Map.of(), List.of(), List.of(), new Bounds(startDate.toString(), null));
    }

    /** First-ever cursor: one backfill window ending now. */
    static NaverOrdersCursor initial(Instant now, ZoneId zone) {
        Instant from = now.minus(INITIAL_BACKFILL);
        return new NaverOrdersCursor(
                iso(from, zone), iso(windowEnd(from, now), zone), null, null,
                Map.of(), List.of(), List.of(), null);
    }

    /**
     * Same window, continued via the response's {@code more} block.
     * {@code nextDedupeIds} is the skip set for the next page, computed by the
     * client: ids stamped exactly at the continuation's {@code moreFrom}
     * (re-deliverable because that instant becomes {@code lastChangedFrom}),
     * plus the previous skip set only when the continuation made no forward
     * time progress — once {@code moreFrom} moves past a boundary instant, ids
     * stamped at earlier boundaries can no longer be re-delivered, which keeps
     * the set bounded outside the degenerate all-same-instant case.
     */
    NaverOrdersCursor continued(String nextMoreFrom, String nextMoreSequence,
                                Map<String, DayTotal> mergedTotals,
                                List<String> newEdgeIds, List<String> nextDedupeIds) {
        return new NaverOrdersCursor(windowFrom, windowTo, nextMoreFrom, nextMoreSequence,
                mergedTotals, nextDedupeIds, union(edgeIds, newEdgeIds), bounds);
    }

    /**
     * Window exhausted: advance contiguously; this window's boundary-stamped ids
     * become the next window's skip set; prune stale day totals.
     */
    NaverOrdersCursor advanced(Instant now, ZoneId zone,
                               Map<String, DayTotal> mergedTotals, List<String> newEdgeIds) {
        Instant nextFrom = windowToInstant();
        Instant nextTo = windowEnd(nextFrom, limit(now));
        LocalDate pruneBefore = nextFrom.atZone(zone).toLocalDate().minusDays(DAY_TOTAL_RETENTION_DAYS);
        Map<String, DayTotal> pruned = new TreeMap<>(mergedTotals);
        pruned.keySet().removeIf(date -> LocalDate.parse(date).isBefore(pruneBefore));
        return new NaverOrdersCursor(iso(nextFrom, zone), iso(nextTo, zone), null, null,
                pruned, union(edgeIds, newEdgeIds), List.of(), bounds);
    }

    /**
     * Re-extend a settled (non-continuation) window's upper bound to {@code now},
     * capped at {@link #MAX_WINDOW}. After a window catches up, {@link #advanced}
     * leaves {@code windowTo == windowFrom} (the next-window start has reached the
     * collection instant). A later run must re-query {@code (windowFrom, now]}
     * rather than the zero-width range {@code [from == to]}, which Naver rejects
     * with HTTP 400. Callers apply this only when {@code windowFrom} is before
     * {@code now} (i.e. not yet caught up) and not mid-continuation, so the result
     * is always a non-empty window. A window already at the 24h cap is unchanged.
     */
    NaverOrdersCursor withWindowThrough(Instant now, ZoneId zone) {
        Instant from = windowFromInstant();
        return new NaverOrdersCursor(iso(from, zone), iso(windowEnd(from, limit(now)), zone),
                moreFrom, moreSequence, dayTotals, dedupeIds, edgeIds, bounds);
    }

    /** How far this cursor may read: "now", or the operator's end bound when it is nearer. */
    private Instant limit(Instant now) {
        if (bounds == null || bounds.toExclusive() == null) {
            return now; // routine: no end but "now".
        }
        Instant end = bounds.toInstant();
        return end.isBefore(now) ? end : now;
    }

    /**
     * Whether this cursor belongs to the <b>routine</b> lane — the one whose job is what is new.
     * An operator's bounded backfill is the only cursor that carries an end instant.
     */
    boolean isRoutine() {
        return bounds == null || bounds.toExclusive() == null;
    }

    /**
     * Whether the routine lane has fallen further behind than routine collection is allowed to be.
     *
     * <p>Only routine can answer yes: a backfill cursor is an operator's approved range and being
     * "behind now" is its normal condition, not a fault.
     */
    boolean routineLagExceeds(Instant now, Duration maxLag) {
        return isRoutine() && windowFromInstant().isBefore(now.minus(maxLag));
    }

    Instant windowFromInstant() {
        return OffsetDateTime.parse(windowFrom).toInstant();
    }

    Instant windowToInstant() {
        return OffsetDateTime.parse(windowTo).toInstant();
    }

    boolean isContinuation() {
        return moreSequence != null && !moreSequence.isBlank();
    }

    /** True when this cursor has caught up to {@code now} (nothing to query yet). */
    boolean isCaughtUp(Instant now) {
        return !isContinuation() && !windowFromInstant().isBefore(limit(now));
    }

    /** Dates before this are final — their items are skipped, never re-emitted. */
    LocalDate emissionHorizon(ZoneId zone) {
        LocalDate carried = windowFromInstant().atZone(zone).toLocalDate().minusDays(DAY_TOTAL_RETENTION_DAYS);
        if (bounds == null) {
            return carried;
        }
        // A cursor with a floor never writes a daily total for a date before it — an operator's
        // bounded run, or a routine lane restarted at a recent horizon.
        // The two-day carry is there so a routine window's partial recount converges; for a window
        // that starts cold at an operator's date it would instead emit the two preceding days
        // counting only the orders that changed inside the range — and ingestion overwrites by
        // (channel, date), so that lands as a complete-looking undercount.
        LocalDate floor = bounds.fromDate();
        return carried.isBefore(floor) ? floor : carried;
    }

    private static List<String> union(List<String> base, List<String> additions) {
        LinkedHashSet<String> merged = new LinkedHashSet<>(base);
        merged.addAll(additions);
        return new ArrayList<>(merged);
    }

    private static Instant windowEnd(Instant from, Instant now) {
        Instant cap = from.plus(MAX_WINDOW);
        return now.isBefore(cap) ? now : cap;
    }

    private static String iso(Instant instant, ZoneId zone) {
        // Fixed 3-digit-millisecond ISO offset format (see NAVER_DATETIME) — never
        // OffsetDateTime.toString(), whose variable precision Naver rejects (HTTP 400).
        return instant.atZone(zone).format(NAVER_DATETIME);
    }
}
