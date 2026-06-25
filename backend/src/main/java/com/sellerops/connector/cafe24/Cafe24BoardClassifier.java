package com.sellerops.connector.cafe24;

import java.util.Locale;

/**
 * Classifies a Cafe24 community board by the kind of VOC it carries, from its
 * board name alone. Pure and offline: no network, no clock, no credentials — the
 * same {@link Cafe24BoardRow} always yields the same {@link BoardKind}.
 *
 * <p>This is the mapping that Board Discovery exists to produce: a mall's review
 * board and its inquiry/Q&A board are the two surfaces a later slice will collect
 * from, so each board is bucketed as {@code REVIEW_BEARING}, {@code INQUIRY_BEARING},
 * or {@code OTHER} (notices, free boards, galleries, …).
 *
 * <p><b>Precedence is inquiry-before-review</b>: an inquiry/Q&A board is the more
 * actionable VOC surface, so a name matching both keyword sets resolves to
 * {@code INQUIRY_BEARING}. A null/blank name is {@code OTHER} (never guessed).
 *
 * <p>The keyword rules were <b>confirmed</b> ({@code CONFIRMED}) against a real
 * target mall by the supervised {@code /boards} live run: the default board
 * naming classified correctly (구매후기 → review; 문의사항 and 1:1 맞춤상담 →
 * inquiry) with no false positives across the non-VOC boards. The run also showed
 * {@code board_type} alone is insufficient (one type spanned REVIEW/INQUIRY/OTHER),
 * validating this name-based approach. A mall that renames or adds boards may still
 * need the keyword set extended.
 */
public class Cafe24BoardClassifier {

    /** The VOC surface a community board carries, for the discovery mapping. */
    public enum BoardKind {
        REVIEW_BEARING,
        INQUIRY_BEARING,
        OTHER
    }

    // Lower-cased substring keywords. Korean needs no case folding; the English
    // aliases are matched after lower-casing the board name.
    private static final String[] INQUIRY_KEYWORDS = {"문의", "q&a", "qna", "1:1", "상담", "inquiry"};
    private static final String[] REVIEW_KEYWORDS = {"후기", "리뷰", "review"};

    /** Classify one board by its name; inquiry keywords win over review keywords. */
    public BoardKind classify(Cafe24BoardRow board) {
        String name = board == null ? null : board.boardName();
        if (name == null || name.isBlank()) {
            return BoardKind.OTHER;
        }
        String normalized = name.toLowerCase(Locale.ROOT);
        if (containsAny(normalized, INQUIRY_KEYWORDS)) {
            return BoardKind.INQUIRY_BEARING;
        }
        if (containsAny(normalized, REVIEW_KEYWORDS)) {
            return BoardKind.REVIEW_BEARING;
        }
        return BoardKind.OTHER;
    }

    private static boolean containsAny(String haystack, String[] needles) {
        for (String needle : needles) {
            if (haystack.contains(needle)) {
                return true;
            }
        }
        return false;
    }
}
