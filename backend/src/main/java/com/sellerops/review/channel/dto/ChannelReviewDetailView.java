package com.sellerops.review.channel.dto;

import com.sellerops.review.triage.ReviewTriageNote;
import java.time.LocalDate;
import java.util.UUID;

/**
 * One channel review, read in full — and the target that finds it again on the seller's own screen.
 *
 * <p>{@code body} is the redacted full text ({@code VocPreviewSanitizer.redactFullBody}): line structure
 * kept, nothing truncated, volatile PII-shaped spans tokenized. {@code bodyRedacted} says whether anything
 * was replaced, so the operator knows they are reading a redaction rather than wondering.
 *
 * <p><b>{@code locateTarget} is what the seller is shown about how the review is identified</b> — the
 * 노출상품ID and 옵션ID the 상세 panel prints, beside the date and rating it already shows.
 *
 * <p>It is deliberately NOT the target a locate run matches on. Coupang publishes no review id, so
 * `[쿠팡에서 보기]` re-finds the review by product, option, date, rating and the body's
 * {@code review-body-fingerprint/v1} — and that fingerprint reaches the Local Agent by resolving an opaque
 * {@code locateRef} against {@link com.sellerops.review.channel.ChannelReviewLocateService}, never through
 * the browser. It used to ride here as well; nothing in the frontend read it, and a fingerprint of a
 * buyer's review sitting in a page nobody uses it in is a copy that exists for no reason.
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
        /** The same suggestion the list row carries, so opening a review cannot change what it said. */
        ReviewTriageNote triage,
        /** The same pilot mark the list row carried, or null — see {@link ChannelReviewItemView#aiMark()}. */
        AiTriageMarkView aiMark,
        LocateTarget locateTarget) {

    /** The channel-side identifiers this review carries — nothing that names a person. */
    public record LocateTarget(
            String productId,
            String vendorItemId,
            LocalDate writtenOn,
            Integer rating) {
    }
}
