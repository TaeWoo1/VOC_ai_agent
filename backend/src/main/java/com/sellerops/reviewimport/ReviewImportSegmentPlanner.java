package com.sellerops.reviewimport;

import com.sellerops.common.ApiException;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/**
 * Pure segmentation of a requested historical period into export windows. V1 default: one CALENDAR MONTH
 * per segment (decision, 2026-07-24) — NOT row-density-adaptive. Calendar months, not rolling 30-day
 * windows, so a seller reads "2026-03" rather than "Feb 14 – Mar 15" and adjacent months never overlap by
 * a day. The window is inclusive on both ends. Fails closed on a missing or inverted range, mirroring
 * {@code BackfillWindow}, so an unbounded sweep can never be planned by mistake.
 *
 * <p>No NAVER row/range cap is assumed anywhere here: the number of segments is a function of the calendar
 * span alone. Whether any single month is too large is discovered from the live export, and handled by the
 * operator splitting that month into shorter child ranges — never by a guessed limit.
 */
public final class ReviewImportSegmentPlanner {

    private ReviewImportSegmentPlanner() {
    }

    /** An inclusive [start, end] date window. */
    public record DateRange(LocalDate start, LocalDate end) {
        public DateRange {
            if (start == null || end == null) {
                throw ApiException.badRequest("가져올 기간의 시작일과 종료일을 모두 입력해 주세요.");
            }
            if (start.isAfter(end)) {
                throw ApiException.badRequest("시작일은 종료일보다 늦을 수 없습니다.");
            }
        }
    }

    /**
     * Divide [start, end] into calendar-month segments in chronological order. A partial first/last month
     * is clipped to the requested bound (e.g. a request of 2026-01-15 … 2026-03-10 yields 2026-01-15…01-31,
     * 2026-02-01…02-28, 2026-03-01…03-10). A single-day request yields one one-day segment.
     */
    public static List<DateRange> monthlySegments(LocalDate start, LocalDate end) {
        DateRange window = new DateRange(start, end); // validates
        List<DateRange> out = new ArrayList<>();
        LocalDate cursor = window.start();
        while (!cursor.isAfter(window.end())) {
            LocalDate monthEnd = cursor.withDayOfMonth(cursor.lengthOfMonth());
            LocalDate segEnd = monthEnd.isAfter(window.end()) ? window.end() : monthEnd;
            out.add(new DateRange(cursor, segEnd));
            cursor = segEnd.plusDays(1);
        }
        return out;
    }
}
