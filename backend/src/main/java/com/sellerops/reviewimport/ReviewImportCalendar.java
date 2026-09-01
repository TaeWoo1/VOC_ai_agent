package com.sellerops.reviewimport;

import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;

/**
 * <b>The business calendar guided review acquisition runs on: Asia/Seoul.</b>
 *
 * <p>Deliberately three lines and no configuration. This is not a timezone framework and must not become one:
 * it exists because the guided import's date boundary was computed in two different zones by two different
 * callers, and the seller only ever has one calendar.
 *
 * <p><b>Why it exists.</b> {@code ReviewImportLaunchService} already ran on {@code Clock.system(KST)} and
 * said why in its own docblock — "for a Korean seller a UTC 'today' is yesterday for nine hours every night"
 * — while {@code ReviewImportPlanController.extendPlan} passed {@code LocalDate.now(ZoneOffset.UTC)}. The two
 * disagreed for the nine hours between KST midnight and 09:00, and the disagreement is not cosmetic:
 * "extend this plan up to today" is what decides how many days a segment covers.
 *
 * <p><b>Observed live, 2026-09-01.</b> At 00:52 KST (15:52 UTC, still 09-01 there) a seller asked the
 * conversation for their NAVER reviews. The plan was minted for 2026-09-01 and extending it to "today" was a
 * no-op, so the segment they were handed was a single day — 09-01 to 09-01 — on a date whose reviews they
 * already had, while two weeks of uncollected reviews sat outside any reachable window. The seller could not
 * have widened it: the range chooser only appears when no open plan exists.
 *
 * <p>Scope is exactly the guided review-import date boundary. Nothing else in the system is asked to move
 * onto this calendar by this class, and storage stays in UTC instants as it always has — this converts an
 * instant to the calendar date the seller reads, and does no other work.
 */
final class ReviewImportCalendar {

    /** The seller's calendar. Korean marketplace, Korean seller, Korean dates. */
    static final ZoneId KST = ZoneId.of("Asia/Seoul");

    /** A clock on the seller's calendar, for callers that need to hand one to a service. */
    static Clock clock() {
        return Clock.system(KST);
    }

    /** The date the seller would call "today", from the system clock. */
    static LocalDate today() {
        return LocalDate.now(KST);
    }

    private ReviewImportCalendar() {
    }
}
