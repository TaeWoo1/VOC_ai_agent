package com.sellerops.connector.cafe24;

import com.sellerops.ingest.canonical.CanonicalOrderSummary;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/**
 * Pure fold of Cafe24 order rows into per-day {@link CanonicalOrderSummary}.
 * This is the heart of the connector and the only place that interprets order
 * dates and amounts, so it is deliberately dependency-free and unit-tested in
 * isolation.
 *
 * <p><b>Bucketing:</b> each order is placed on the calendar date of its
 * {@code order_date} <em>in the supplied zone</em> (the connector passes the
 * explicit Cafe24 zone, {@code Asia/Seoul}). An offset-bearing timestamp is
 * converted to that zone first, so an order near midnight lands on the right KST
 * day regardless of the source offset.
 *
 * <p><b>Distinct orders:</b> {@code orderCount} and the {@code payment_amount}
 * sum are both keyed on distinct {@code order_id} per day — a repeated row for
 * the same order (should the API ever return item-level duplicates) is counted
 * once. A blank {@code order_id} cannot be de-duplicated and is counted each
 * time (never silently dropped).
 *
 * <p>A malformed {@code order_date} or a non-integer {@code payment_amount}
 * throws — the window is all-or-nothing at the connector boundary, and surfacing
 * the contract violation is preferable to silently miscounting a day.
 */
final class Cafe24OrderAggregator {

    private Cafe24OrderAggregator() {
    }

    static List<CanonicalOrderSummary> aggregate(List<Cafe24OrderRow> rows, ZoneId zone) {
        Map<LocalDate, DayAccumulator> byDay = new TreeMap<>();
        for (Cafe24OrderRow row : rows) {
            LocalDate day = toLocalDate(row.orderDate(), zone);
            DayAccumulator acc = byDay.computeIfAbsent(day, d -> new DayAccumulator());
            String id = row.orderId();
            boolean firstSighting = id == null || id.isBlank() || acc.orderIds.add(id);
            if (firstSighting) {
                acc.orderCount++;
                acc.salesAmount += parseAmount(row.paymentAmount());
            }
        }
        List<CanonicalOrderSummary> out = new ArrayList<>(byDay.size());
        int sourceRow = 1;
        for (Map.Entry<LocalDate, DayAccumulator> e : byDay.entrySet()) {
            DayAccumulator acc = e.getValue();
            out.add(new CanonicalOrderSummary(e.getKey(), acc.orderCount, acc.salesAmount, sourceRow++));
        }
        return out;
    }

    /**
     * Interpret an order_date string as a calendar date in {@code zone}. Accepts
     * (in order) an offset datetime, a zone-less datetime treated as already in
     * {@code zone}, or a bare date.
     */
    private static LocalDate toLocalDate(String orderDate, ZoneId zone) {
        if (orderDate == null || orderDate.isBlank()) {
            throw new IllegalStateException("카페24 주문 일자가 비어 있습니다.");
        }
        String value = orderDate.trim();
        try {
            return OffsetDateTime.parse(value).atZoneSameInstant(zone).toLocalDate();
        } catch (DateTimeParseException ignored) {
            // not an offset datetime — fall through
        }
        try {
            return LocalDateTime.parse(value).toLocalDate();
        } catch (DateTimeParseException ignored) {
            // not a zone-less datetime — fall through
        }
        try {
            return LocalDate.parse(value);
        } catch (DateTimeParseException e) {
            throw new IllegalStateException("카페24 주문 일자 형식을 해석할 수 없습니다.");
        }
    }

    /**
     * Parse a KRW {@code payment_amount} decimal string to a {@code long}. KRW
     * has no minor units, so a non-integer value ({@code longValueExact} throws)
     * is a contract violation, not a silent truncation.
     */
    private static long parseAmount(String paymentAmount) {
        if (paymentAmount == null || paymentAmount.isBlank()) {
            return 0L;
        }
        try {
            return new BigDecimal(paymentAmount.trim()).longValueExact();
        } catch (ArithmeticException | NumberFormatException e) {
            throw new IllegalStateException("카페24 결제 금액 형식을 해석할 수 없습니다.");
        }
    }

    private static final class DayAccumulator {
        private final Set<String> orderIds = new HashSet<>();
        private int orderCount;
        private long salesAmount;
    }
}
