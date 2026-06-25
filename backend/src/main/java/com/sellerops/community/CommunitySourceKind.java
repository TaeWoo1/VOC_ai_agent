package com.sellerops.community;

import java.util.Locale;

/**
 * The kind of Cafe24 community article, normalized to a small closed set so the
 * stored value is always one of these four. The connector decides the raw value
 * from the board it collected (confirmed mapping on the target mall: board 4
 * 구매후기 → {@code REVIEW}, board 6 문의사항 → {@code PRODUCT_INQUIRY}, board 9
 * 1:1 맞춤상담 → {@code ONE_TO_ONE_INQUIRY}). {@link #normalize} is the safety net
 * that keeps any unrecognized or blank value out of storage by mapping it to
 * {@code OTHER}.
 */
public enum CommunitySourceKind {
    REVIEW,
    PRODUCT_INQUIRY,
    ONE_TO_ONE_INQUIRY,
    OTHER;

    /** Map a raw source-kind token to a canonical value; unknown/blank → {@code OTHER}. */
    public static CommunitySourceKind normalize(String raw) {
        if (raw == null || raw.isBlank()) {
            return OTHER;
        }
        try {
            return valueOf(raw.strip().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            return OTHER;
        }
    }
}
