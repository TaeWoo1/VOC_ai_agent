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
 */
@JsonIgnoreProperties(ignoreUnknown = true)
record NaverOrdersCursor(
        String windowFrom,
        String windowTo,
        String moreFrom,
        String moreSequence,
        Map<String, DayTotal> dayTotals,
        List<String> dedupeIds,
        List<String> edgeIds) {

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

    /** First-ever cursor: one backfill window ending now. */
    static NaverOrdersCursor initial(Instant now, ZoneId zone) {
        Instant from = now.minus(INITIAL_BACKFILL);
        return new NaverOrdersCursor(
                iso(from, zone), iso(windowEnd(from, now), zone), null, null,
                Map.of(), List.of(), List.of());
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
                mergedTotals, nextDedupeIds, union(edgeIds, newEdgeIds));
    }

    /**
     * Window exhausted: advance contiguously; this window's boundary-stamped ids
     * become the next window's skip set; prune stale day totals.
     */
    NaverOrdersCursor advanced(Instant now, ZoneId zone,
                               Map<String, DayTotal> mergedTotals, List<String> newEdgeIds) {
        Instant nextFrom = windowToInstant();
        Instant nextTo = windowEnd(nextFrom, now);
        LocalDate pruneBefore = nextFrom.atZone(zone).toLocalDate().minusDays(DAY_TOTAL_RETENTION_DAYS);
        Map<String, DayTotal> pruned = new TreeMap<>(mergedTotals);
        pruned.keySet().removeIf(date -> LocalDate.parse(date).isBefore(pruneBefore));
        return new NaverOrdersCursor(iso(nextFrom, zone), iso(nextTo, zone), null, null,
                pruned, union(edgeIds, newEdgeIds), List.of());
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
        return new NaverOrdersCursor(iso(from, zone), iso(windowEnd(from, now), zone),
                moreFrom, moreSequence, dayTotals, dedupeIds, edgeIds);
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
        return !isContinuation() && !windowFromInstant().isBefore(now);
    }

    /** Dates before this are final — their items are skipped, never re-emitted. */
    LocalDate emissionHorizon(ZoneId zone) {
        return windowFromInstant().atZone(zone).toLocalDate().minusDays(DAY_TOTAL_RETENTION_DAYS);
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
