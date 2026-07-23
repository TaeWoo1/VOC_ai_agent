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
        Instant repliedAt) {

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
}
