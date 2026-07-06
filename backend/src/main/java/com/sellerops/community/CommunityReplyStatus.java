package com.sellerops.community;

import java.util.Locale;

/**
 * Reply state of a Cafe24 community article, normalized to a small closed set.
 *
 * <p>Cafe24's official {@code reply_status} tokens are single letters: {@code N}
 * (답변전 / no reply → {@link #PENDING}), {@code P} (처리중 / in progress →
 * {@link #IN_PROGRESS}), {@code C} (처리완료 / completed → {@link #ANSWERED}). {@code N}
 * and {@code C} are live-confirmed (article 283 returned raw {@code C}); {@code P}
 * follows the same official vocabulary. Any unrecognized or blank value stays
 * {@link #UNKNOWN} (never guessed as answered), so only these four canonical values
 * ever reach storage.
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
            // Cafe24's official reply_status tokens (developers.cafe24.com): N=답변전,
            // P=처리중, C=처리완료 — confirmed live (article 283 returned raw 'C').
            case "N", "PENDING", "WAITING", "UNANSWERED" -> PENDING;
            case "P", "IN_PROGRESS", "PROGRESS", "PROCESSING" -> IN_PROGRESS;
            case "C", "ANSWERED", "COMPLETE", "COMPLETED", "DONE" -> ANSWERED;
            default -> UNKNOWN;
        };
    }
}
