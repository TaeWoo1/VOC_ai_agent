package com.sellerops.connector.cafe24;

import java.time.LocalDate;
import java.time.format.DateTimeParseException;

/**
 * Opaque resume position for Cafe24 board-article paging: which board, the offset
 * reached so far, and an optional bounded date window (the backfill seed). Encoded
 * as {@code "b<boardNo>:o<offset>"} (plain offset sweep) or
 * {@code "b<boardNo>:o<offset>:s<startDate>:e<endDate>"} (windowed backfill) into
 * the runtime's single per-(account × data type) cursor slot — the connector owns
 * the format, the runtime treats it as opaque.
 *
 * <p>The window is the seed for a date-range sweep: when present, the connector passes
 * {@code start_date}/{@code end_date} to the articles endpoint; {@link #advance} preserves it across
 * pages so a multi-page sweep stays inside the window. Decoding is defensive — a null/blank,
 * board-mismatched, or malformed value restarts the sweep at offset 0 with no window rather than
 * resuming a stale position. A half-specified window (only start or only end) is treated as no window.
 *
 * <p><b>Two kinds of window, and they must not be confused.</b> {@code routine} marks the trailing
 * recent window the ongoing lane recomputes every run; without it a window is an operator's bounded
 * historical backfill, which owns its dates and must never be moved. The flag is encoded as
 * {@code :r1} and is what lets one cursor format serve both lanes — the connector cannot otherwise
 * tell them apart, because the runtime chooses the lane and hands the connector only an opaque value.
 */
record Cafe24ArticleCursor(int boardNo, int offset, LocalDate windowStart, LocalDate windowEnd,
                           boolean routine) {

    static Cafe24ArticleCursor start(int boardNo) {
        return new Cafe24ArticleCursor(boardNo, 0, null, null, false);
    }

    /** Seed a bounded backfill sweep over {@code [windowStart, windowEnd]} at offset 0. */
    static Cafe24ArticleCursor window(int boardNo, LocalDate windowStart, LocalDate windowEnd) {
        return new Cafe24ArticleCursor(boardNo, 0, windowStart, windowEnd, false);
    }

    /**
     * Seed the ROUTINE lane's trailing recent window at offset 0.
     *
     * <p>Recomputed each run rather than resumed. The routine lane's job is "what is new", and a
     * position carried forward from a previous day would make it "where I stopped", which is what an
     * unwindowed offset sweep already did — walking a board from its oldest article forward, at one
     * page per hour, while a new inquiry sat unread behind the whole history.
     */
    static Cafe24ArticleCursor routineWindow(int boardNo, LocalDate windowStart, LocalDate windowEnd) {
        return new Cafe24ArticleCursor(boardNo, 0, windowStart, windowEnd, true);
    }

    boolean hasWindow() {
        return windowStart != null && windowEnd != null;
    }

    String encode() {
        StringBuilder sb = new StringBuilder("b").append(boardNo).append(":o").append(offset);
        if (hasWindow()) {
            sb.append(":s").append(windowStart).append(":e").append(windowEnd);
            if (routine) {
                sb.append(":r1");
            }
        }
        return sb.toString();
    }

    /** Resume position within {@code expectedBoardNo}; fresh start on null/blank/mismatch/garbage. */
    static Cafe24ArticleCursor decode(String value, int expectedBoardNo) {
        if (value == null || value.isBlank()) {
            return start(expectedBoardNo);
        }
        try {
            Integer board = null;
            Integer offset = null;
            LocalDate windowStart = null;
            LocalDate windowEnd = null;
            boolean routine = false;
            for (String token : value.strip().split(":")) {
                if (token.isEmpty()) {
                    return start(expectedBoardNo);
                }
                String rest = token.substring(1);
                switch (token.charAt(0)) {
                    case 'b' -> board = Integer.valueOf(rest);
                    case 'o' -> offset = Integer.valueOf(rest);
                    case 's' -> windowStart = LocalDate.parse(rest);
                    case 'e' -> windowEnd = LocalDate.parse(rest);
                    case 'r' -> routine = "1".equals(rest);
                    default -> {
                        return start(expectedBoardNo);
                    }
                }
            }
            if (board == null || offset == null || board != expectedBoardNo || offset < 0) {
                return start(expectedBoardNo);
            }
            // A half-specified window is not trustworthy — treat as no window.
            if ((windowStart == null) != (windowEnd == null)) {
                windowStart = null;
                windowEnd = null;
            }
            // A routine flag without a window means nothing and must not survive: it would let a bare
            // offset sweep claim to be the recent lane.
            return new Cafe24ArticleCursor(board, offset, windowStart, windowEnd,
                    routine && windowStart != null);
        } catch (NumberFormatException | DateTimeParseException e) {
            return start(expectedBoardNo);
        }
    }

    /** Advance by the number of rows just consumed, preserving the window and its kind. */
    Cafe24ArticleCursor advance(int count) {
        return new Cafe24ArticleCursor(boardNo, offset + Math.max(0, count), windowStart, windowEnd,
                routine);
    }

    /** Whether this cursor's routine window still covers {@code today}. */
    boolean routineWindowCovers(LocalDate today) {
        return routine && hasWindow() && !windowEnd.isBefore(today);
    }
}
