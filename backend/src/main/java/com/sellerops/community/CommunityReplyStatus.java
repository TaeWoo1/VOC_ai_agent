package com.sellerops.community;

import java.util.Locale;

/**
 * Reply state of a Cafe24 community article, normalized to a small closed set.
 *
 * <p>Cafe24's official {@code reply_status} tokens are single letters: {@code N}
 * (답변전 / no reply → {@link #PENDING}), {@code P} (처리중 / in progress →
 * {@link #IN_PROGRESS}), {@code C} (처리완료 / completed → {@link #ANSWERED}), per the
 * official contract (developers.cafe24.com). The mapping is deliberately fail-closed:
 * any unrecognized or blank value stays {@link #UNKNOWN} and is never guessed as
 * answered, so only these four canonical values ever reach storage.
 *
 * <p>This enum states the token→status <b>contract</b>, not an observation history:
 * which raw tokens have actually been seen on any given live run is recorded in the
 * sanitized live-proof evidence docs (per board and per run), never asserted here — a
 * code comment about "what has been observed live" goes stale the moment the next run
 * sees a new token.
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
            // P=처리중, C=처리완료. Unrecognized/blank → UNKNOWN (fail-closed, never guessed).
            case "N", "PENDING", "WAITING", "UNANSWERED" -> PENDING;
            case "P", "IN_PROGRESS", "PROGRESS", "PROCESSING" -> IN_PROGRESS;
            case "C", "ANSWERED", "COMPLETE", "COMPLETED", "DONE" -> ANSWERED;
            default -> UNKNOWN;
        };
    }
}
