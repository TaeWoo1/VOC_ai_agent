package com.sellerops.ingest.canonical;

import com.sellerops.review.ReviewReplyState;
import java.time.Instant;

/** Source-agnostic review record produced by any connector before persistence.
 *  {@code sourceRow} is the 1-based originating file row (for error reporting).
 *
 *  <p>{@code replyState}/{@code repliedAt} carry what the CHANNEL said about an existing reply
 *  (NAVER's {@code 답글여부} / {@code 답글등록일시}) — never SellerOps' own record of a guided
 *  reply. A source that says nothing leaves them {@code UNKNOWN}/{@code null}, which the attention
 *  surface still treats as needing a look. */
public record CanonicalReview(
        String productName,
        String sku,
        Integer rating,
        String body,
        Instant receivedAt,
        String externalId,
        int sourceRow,
        ReviewReplyState replyState,
        Instant repliedAt,
        String sourceOptionId,
        int mediaCount,
        /**
         * Whether {@link #mediaCount} is a READING rather than a default (Media Semantics Closeout v1).
         *
         * <p>False means UNKNOWN: this source was not asked about media, or the reader that ran could
         * not have seen it. It is carried rather than derived from {@code mediaCount > 0} because that
         * derivation is the defect being closed — «0» and «nobody counted» are different claims and a
         * count alone cannot separate them. Only a source that actually looked may pass true.
         */
        boolean mediaObserved,
        /**
         * The buyer rated and wrote nothing. {@code body} is then blank — never a channel's placeholder
         * sentence, which is UI text and not a customer's words. It is carried rather than derived from a
         * blank body because the two are different claims: a blank body could be a reader defect, while this
         * is the source saying it saw a rating with no text. {@link com.sellerops.ingest.ReviewDedupKey}
         * keys these rows on the purchased option.
         */
        boolean textless,
        /**
         * «이 행의 상품은 채널이 준 식별자로만 정한다» — the declaration, exactly as
         * {@link CanonicalInquiry#productRef()} means it, now available to reviews.
         *
         * <p><b>Its presence IS the rule.</b> Non-null and ingest attributes by this identifier against
         * {@code channel_products}, or not at all: no name fallback, no {@code (미지정 상품)} bucket, no
         * product created from a value the channel published. Null keeps the legacy name/SKU
         * resolve-or-create every file-upload source has always used, byte for byte.
         *
         * <p>It exists because the Coupang WING 상품평 screen prints a 노출상품ID for a catalogue this
         * org may not hold at all — a seller who connected only the browser has zero products — and the
         * honest record of such a review is «stored, and not yet linked», not «dropped».
         */
        ChannelProductRef productRef) {

    /**
     * A source that carries no reply statement. Kept so every connector and test that predates
     * reply-state preservation constructs an honest UNKNOWN rather than being edited to repeat
     * the same two arguments — the absence of a statement is the default, not a special case.
     */
    public CanonicalReview(String productName, String sku, Integer rating, String body,
                           Instant receivedAt, String externalId, int sourceRow) {
        this(productName, sku, rating, body, receivedAt, externalId, sourceRow,
                ReviewReplyState.UNKNOWN, null);
    }

    /**
     * A source that reports a reply state but no purchased option and no review media — every source
     * that predates Coupang WING acquisition. Same reasoning as the overload above: the absence is the
     * default, so it is written once here rather than as two more literals at each call site.
     */
    public CanonicalReview(String productName, String sku, Integer rating, String body,
                           Instant receivedAt, String externalId, int sourceRow,
                           ReviewReplyState replyState, Instant repliedAt) {
        this(productName, sku, rating, body, receivedAt, externalId, sourceRow, replyState, repliedAt,
                null, 0, false, false);
    }

    /** A source that reports an option and a COUNTED media figure but no textless distinction. */
    public CanonicalReview(String productName, String sku, Integer rating, String body,
                           Instant receivedAt, String externalId, int sourceRow,
                           ReviewReplyState replyState, Instant repliedAt,
                           String sourceOptionId, int mediaCount) {
        this(productName, sku, rating, body, receivedAt, externalId, sourceRow, replyState, repliedAt,
                sourceOptionId, mediaCount, true, false);
    }

    /**
     * A source that does not declare identifier attribution — every source that predates V105. Same
     * reasoning as the overloads above: the absence of a declaration is the default, so it is written
     * once here rather than as a {@code null} at each call site.
     */
    public CanonicalReview(String productName, String sku, Integer rating, String body,
                           Instant receivedAt, String externalId, int sourceRow,
                           ReviewReplyState replyState, Instant repliedAt,
                           String sourceOptionId, int mediaCount, boolean mediaObserved,
                           boolean textless) {
        this(productName, sku, rating, body, receivedAt, externalId, sourceRow, replyState, repliedAt,
                sourceOptionId, mediaCount, mediaObserved, textless, null);
    }
}
