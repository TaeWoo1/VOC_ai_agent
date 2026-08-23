package com.sellerops.connector.naver;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;

/**
 * The opaque {@code cursorValue} of the NAVER INQUIRY stream — <b>two sources, one slot</b>.
 *
 * <p>The runtime gives a connector exactly one cursor per (seller account × data type), and NAVER
 * publishes two inquiry resources with different contracts: 상품 문의 pages a date-TIME range
 * ({@code fromDate}/{@code toDate}, 최대 100/page) and 고객 문의 pages a date range
 * ({@code startSearchDate}/{@code endSearchDate}, yyyy-MM-dd, 10~200/page). So this cursor carries a
 * lane per source plus which one is being served, and a run sweeps one lane to its end before
 * starting the other. Neither lane's position is ever written by the other's progress — that is the
 * whole reason they are separate fields rather than one shared page number.
 *
 * <p><b>Routine and bounded are different lanes, and the flag says which.</b> A {@code bounded}
 * cursor is an operator's approved window: it is never recomputed and never walks past its end. A
 * routine cursor recomputes its windows when both lanes finish, which is what makes the routine lane
 * mean "what is new" instead of "where I stopped" (the defect corrected on NAVER ORDER and both
 * Cafe24 boards — {@link NaverOrdersCursor#routineRestart}).
 *
 * <p><b>The overlap is the shared boundary, not an invented margin.</b> NAVER's own guidance for
 * 상품 문의 is to overlap the previous {@code toDate} into the next {@code fromDate}
 * ({@code docs/vendor/naver-commerce-api/get-v1-contents-qnas.md}). Here that is realized exactly:
 * the next window opens at the previous window's end instant (and, for the date-granular customer
 * resource, on the previous window's end DATE). Re-delivery at the boundary is idempotent because
 * both resources carry stable identifiers ({@code questionId} / {@code inquiryNo}) and ingest
 * upserts on them. No margin constant is introduced, because none is published.
 *
 * <p><b>The lag ceiling is this repository's existing one.</b> {@link NaverOrdersClient#ROUTINE_MAX_LAG}
 * (14 days) is already what SellerOps means by "recent operational acquisition" on this channel; a
 * routine window never opens further back than that, and a cursor that has fallen further behind
 * restarts there rather than walking the backlog. The skipped span is named out loud and left to an
 * operator's bounded backfill — it is not silently dropped, and it is not silently swept.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record NaverInquiryCursor(Lane qna, Lane customer, String active, boolean bounded) {

    /** 상품 문의 — a date-time window. */
    public static final String SOURCE_PRODUCT_QNA = "PRODUCT_QNA";

    /** 고객 문의 — a date window. */
    public static final String SOURCE_CUSTOMER = "CUSTOMER_INQUIRY";

    static final ZoneId KST = ZoneId.of("Asia/Seoul");

    /** NAVER's 상품 문의 resource takes ISO 8601 date-time; the offset form is what it is documented with. */
    private static final DateTimeFormatter QNA_DATETIME =
            DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSSXXX");

    /**
     * One source's position: the window it is reading and how far into it.
     *
     * <p>{@code done} is set from the RESOURCE's own end-of-list statement ({@code last} /
     * {@code totalPages}), never from a page-size heuristic — the documented termination condition is
     * the one the vendor asks callers to use, and guessing one is how a sweep loops forever.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Lane(String from, String to, int page, boolean done) {

        static Lane starting(String from, String to) {
            return new Lane(from, to, 1, false);
        }

        Lane nextPage() {
            return new Lane(from, to, page + 1, false);
        }

        Lane finished() {
            return new Lane(from, to, page, true);
        }

        @JsonIgnore
        boolean isReady() {
            return from != null && to != null && page >= 1;
        }
    }

    /**
     * The cursor a routine run should use: resume mid-sweep, or open fresh windows when the previous
     * pass finished (or when there is no usable previous position at all).
     *
     * <p>A bounded cursor is returned untouched — "behind now" is what an operator's window is FOR.
     */
    static NaverInquiryCursor routine(NaverInquiryCursor stored, Instant now, boolean qnaEnabled,
                                      boolean customerEnabled) {
        if (stored != null && stored.bounded()) {
            return stored;
        }
        if (stored != null && stored.usable() && !stored.bothDone(qnaEnabled, customerEnabled)) {
            return stored.withActiveOnEnabled(qnaEnabled, customerEnabled);
        }
        Instant floor = now.minus(NaverOrdersClient.ROUTINE_MAX_LAG);
        Instant qnaFrom = resumeFrom(stored == null ? null : stored.qna(), floor, now);
        LocalDate customerFrom = resumeDate(stored == null ? null : stored.customer(), floor, now);
        return new NaverInquiryCursor(
                Lane.starting(qnaInstant(qnaFrom), qnaInstant(now)),
                Lane.starting(customerFrom.toString(), now.atZone(KST).toLocalDate().toString()),
                qnaEnabled ? SOURCE_PRODUCT_QNA : SOURCE_CUSTOMER,
                false);
    }

    /** An operator's bounded window over both sources. Dates are the platform's own (KST). */
    static NaverInquiryCursor bounded(LocalDate startDate, LocalDate endDate, boolean qnaEnabled) {
        Instant from = startDate.atStartOfDay(KST).toInstant();
        Instant to = endDate.plusDays(1).atStartOfDay(KST).toInstant();
        return new NaverInquiryCursor(
                Lane.starting(qnaInstant(from), qnaInstant(to)),
                Lane.starting(startDate.toString(), endDate.toString()),
                qnaEnabled ? SOURCE_PRODUCT_QNA : SOURCE_CUSTOMER,
                true);
    }

    /** The previous window's END is the next window's START — the documented overlap, clamped to the floor. */
    private static Instant resumeFrom(Lane previous, Instant floor, Instant now) {
        if (previous == null || previous.to() == null) {
            return floor;
        }
        try {
            Instant previousEnd = OffsetDateTime.parse(previous.to(), QNA_DATETIME).toInstant();
            if (previousEnd.isBefore(floor) || previousEnd.isAfter(now)) {
                return floor;
            }
            return previousEnd;
        } catch (DateTimeParseException e) {
            return floor;
        }
    }

    private static LocalDate resumeDate(Lane previous, Instant floor, Instant now) {
        LocalDate floorDate = floor.atZone(KST).toLocalDate();
        if (previous == null || previous.to() == null) {
            return floorDate;
        }
        try {
            LocalDate previousEnd = LocalDate.parse(previous.to());
            if (previousEnd.isBefore(floorDate) || previousEnd.isAfter(now.atZone(KST).toLocalDate())) {
                return floorDate;
            }
            return previousEnd;
        } catch (DateTimeParseException e) {
            return floorDate;
        }
    }

    static String qnaInstant(Instant instant) {
        return instant.atZone(KST).toOffsetDateTime().format(QNA_DATETIME);
    }

    /** How far behind the routine lane has fallen, for the restart warning. Null when it has not. */
    static Duration routineLag(NaverInquiryCursor stored, Instant now) {
        if (stored == null || stored.bounded() || stored.qna() == null || stored.qna().to() == null) {
            return null;
        }
        try {
            Instant previousEnd = OffsetDateTime.parse(stored.qna().to(), QNA_DATETIME).toInstant();
            Duration lag = Duration.between(previousEnd, now);
            return lag.compareTo(NaverOrdersClient.ROUTINE_MAX_LAG) > 0 ? lag : null;
        } catch (DateTimeParseException e) {
            return null;
        }
    }

    @JsonIgnore
    boolean usable() {
        return qna != null && qna.isReady() && customer != null && customer.isReady();
    }

    /** True when every ENABLED source has finished its sweep. A disabled source is not waited on. */
    @JsonIgnore
    boolean bothDone(boolean qnaEnabled, boolean customerEnabled) {
        boolean qnaOutstanding = qnaEnabled && qna != null && !qna.done();
        boolean customerOutstanding = customerEnabled && customer != null && !customer.done();
        return !qnaOutstanding && !customerOutstanding;
    }

    /** The source this fetch should serve, skipping a source whose client is not wired. */
    @JsonIgnore
    String activeSource(boolean qnaEnabled, boolean customerEnabled) {
        boolean qnaOutstanding = qnaEnabled && qna != null && !qna.done();
        boolean customerOutstanding = customerEnabled && customer != null && !customer.done();
        if (SOURCE_PRODUCT_QNA.equals(active) && qnaOutstanding) {
            return SOURCE_PRODUCT_QNA;
        }
        if (SOURCE_CUSTOMER.equals(active) && customerOutstanding) {
            return SOURCE_CUSTOMER;
        }
        if (qnaOutstanding) {
            return SOURCE_PRODUCT_QNA;
        }
        return customerOutstanding ? SOURCE_CUSTOMER : null;
    }

    private NaverInquiryCursor withActiveOnEnabled(boolean qnaEnabled, boolean customerEnabled) {
        String next = activeSource(qnaEnabled, customerEnabled);
        return next == null || next.equals(active)
                ? this
                : new NaverInquiryCursor(qna, customer, next, bounded);
    }

    NaverInquiryCursor withQna(Lane lane) {
        return new NaverInquiryCursor(lane, customer, active, bounded);
    }

    NaverInquiryCursor withCustomer(Lane lane) {
        return new NaverInquiryCursor(qna, lane, active, bounded);
    }
}
