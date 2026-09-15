package com.sellerops.responsibility;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.temporal.ChronoUnit;

/**
 * The window semantics of CUSTOMER_OPERATIONS_V1, fixed (PD-2): <b>2-hour slots aligned to Asia/Seoul even
 * hours</b> — [00:00, 02:00), [02:00, 04:00), … KST.
 *
 * <p>A window is a pure function of an instant. Nothing about when a scheduler happened to tick, when a process
 * started, or how late a poll was can move it, which is what lets a restarted scheduler resume the same logical
 * window instead of inventing a new one. Asia/Seoul has no daylight saving, so every slot is exactly two hours.
 *
 * <p>A run for window W is due at W's start: the window names the stretch of time Reviewnary is responsible for,
 * and it starts working at the beginning of it.
 */
public final class ResponsibilityWindows {

    public static final ZoneId ZONE = ZoneId.of("Asia/Seoul");
    public static final Duration LENGTH = Duration.ofHours(2);

    private ResponsibilityWindows() {
    }

    /** Start of the window containing {@code instant}. */
    public static Instant slotStart(Instant instant) {
        ZonedDateTime hour = instant.atZone(ZONE).truncatedTo(ChronoUnit.HOURS);
        return hour.withHour(hour.getHour() - (hour.getHour() % 2)).toInstant();
    }

    /** End (exclusive) of the window that starts at {@code start}. */
    public static Instant slotEnd(Instant start) {
        return start.plus(LENGTH);
    }

    public static boolean isBoundary(Instant instant) {
        return slotStart(instant).equals(instant);
    }
}
