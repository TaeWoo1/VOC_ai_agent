package com.sellerops.connector.cafe24;

/**
 * Opaque resume position for Cafe24 board-article paging: which board and the
 * offset reached so far. Encoded as {@code "b<boardNo>:o<offset>"} into the
 * runtime's single per-(account × data type) cursor slot — the connector owns the
 * format, the runtime treats it as opaque.
 *
 * <p>Deliberately minimal for PR B: board + offset only. A date-window/backfill
 * seed is a later addition (when the runtime backfill trigger lands); decoding is
 * defensive — a null/blank or board-mismatched value restarts the sweep at offset
 * 0 rather than resuming a stale position.
 */
record Cafe24ArticleCursor(int boardNo, int offset) {

    static Cafe24ArticleCursor start(int boardNo) {
        return new Cafe24ArticleCursor(boardNo, 0);
    }

    String encode() {
        return "b" + boardNo + ":o" + offset;
    }

    /** Resume position within {@code expectedBoardNo}; fresh start on null/blank/mismatch. */
    static Cafe24ArticleCursor decode(String value, int expectedBoardNo) {
        if (value == null || value.isBlank()) {
            return start(expectedBoardNo);
        }
        try {
            int colon = value.indexOf(':');
            if (colon <= 1 || value.charAt(0) != 'b' || value.charAt(colon + 1) != 'o') {
                return start(expectedBoardNo);
            }
            int boardNo = Integer.parseInt(value.substring(1, colon));
            int offset = Integer.parseInt(value.substring(colon + 2));
            if (boardNo != expectedBoardNo || offset < 0) {
                return start(expectedBoardNo);
            }
            return new Cafe24ArticleCursor(boardNo, offset);
        } catch (RuntimeException e) {
            return start(expectedBoardNo);
        }
    }

    /** Advance by the number of rows just consumed. */
    Cafe24ArticleCursor advance(int count) {
        return new Cafe24ArticleCursor(boardNo, offset + Math.max(0, count));
    }
}
