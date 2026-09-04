package com.sellerops.report;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.ZoneId;

/**
 * One COMPLETED calendar period and the equally long period before it.
 *
 * <p>Completed on purpose. A report about "this week so far" changes every morning, and a snapshot of
 * it would be stale by lunch — the property Agentic Report v1 exists to avoid. The latest weekly
 * report is the last Monday–Sunday that has ended; the latest monthly report is the previous calendar
 * month. The calendar is Asia/Seoul, the same one the Overview series bucket by, so the seller's
 * Monday is a Monday.
 *
 * <p>{@code previous*} is what every 「이전 기간보다」 compares against: the same length, immediately
 * before. It is part of the period rather than computed by each reader so two sections cannot compare
 * against two different baselines.
 */
public record ReportPeriod(ReportKind kind, LocalDate start, LocalDate end,
                           LocalDate previousStart, LocalDate previousEnd) {

    public static final ZoneId CALENDAR = ZoneId.of("Asia/Seoul");

    public static ReportPeriod latestCompleted(ReportKind kind, LocalDate today) {
        return switch (kind) {
            case WEEKLY -> {
                LocalDate thisMonday = today.with(DayOfWeek.MONDAY);
                yield startingAt(kind, thisMonday.minusWeeks(1));
            }
            case MONTHLY -> startingAt(kind, today.withDayOfMonth(1).minusMonths(1));
        };
    }

    /**
     * The period that begins on {@code start}. A weekly start must be a Monday and a monthly start the
     * first of a month — a report over an unaligned window would not be the same report as the one the
     * seller opened last time.
     */
    public static ReportPeriod startingAt(ReportKind kind, LocalDate start) {
        return switch (kind) {
            case WEEKLY -> {
                if (start.getDayOfWeek() != DayOfWeek.MONDAY) {
                    throw com.sellerops.common.ApiException.badRequest("주간 리포트는 월요일에 시작해야 합니다.");
                }
                yield new ReportPeriod(kind, start, start.plusDays(6), start.minusWeeks(1), start.minusDays(1));
            }
            case MONTHLY -> {
                if (start.getDayOfMonth() != 1) {
                    throw com.sellerops.common.ApiException.badRequest("월간 리포트는 1일에 시작해야 합니다.");
                }
                yield new ReportPeriod(kind, start, start.plusMonths(1).minusDays(1),
                        start.minusMonths(1), start.minusDays(1));
            }
        };
    }

    /** The period is over only once the day after its end has begun. */
    public boolean completedBy(LocalDate today) {
        return today.isAfter(end);
    }

    /** 「2026년 8월 24일 ~ 8월 30일」 · 「2026년 8월」 — what the seller reads at the top. */
    public String labelKo() {
        return switch (kind) {
            case WEEKLY -> String.format("%d년 %d월 %d일 ~ %s%d일", start.getYear(), start.getMonthValue(),
                    start.getDayOfMonth(),
                    end.getMonthValue() == start.getMonthValue() ? "" : end.getMonthValue() + "월 ",
                    end.getDayOfMonth());
            case MONTHLY -> String.format("%d년 %d월", start.getYear(), start.getMonthValue());
        };
    }
}
