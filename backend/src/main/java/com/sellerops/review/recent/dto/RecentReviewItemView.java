package com.sellerops.review.recent.dto;

import java.time.LocalDate;
import java.util.UUID;

/**
 * One review inside the requested window, as the Agent's REVIEW_OPS specialist reads it.
 *
 * <p>{@code preview} is the redacted one-liner from {@code VocPreviewSanitizer}, or null for a
 * rating-only review — the same text the channel review record shows, so the conversation and the
 * screen never disagree about what a buyer wrote. {@code sellerAccountId} is carried so a stale
 * channel can be pointed at its own import path; nothing here is a credential or a raw body.
 */
public record RecentReviewItemView(
        UUID id,
        UUID sellerAccountId,
        String channelCode,
        String channelNameKo,
        LocalDate writtenOn,
        Integer rating,
        boolean negative,
        String preview,
        UUID productId,
        String productName,
        String replyState,
        /**
         * {@code MARKETPLACE} | {@code NONE} — whether this review is an object reviewnary could act on at
         * its channel, from acquisition provenance only ({@code ExecutableIdentityResolver}). An arbitrary
         * upload with a channel label is {@code NONE}; a guided export or WING read bound to an API-mode
         * account, or a Cafe24 board article, is {@code MARKETPLACE}.
         */
        String executableIdentity) {
}
