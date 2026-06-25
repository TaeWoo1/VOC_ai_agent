package com.sellerops.connector.cafe24;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import org.junit.jupiter.api.Test;

/** The opaque board+offset(+window) cursor codec: encode/decode round-trip and defensive resets. */
class Cafe24ArticleCursorTest {

    private static final LocalDate START = LocalDate.parse("2026-01-01");
    private static final LocalDate END = LocalDate.parse("2026-06-25");

    @Test
    void startEncodesBoardAndZeroOffset() {
        assertThat(Cafe24ArticleCursor.start(4).encode()).isEqualTo("b4:o0");
    }

    @Test
    void advanceMovesTheOffset() {
        assertThat(Cafe24ArticleCursor.start(4).advance(50).encode()).isEqualTo("b4:o50");
        assertThat(Cafe24ArticleCursor.start(6).advance(50).advance(30).encode()).isEqualTo("b6:o80");
    }

    @Test
    void decodeRoundTripsAValidValue() {
        Cafe24ArticleCursor cursor = Cafe24ArticleCursor.decode("b4:o100", 4);
        assertThat(cursor.boardNo()).isEqualTo(4);
        assertThat(cursor.offset()).isEqualTo(100);
    }

    @Test
    void decodeNullOrBlankStartsAtZero() {
        assertThat(Cafe24ArticleCursor.decode(null, 6)).isEqualTo(Cafe24ArticleCursor.start(6));
        assertThat(Cafe24ArticleCursor.decode("", 6)).isEqualTo(Cafe24ArticleCursor.start(6));
        assertThat(Cafe24ArticleCursor.decode("  ", 6)).isEqualTo(Cafe24ArticleCursor.start(6));
    }

    @Test
    void decodeResetsOnBoardMismatch() {
        // A cursor from a different board must not resume against this board.
        assertThat(Cafe24ArticleCursor.decode("b4:o100", 6)).isEqualTo(Cafe24ArticleCursor.start(6));
    }

    @Test
    void decodeResetsOnGarbage() {
        for (String bad : new String[] {"garbage", "b4o100", "x4:o1", "b4:x1", "b:o1", "bNaN:o1"}) {
            assertThat(Cafe24ArticleCursor.decode(bad, 4)).isEqualTo(Cafe24ArticleCursor.start(4));
        }
    }

    @Test
    void encodesAndDecodesAWindowedCursor() {
        Cafe24ArticleCursor seeded = Cafe24ArticleCursor.window(4, START, END);
        assertThat(seeded.encode()).isEqualTo("b4:o0:s2026-01-01:e2026-06-25");

        Cafe24ArticleCursor decoded = Cafe24ArticleCursor.decode(seeded.encode(), 4);
        assertThat(decoded.boardNo()).isEqualTo(4);
        assertThat(decoded.offset()).isZero();
        assertThat(decoded.windowStart()).isEqualTo(START);
        assertThat(decoded.windowEnd()).isEqualTo(END);
        assertThat(decoded.hasWindow()).isTrue();
    }

    @Test
    void advancePreservesTheWindow() {
        Cafe24ArticleCursor advanced = Cafe24ArticleCursor.window(6, START, END).advance(3);
        assertThat(advanced.encode()).isEqualTo("b6:o3:s2026-01-01:e2026-06-25");
        assertThat(advanced.windowStart()).isEqualTo(START);
        assertThat(advanced.windowEnd()).isEqualTo(END);
    }

    @Test
    void halfSpecifiedWindowIsTreatedAsNoWindow() {
        // Only a start (no end) is not trustworthy → no window, offset preserved.
        Cafe24ArticleCursor decoded = Cafe24ArticleCursor.decode("b4:o0:s2026-01-01", 4);
        assertThat(decoded.hasWindow()).isFalse();
        assertThat(decoded).isEqualTo(Cafe24ArticleCursor.start(4));
    }

    @Test
    void malformedWindowDateResets() {
        assertThat(Cafe24ArticleCursor.decode("b4:o0:s2026-13-99:e2026-06-25", 4))
                .isEqualTo(Cafe24ArticleCursor.start(4));
    }
}
