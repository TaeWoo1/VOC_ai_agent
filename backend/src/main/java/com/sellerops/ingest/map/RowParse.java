package com.sellerops.ingest.map;

/** Small shared parsers for numeric cells in operator exports. */
final class RowParse {

    private RowParse() {
    }

    /** Rating 1..5; tolerates "5", "5.0", "5점", "★★★★★"-with-digits. Clamped to [1,5]. */
    static Integer rating(String raw) {
        Integer star = stars(raw);
        if (star != null) {
            return star;
        }
        String digits = raw.replaceAll("[^0-9.]", "");
        if (digits.isBlank()) {
            throw new IllegalArgumentException("평점을 인식할 수 없습니다: " + raw);
        }
        int v = (int) Math.round(Double.parseDouble(digits));
        return Math.max(1, Math.min(5, v));
    }

    private static Integer stars(String raw) {
        long count = raw.chars().filter(ch -> ch == '★' || ch == '⭐').count();
        return count >= 1 && count <= 5 ? (int) count : null;
    }

    /** Non-negative integer; strips commas/spaces. */
    static int wholeNumber(String raw, String label) {
        String digits = raw.replaceAll("[^0-9-]", "");
        if (digits.isBlank()) {
            throw new IllegalArgumentException(label + "을(를) 인식할 수 없습니다: " + raw);
        }
        long v = Long.parseLong(digits);
        if (v < 0) {
            throw new IllegalArgumentException(label + "은(는) 음수일 수 없습니다: " + raw);
        }
        if (v > Integer.MAX_VALUE) {
            throw new IllegalArgumentException(label + " 값이 너무 큽니다: " + raw);
        }
        return (int) v;
    }

    /** Non-negative amount (won); strips commas/원/spaces. */
    static long money(String raw, String label) {
        String digits = raw.replaceAll("[^0-9-]", "");
        if (digits.isBlank()) {
            throw new IllegalArgumentException(label + "을(를) 인식할 수 없습니다: " + raw);
        }
        long v = Long.parseLong(digits);
        if (v < 0) {
            throw new IllegalArgumentException(label + "은(는) 음수일 수 없습니다: " + raw);
        }
        return v;
    }
}
