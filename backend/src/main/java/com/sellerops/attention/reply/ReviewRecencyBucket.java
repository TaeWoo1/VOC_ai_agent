package com.sellerops.attention.reply;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;

/**
 * Coarse recency bucket for a review, derived from a <b>KST date-only</b> value — never a raw timestamp and
 * never the internal {@code eventTimeMs}. It is the {@code recencyBucket} field of the review target hint
 * (the collector's {@code RecencyBucket} type uses the same three labels).
 *
 * <p>Derivation is bound to an <b>explicit as-of KST date</b> ({@link #asOfKstDate(Instant)}), computed once
 * from an injected {@link java.time.Clock} at mint time and recorded on the hint, so the bucket's meaning is
 * fixed and auditable rather than relative to an implicit wall-clock. Boundaries (product-owner-tunable):
 *
 * <ul>
 *   <li>{@link #TODAY} — same KST calendar date as the as-of date (a future date clamps here);</li>
 *   <li>{@link #THIS_WEEK} — 1–6 KST days before the as-of date;</li>
 *   <li>{@link #OLDER} — 7 or more KST days before (or an unknown/absent review date).</li>
 * </ul>
 */
public enum ReviewRecencyBucket {
    TODAY,
    THIS_WEEK,
    OLDER;

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    /** The KST calendar date {@code now} falls on — the explicit "as of" date the bucket is computed against. */
    public static LocalDate asOfKstDate(Instant now) {
        return now.atZone(KST).toLocalDate();
    }

    /** Bucket a review's {@code receivedAt} against an explicit KST as-of date. Null-safe (→ {@link #OLDER}). */
    public static ReviewRecencyBucket of(Instant receivedAt, LocalDate asOfKstDate) {
        if (receivedAt == null || asOfKstDate == null) {
            return OLDER;
        }
        LocalDate reviewDate = receivedAt.atZone(KST).toLocalDate();
        long daysBefore = ChronoUnit.DAYS.between(reviewDate, asOfKstDate);
        if (daysBefore <= 0) {
            return TODAY;
        }
        if (daysBefore <= 6) {
            return THIS_WEEK;
        }
        return OLDER;
    }
}
