package com.sellerops.connector.cafe24.spike;

/**
 * Board numbers the spike cares about, mirrored here because
 * {@code Cafe24BoardArticleMapper}'s constants are package-private to the parent
 * connector package and not visible from this isolated spike sub-package. Kept in
 * sync deliberately: the product-inquiry board is 6 and the 1:1 board (9) is never
 * a valid spike target.
 */
final class Cafe24Boards {

    /** 문의사항 — product inquiry board (mirror of the mapper's constant). */
    static final int PRODUCT_INQUIRY_BOARD_NO = 6;

    /** 1:1 맞춤상담 — never a spike target (PII-sensitive, excluded everywhere). */
    static final int ONE_TO_ONE_BOARD_NO = 9;

    private Cafe24Boards() {
    }
}
