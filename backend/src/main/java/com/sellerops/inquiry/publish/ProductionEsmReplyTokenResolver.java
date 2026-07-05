package com.sellerops.inquiry.publish;

import java.time.Instant;
import java.util.UUID;

/**
 * Production token resolver: re-queries the exact inquiry (by receivedAt/messageNo/
 * SellerAccount, seller-identity cross-checked) and returns the transient reply token
 * IN MEMORY. The caller uses it for one answer request and discards it — it is never
 * logged or persisted. A missing match or a seller mismatch throws (the dispatch
 * stays retryable / refuses to send).
 */
public class ProductionEsmReplyTokenResolver implements EsmReplyTokenResolver {

    private final EsmInquiryReQuery reQuery;

    public ProductionEsmReplyTokenResolver(EsmInquiryReQuery reQuery) {
        this.reQuery = reQuery;
    }

    @Override
    public String resolve(UUID orgId, UUID sellerAccountId, String messageNo, Instant receivedAt) {
        EsmInquiryMatch.Outcome outcome = reQuery.findMatched(orgId, sellerAccountId, messageNo, receivedAt);
        if (outcome.result() != EsmInquiryMatch.Result.MATCH) {
            throw new IllegalStateException("답변 토큰을 확인할 수 없습니다 (" + outcome.result() + ").");
        }
        String token = outcome.item().token();
        if (token == null || token.isBlank()) {
            throw new IllegalStateException("답변 토큰이 비어 있습니다.");
        }
        return token;
    }
}
