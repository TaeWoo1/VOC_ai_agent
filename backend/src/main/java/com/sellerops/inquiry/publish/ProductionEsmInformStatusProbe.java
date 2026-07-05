package com.sellerops.inquiry.publish;

import java.time.Instant;
import java.util.UUID;

/**
 * Production verification probe: re-queries the exact inquiry (seller-identity
 * cross-checked) and returns its current raw {@code informStatus}. A seller mismatch
 * throws (never verify against another tenant's inquiry); a not-found returns null
 * (not resolved yet). {@code answerDate} is never consulted.
 */
public class ProductionEsmInformStatusProbe implements EsmInformStatusProbe {

    private final EsmInquiryReQuery reQuery;

    public ProductionEsmInformStatusProbe(EsmInquiryReQuery reQuery) {
        this.reQuery = reQuery;
    }

    @Override
    public String currentInformStatus(UUID orgId, UUID sellerAccountId, String messageNo, Instant receivedAt) {
        EsmInquiryMatch.Outcome outcome = reQuery.findMatched(orgId, sellerAccountId, messageNo, receivedAt);
        return switch (outcome.result()) {
            case MATCH -> outcome.item().informStatus();
            case NOT_FOUND -> null;
            case SELLER_MISMATCH -> throw new IllegalStateException("검증 대상 판매자 식별자가 일치하지 않습니다.");
        };
    }
}
