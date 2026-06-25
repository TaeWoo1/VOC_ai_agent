package com.sellerops.community;

import java.util.Locale;

/**
 * Reply state of a Cafe24 community article, normalized to a small closed set.
 *
 * <p>The Cafe24 {@code reply_status} field was confirmed against a live response on
 * the target mall (board article shape verification): an enum-like token <b>{@code N}</b>
 * (no reply / 미답변) was observed, mapped here to {@link #PENDING}. The <i>answered</i>
 * token has <b>not</b> been observed yet (the sampled rows were unanswered), so it is
 * deliberately <b>not guessed</b> — any unrecognized or blank value stays
 * {@link #UNKNOWN}, so only these four values ever reach storage.
 */
public enum CommunityReplyStatus {
    PENDING,
    IN_PROGRESS,
    ANSWERED,
    UNKNOWN;

    /** Map a raw reply token to a canonical value; unknown/blank → {@code UNKNOWN}. */
    public static CommunityReplyStatus normalize(String raw) {
        if (raw == null || raw.isBlank()) {
            return UNKNOWN;
        }
        return switch (raw.strip().toUpperCase(Locale.ROOT)) {
            // "N" = Cafe24's no-reply/미답변 token, confirmed by live shape verification.
            case "N", "PENDING", "WAITING", "UNANSWERED" -> PENDING;
            case "IN_PROGRESS", "PROGRESS", "PROCESSING" -> IN_PROGRESS;
            case "ANSWERED", "COMPLETE", "COMPLETED", "DONE" -> ANSWERED;
            default -> UNKNOWN;
        };
    }
}
