package com.sellerops.inquiry.publish;

import com.sellerops.connector.esm.inquiry.EsmInquiryItem;
import java.util.List;
import java.util.Set;

/**
 * Pure exact-match of a re-queried inquiry list to a target {@code messageNo} AND the
 * expected SellerAccount seller identity. A {@code messageNo} that resolves to a
 * different seller is a {@link Result#SELLER_MISMATCH} (never returned) — this is the
 * cross-tenant safety check before a token or a verification is ever read.
 */
public final class EsmInquiryMatch {

    public enum Result { MATCH, NOT_FOUND, SELLER_MISMATCH }

    public record Outcome(Result result, EsmInquiryItem item) {
        static Outcome notFound() {
            return new Outcome(Result.NOT_FOUND, null);
        }

        static Outcome sellerMismatch() {
            return new Outcome(Result.SELLER_MISMATCH, null);
        }

        static Outcome match(EsmInquiryItem item) {
            return new Outcome(Result.MATCH, item);
        }
    }

    private EsmInquiryMatch() {
    }

    public static Outcome selectExact(List<EsmInquiryItem> items, String messageNo,
                                      Set<String> expectedSellerIds) {
        if (items == null || messageNo == null || messageNo.isBlank()) {
            return Outcome.notFound();
        }
        EsmInquiryItem byMessage = null;
        for (EsmInquiryItem item : items) {
            if (item != null && messageNo.equals(item.messageNo())) {
                byMessage = item;
                break;
            }
        }
        if (byMessage == null) {
            return Outcome.notFound();
        }
        String sellerId = byMessage.sellerId();
        if (sellerId == null || sellerId.isBlank() || !expectedSellerIds.contains(sellerId)) {
            return Outcome.sellerMismatch();
        }
        return Outcome.match(byMessage);
    }
}
