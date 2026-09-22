package com.sellerops.responsibility;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.connector.DataType;
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

    /**
     * <b>Rewritten 2026-09-22 — the contract changed, and this test now states the rule instead of the list.</b>
     *
     * <p>It used to read «exactly the two official-API Cafe24 sources» and assert that NAVER and COUPANG were
     * absent. That was PD-1 pinned as a channel list, and pinning the list is what made a seller who sells only
     * on NAVER unable to start the responsibility at all. What PD-1 actually argued is kept and is what is
     * asserted here: <b>a source belongs in a scheduled obligation when the product can collect it without a
     * person</b>. Nothing about this test got weaker — it gained the two assertions that matter (the AUTOMATIC
     * sources are all present, the SELLER_GUIDED ones are still refused) and it now fails if someone quietly
     * promises to keep a browser-read surface current.
     */
    @Test
    void theTemplateObligesEverySourceTheProductCanCollectWithoutAPerson_andNoOther() {
        ResponsibilityTemplate t = ResponsibilityTemplate.CUSTOMER_OPERATIONS_V1;
        assertThat(t.displayName()).isEqualTo("고객 운영 관리");

        // Every (channel × object) whose Product Truth acquisition mode is AUTOMATIC, and nothing else.
        assertThat(t.sources()).extracting(s -> s.channelCode() + ":" + s.dataType())
                .containsExactly("CAFE24:INQUIRY", "CAFE24:REVIEW", "NAVER:INQUIRY", "COUPANG:INQUIRY");

        // PD-1's argument, still enforced: a surface a person has to press a button for is never an obligation.
        // NAVER reviews arrive by seller-center export or a device read, Coupang reviews by an Action Window —
        // so neither may appear as a REVIEW source, however present its channel is for inquiries.
        assertThat(t.requires("NAVER", DataType.REVIEW)).isFalse();
        assertThat(t.requires("COUPANG", DataType.REVIEW)).isFalse();
        // ...and both remain reachable the other way, beside the obligation rather than inside it.
        assertThat(t.deviceRecipes()).contains("NAVER_REVIEW_OBSERVE_V1", "COUPANG_REVIEW_OBSERVE_V1");

        // No ORDER or PRODUCT source: this responsibility is customer operations, not catalogue upkeep.
        assertThat(t.sources()).noneMatch(s -> s.dataType() == DataType.ORDER_SUMMARY
                || s.dataType() == DataType.PRODUCT);
        assertThat(ResponsibilityTemplate.values()).hasSize(1);
    }
}
