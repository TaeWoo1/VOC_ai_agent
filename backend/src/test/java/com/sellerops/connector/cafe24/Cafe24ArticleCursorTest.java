package com.sellerops.connector.cafe24;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** The opaque board+offset cursor codec: encode/decode round-trip and defensive resets. */
class Cafe24ArticleCursorTest {

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
}
