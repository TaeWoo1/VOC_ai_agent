package com.sellerops.responsibility;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.Test;

/** PD-2: fixed 2-hour Asia/Seoul windows, a pure function of the instant. */
class ResponsibilityWindowsTest {

    @Test
    void windowsAreEvenKstHoursTwoHoursLong() {
        // 21:41:59 KST → window [20:00, 22:00) KST = [11:00Z, 13:00Z)
        Instant at = Instant.parse("2026-09-15T12:41:59Z");
        Instant start = ResponsibilityWindows.slotStart(at);
        assertThat(start).isEqualTo(Instant.parse("2026-09-15T11:00:00Z"));
        assertThat(ResponsibilityWindows.slotEnd(start)).isEqualTo(Instant.parse("2026-09-15T13:00:00Z"));
    }

    @Test
    void kstMidnightIsABoundaryAndTheLastSecondBeforeItIsNot() {
        Instant midnightKst = Instant.parse("2026-09-15T15:00:00Z");
        assertThat(ResponsibilityWindows.isBoundary(midnightKst)).isTrue();
        assertThat(ResponsibilityWindows.slotStart(midnightKst.minusSeconds(1)))
                .isEqualTo(Instant.parse("2026-09-15T13:00:00Z"));
    }

    @Test
    void everyInstantOfAWindowNamesTheSameWindow_soARestartCannotMoveIt() {
        Instant start = Instant.parse("2026-09-15T13:00:00Z");
        for (long s = 0; s < Duration.ofHours(2).toSeconds(); s += 97) {
            assertThat(ResponsibilityWindows.slotStart(start.plusSeconds(s))).isEqualTo(start);
        }
        assertThat(ResponsibilityWindows.slotStart(start.plus(Duration.ofHours(2))))
                .isEqualTo(start.plus(Duration.ofHours(2)));
    }

    @Test
    void theTemplateRequiresExactlyTheTwoOfficialApiCafe24Sources() {
        ResponsibilityTemplate t = ResponsibilityTemplate.CUSTOMER_OPERATIONS_V1;
        assertThat(t.displayName()).isEqualTo("고객 운영 관리");
        assertThat(t.sources()).extracting(s -> s.channelCode() + ":" + s.dataType())
                .containsExactly("CAFE24:INQUIRY", "CAFE24:REVIEW");
        // PD-1: browser-read sources are not a scheduled obligation.
        assertThat(t.usesChannel("COUPANG")).isFalse();
        assertThat(t.usesChannel("NAVER")).isFalse();
        assertThat(ResponsibilityTemplate.values()).hasSize(1);
    }
}
