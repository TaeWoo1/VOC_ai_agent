package com.sellerops.connector.esm.inquiry;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/**
 * A closed {@code [startInclusive, endInclusive]} date range plus a pure helper
 * that splits an arbitrary range into contiguous, non-overlapping chunks no wider
 * than {@code maxDays} calendar days.
 *
 * <p>The ESM+ official INQUIRY (판매자 문의) API query is doc-noted to accept a
 * bounded look-back window (the public API doc describes a 7-day query window;
 * the seller-center UI exposes a wider 3-month/1-year selector — see the Gate 1
 * readiness packet). Backfilling a longer span therefore requires walking it in
 * {@link #SEVEN_DAY_MAX} chunks. This helper is the deterministic windowing math
 * only — it makes <b>no</b> network call and reads <b>no</b> clock (callers pass
 * an explicit range), so it stays compliant with the recency rules (no {@code
 * Date.now}/{@code new Date}, no KST assumption).
 */
public record EsmInquiryDateWindow(LocalDate startInclusive, LocalDate endInclusive) {

    /** Documented official INQUIRY query window width (calendar days). */
    public static final int SEVEN_DAY_MAX = 7;

    public EsmInquiryDateWindow {
        if (startInclusive == null || endInclusive == null) {
            throw new IllegalArgumentException("window bounds must not be null");
        }
        if (startInclusive.isAfter(endInclusive)) {
            throw new IllegalArgumentException("startInclusive must not be after endInclusive");
        }
    }

    /** Inclusive day count of this window (a single-day window is 1). */
    public long dayCount() {
        return endInclusive.toEpochDay() - startInclusive.toEpochDay() + 1;
    }

    /**
     * Split {@code [start, end]} into contiguous inclusive windows each spanning at
     * most {@code maxDays} calendar days, in chronological order. The final window
     * may be shorter. Throws if {@code maxDays < 1} or {@code start} is after
     * {@code end}.
     */
    public static List<EsmInquiryDateWindow> chunk(LocalDate start, LocalDate end, int maxDays) {
        if (maxDays < 1) {
            throw new IllegalArgumentException("maxDays must be >= 1");
        }
        if (start == null || end == null) {
            throw new IllegalArgumentException("range bounds must not be null");
        }
        if (start.isAfter(end)) {
            throw new IllegalArgumentException("start must not be after end");
        }
        List<EsmInquiryDateWindow> windows = new ArrayList<>();
        LocalDate windowStart = start;
        while (!windowStart.isAfter(end)) {
            // maxDays inclusive days => last day is start + (maxDays - 1).
            LocalDate windowEnd = windowStart.plusDays(maxDays - 1L);
            if (windowEnd.isAfter(end)) {
                windowEnd = end;
            }
            windows.add(new EsmInquiryDateWindow(windowStart, windowEnd));
            windowStart = windowEnd.plusDays(1);
        }
        return windows;
    }

    /** Convenience: chunk into {@link #SEVEN_DAY_MAX}-day windows. */
    public static List<EsmInquiryDateWindow> chunkWeekly(LocalDate start, LocalDate end) {
        return chunk(start, end, SEVEN_DAY_MAX);
    }
}
