package com.sellerops.product;

import java.util.Locale;

/**
 * The minimal normalization of a channel's selling-status token — {@code SELLING} / {@code SUSPENDED} /
 * {@code ENDED} / {@code UNKNOWN}, fail-closed to {@code UNKNOWN}.
 *
 * <p>Deliberately four values and not the channel's own vocabulary, for the reason
 * {@code channel_orders.normalized_status} is deliberately {@code PAID|UNKNOWN}: a status whose meaning
 * has not been observed live must not be given one by guesswork. A token this class does not recognise
 * reads {@code UNKNOWN}, and a surface says "확인되지 않음" rather than inventing 판매중.
 */
public enum SellingStatus {

    SELLING, SUSPENDED, ENDED, UNKNOWN;

    /**
     * Normalize a channel token. Recognises the vocabularies actually documented for the three product
     * channels; anything else — including null and blank — is {@link #UNKNOWN}.
     */
    public static SellingStatus normalize(String raw) {
        if (raw == null || raw.isBlank()) {
            return UNKNOWN;
        }
        String token = raw.strip().toUpperCase(Locale.ROOT);
        return switch (token) {
            // NAVER channel-product statusType / Cafe24 selling+display / Coupang statusName
            case "SALE", "ON_SALE", "SELLING", "T", "APPROVED", "판매중" -> SELLING;
            case "SUSPENSION", "OUTOFSTOCK", "OUT_OF_STOCK", "SUSPENDED", "PARTIAL_APPROVED",
                 "판매중지", "품절" -> SUSPENDED;
            case "CLOSE", "PROHIBITION", "DELETE", "ENDED", "F", "DELETED", "판매종료" -> ENDED;
            default -> UNKNOWN;
        };
    }
}
