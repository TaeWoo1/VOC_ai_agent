package com.sellerops.collect;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.common.ApiException;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;

/** The backfill window fails closed on a missing or inverted range; a same-day window is valid. */
class BackfillWindowTest {

    private static final LocalDate START = LocalDate.parse("2026-01-01");
    private static final LocalDate END = LocalDate.parse("2026-06-25");

    @Test
    void acceptsAForwardRange() {
        BackfillWindow window = BackfillWindow.of(START, END);
        assertThat(window.startDate()).isEqualTo(START);
        assertThat(window.endDate()).isEqualTo(END);
    }

    @Test
    void acceptsASingleDayWindow() {
        BackfillWindow window = BackfillWindow.of(START, START);
        assertThat(window.startDate()).isEqualTo(window.endDate());
    }

    @Test
    void rejectsAnInvertedRange() {
        assertThatThrownBy(() -> BackfillWindow.of(END, START))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("종료일");
    }

    @Test
    void rejectsAMissingBound() {
        assertThatThrownBy(() -> BackfillWindow.of(null, END)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> BackfillWindow.of(START, null)).isInstanceOf(ApiException.class);
    }
}
