package com.sellerops.reviewissue;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/**
 * The date arithmetic behind every judgement, isolated so the boundaries are unit-testable.
 *
 * <p>All ranges are <b>inclusive on both ends and counted in whole days</b>, because
 * {@code reviews.received_at} is date-granular on the file import path
 * ({@code contracts/review-issue/v1/THRESHOLDS.md} §1). {@code reference} is the last day included,
 * and it is always supplied by the caller — nothing here reads a clock, so a judgement cannot change
 * meaning between a request and a scheduled report.
 *
 * <p>Off-by-one is the whole risk in this file: a 7-day window ending today starts 6 days ago, and a
 * baseline that must not overlap the window it is compared against has to skip the window's full
 * length. Both are stated once here rather than re-derived at each call site.
 */
public final class IssueWindows {

    private IssueWindows() {
    }

    /** A closed date interval. {@code fromInclusive} may equal {@code toInclusive} (a single day). */
    public record DateRange(LocalDate fromInclusive, LocalDate toInclusive) {

        public DateRange {
            if (fromInclusive == null || toInclusive == null) {
                throw new IllegalArgumentException("범위의 양 끝이 모두 필요합니다.");
            }
            if (fromInclusive.isAfter(toInclusive)) {
                throw new IllegalArgumentException("범위 시작이 끝보다 늦을 수 없습니다.");
            }
        }
    }

    /**
     * The most recent {@code days} days, ending on {@code reference}.
     * {@code trailing(ref, 7)} is {@code [ref-6, ref]} — seven days, not eight.
     */
    public static DateRange trailing(LocalDate reference, int days) {
        requirePositive(days, "days");
        return new DateRange(reference.minusDays(days - 1L), reference);
    }

    /**
     * A block of {@code days} days ending immediately before a trailing window of
     * {@code skipDays} days. Used for baselines that must not overlap the window they explain:
     * {@code precedingBlock(ref, 7, 56)} is the eight weeks ending the day before a 7-day window.
     */
    public static DateRange precedingBlock(LocalDate reference, int skipDays, int days) {
        requirePositive(skipDays, "skipDays");
        requirePositive(days, "days");
        LocalDate end = reference.minusDays(skipDays);
        return new DateRange(end.minusDays(days - 1L), end);
    }

    /**
     * The most recent {@code weeks} seven-day blocks, newest first. Week 0 is
     * {@code [ref-6, ref]}, week 1 is {@code [ref-13, ref-7]}, and so on.
     *
     * <p>These are rolling seven-day blocks anchored on the reference date, deliberately not
     * calendar weeks: a calendar week would make the persistence verdict depend on which weekday the
     * report happens to run, so the same data could read 계속 발생 on Monday and not on Sunday.
     */
    public static List<DateRange> trailingWeeks(LocalDate reference, int weeks) {
        requirePositive(weeks, "weeks");
        List<DateRange> out = new ArrayList<>(weeks);
        for (int week = 0; week < weeks; week++) {
            LocalDate end = reference.minusDays(7L * week);
            out.add(new DateRange(end.minusDays(6), end));
        }
        return List.copyOf(out);
    }

    /**
     * How many of the given weeks contain at least one of {@code dates}. Takes the dates rather than
     * querying per week so the persistence verdict costs one read instead of six.
     */
    public static int activeWeekCount(List<DateRange> weeks, List<LocalDate> dates) {
        int active = 0;
        for (DateRange week : weeks) {
            for (LocalDate date : dates) {
                if (!date.isBefore(week.fromInclusive()) && !date.isAfter(week.toInclusive())) {
                    active++;
                    break;
                }
            }
        }
        return active;
    }

    private static void requirePositive(int value, String field) {
        if (value <= 0) {
            throw new IllegalArgumentException(field + "는 1 이상이어야 합니다.");
        }
    }
}
