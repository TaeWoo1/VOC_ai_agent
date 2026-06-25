package com.sellerops.community;

import java.util.Locale;

/**
 * Reply state of a Cafe24 community article, normalized to a small closed set.
 *
 * <p>Cafe24's concrete reply tokens are <b>not yet verified</b> against a live
 * response; the connector will map them onto the canonical inputs below once the
 * article shape is confirmed (live-shape verification, a later PR). This normalizer
 * is the safety net: any unrecognized or blank value becomes {@link #UNKNOWN}, so
 * only these four values ever reach storage.
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
            case "PENDING", "WAITING", "UNANSWERED" -> PENDING;
            case "IN_PROGRESS", "PROGRESS", "PROCESSING" -> IN_PROGRESS;
            case "ANSWERED", "COMPLETE", "COMPLETED", "DONE" -> ANSWERED;
            default -> UNKNOWN;
        };
    }
}
