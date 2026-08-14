package com.sellerops.review.channel.dto;

import java.time.LocalDate;
import java.util.UUID;

/**
 * One channel review, read in full — and the target that finds it again on the seller's own screen.
 *
 * <p>{@code body} is the redacted full text ({@code VocPreviewSanitizer.redactFullBody}): line structure
 * kept, nothing truncated, volatile PII-shaped spans tokenized. {@code bodyRedacted} says whether anything
 * was replaced, so the operator knows they are reading a redaction rather than wondering.
 *
 * <p><b>{@code locateTarget} is why this view exists at all.</b> Coupang publishes no review id, so
 * `[쿠팡에서 보기]` cannot ask the screen for a row by number — it has to re-find the review by everything
 * that agrees: product, option, date, rating, and the body's {@code review-body-fingerprint/v1}. The
 * fingerprint travels instead of the text, and is computed from the STORED body so the target and the row
 * are compared on the same rule the collector applies in the page.
 *
 * <p>There is no reply field, no draft, and no submit affordance. Coupang gives sellers no way to answer a
 * 상품평, and a surface that offered one would be inventing a capability the channel does not have.
 */
public record ChannelReviewDetailView(
        UUID id,
        LocalDate writtenOn,
        Integer rating,
        boolean negative,
        String body,
        boolean bodyRedacted,
        String productName,
        int mediaCount,
        /** The buyer rated and wrote nothing — see {@code ChannelReviewItemView.textless}. */
        boolean textless,
        boolean isNew,
        LocateTarget locateTarget) {

    /** Exactly the fields the collector's locate compares on — nothing that names a person. */
    public record LocateTarget(
            String productId,
            String vendorItemId,
            LocalDate writtenOn,
            Integer rating,
            String bodyFingerprint) {
    }
}
