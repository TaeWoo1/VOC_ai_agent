package com.sellerops.connector.esm.inquiry;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;

class EsmInquiryDateWindowTest {

    @Test
    void singleWindowWhenRangeFitsWithinSevenDays() {
        List<EsmInquiryDateWindow> windows =
                EsmInquiryDateWindow.chunkWeekly(LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 7));
        assertThat(windows).hasSize(1);
        assertThat(windows.get(0).startInclusive()).isEqualTo(LocalDate.of(2026, 6, 1));
        assertThat(windows.get(0).endInclusive()).isEqualTo(LocalDate.of(2026, 6, 7));
        assertThat(windows.get(0).dayCount()).isEqualTo(7);
    }

    @Test
    void splitsLongRangeIntoContiguousNonOverlappingSevenDayWindows() {
        // 16 days (Jun 1..16 inclusive) => 7 + 7 + 2.
        List<EsmInquiryDateWindow> windows =
                EsmInquiryDateWindow.chunkWeekly(LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 16));
        assertThat(windows).hasSize(3);
        assertThat(windows.get(0).startInclusive()).isEqualTo(LocalDate.of(2026, 6, 1));
        assertThat(windows.get(0).endInclusive()).isEqualTo(LocalDate.of(2026, 6, 7));
        assertThat(windows.get(1).startInclusive()).isEqualTo(LocalDate.of(2026, 6, 8));
        assertThat(windows.get(1).endInclusive()).isEqualTo(LocalDate.of(2026, 6, 14));
        assertThat(windows.get(2).startInclusive()).isEqualTo(LocalDate.of(2026, 6, 15));
        assertThat(windows.get(2).endInclusive()).isEqualTo(LocalDate.of(2026, 6, 16));
        assertThat(windows.get(2).dayCount()).isEqualTo(2);

        // No gaps and no overlaps: each window starts the day after the previous ends.
        for (int i = 1; i < windows.size(); i++) {
            assertThat(windows.get(i).startInclusive())
                    .isEqualTo(windows.get(i - 1).endInclusive().plusDays(1));
        }
    }

    @Test
    void singleDayRangeProducesOneOneDayWindow() {
        List<EsmInquiryDateWindow> windows =
                EsmInquiryDateWindow.chunk(LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 1), 7);
        assertThat(windows).hasSize(1);
        assertThat(windows.get(0).dayCount()).isEqualTo(1);
    }

    @Test
    void exactMultipleSplitsEvenly() {
        // 14 days => two full 7-day windows, no short tail.
        List<EsmInquiryDateWindow> windows =
                EsmInquiryDateWindow.chunkWeekly(LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 14));
        assertThat(windows).hasSize(2);
        assertThat(windows.get(0).dayCount()).isEqualTo(7);
        assertThat(windows.get(1).dayCount()).isEqualTo(7);
    }

    @Test
    void rejectsInvalidArguments() {
        assertThatThrownBy(
                        () -> EsmInquiryDateWindow.chunk(LocalDate.of(2026, 6, 8), LocalDate.of(2026, 6, 1), 7))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(
                        () -> EsmInquiryDateWindow.chunk(LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 8), 0))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(
                        () -> new EsmInquiryDateWindow(LocalDate.of(2026, 6, 8), LocalDate.of(2026, 6, 1)))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
