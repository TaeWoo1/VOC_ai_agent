package com.sellerops.coverage;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.channel.ChannelStatus;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.sync.SyncSchedule;
import java.time.Instant;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The freshness verdict, and the order it is derived in.
 *
 * <p><b>The order is the whole safety property.</b> Support is a fact about the CHANNEL and is asked
 * first, so nothing about this seller's connection can make a supported channel read as unsupported —
 * the exact failure this class was written after. On 2026-08-24 two feature flags were lowered and the
 * live connector answered {@code INQUIRY supported=false} for NAVER, a channel live-proven that same
 * morning on two official resources; a screen reads that as "네이버는 문의를 지원하지 않습니다".
 */
class ChannelCoverageStateTest {

    private static final Instant NOW = Instant.parse("2026-08-24T06:00:00Z");

    private static SellerAccount account(ChannelStatus status) {
        SellerAccount account = new SellerAccount();
        account.setConnectionStatus(status);
        return account;
    }

    private static SyncSchedule schedule(boolean enabled, Integer intervalMinutes) {
        SyncSchedule s = new SyncSchedule();
        s.setEnabled(enabled);
        s.setIntervalMinutes(intervalMinutes);
        return s;
    }

    @Test
    @DisplayName("an unsupported channel is unsupported however well it is connected")
    void supportIsAFactAboutTheChannel() {
        assertThat(ChannelCoverageService.stateOf(ChannelCoverageService.Support.UNSUPPORTED, true, account(ChannelStatus.CONNECTED),
                true, NOW, schedule(true, 60), 0, NOW))
                .isEqualTo(ChannelDataState.NOT_SUPPORTED);
    }

    @Test
    @DisplayName("a supported channel is never reported unsupported because collection stopped")
    void localWiringIsNotSupport() {
        // The 2026-08-24 case, as an assertion. Flags down, routine off, credential rejected — and the
        // answer is still "we cannot say", never "the channel does not offer it".
        ChannelDataState state = ChannelCoverageService.stateOf(ChannelCoverageService.Support.SUPPORTED, true,
                account(ChannelStatus.CONNECTED), false, null, schedule(false, 60), 18, NOW);
        assertThat(state).isEqualTo(ChannelDataState.OBSERVED_FRESHNESS_UNPROVEN);
        assertThat(state).isNotEqualTo(ChannelDataState.NOT_SUPPORTED);
        assertThat(state.hasObservations()).isTrue();
        assertThat(state.cannotProveAbsence()).isTrue();
    }

    @Test
    @DisplayName("no account and a broken account are two different answers")
    void connectionHasTwoFailureShapes() {
        assertThat(ChannelCoverageService.stateOf(ChannelCoverageService.Support.SUPPORTED, false, null, false, null, null, 0, NOW))
                .isEqualTo(ChannelDataState.NOT_CONNECTED);
        assertThat(ChannelCoverageService.stateOf(ChannelCoverageService.Support.SUPPORTED, false,
                account(ChannelStatus.RECONNECT_REQUIRED), false, null, null, 18, NOW))
                .isEqualTo(ChannelDataState.BLOCKED);
    }

    @Test
    @DisplayName("ZERO is the only measured absence, and it takes a live routine to earn")
    void zeroMustBeEarned() {
        assertThat(ChannelCoverageService.stateOf(ChannelCoverageService.Support.SUPPORTED, true, account(ChannelStatus.CONNECTED),
                true, NOW.minusSeconds(600), schedule(true, 60), 0, NOW))
                .isEqualTo(ChannelDataState.ZERO);
        // Same zero rows, no routine — and now it is NOT a zero. This pair is the point of the enum.
        assertThat(ChannelCoverageService.stateOf(ChannelCoverageService.Support.SUPPORTED, true, account(ChannelStatus.CONNECTED),
                false, NOW.minusSeconds(600), schedule(false, 60), 0, NOW))
                .isEqualTo(ChannelDataState.OBSERVED_FRESHNESS_UNPROVEN);
    }

    @Test
    @DisplayName("freshness is measured against the schedule's OWN cadence, not an invented number")
    void freshnessComesFromTheSchedule() {
        SyncSchedule hourly = schedule(true, 60);
        SyncSchedule daily = schedule(true, 1440);
        Instant fourHoursAgo = NOW.minusSeconds(4 * 3600);
        // Four hours is stale for an hourly schedule and current for a daily one. A single constant
        // would have to be wrong for one of them.
        assertThat(ChannelCoverageService.stateOf(ChannelCoverageService.Support.SUPPORTED, true, account(ChannelStatus.CONNECTED),
                true, fourHoursAgo, hourly, 18, NOW))
                .isEqualTo(ChannelDataState.OBSERVED_FRESHNESS_UNPROVEN);
        assertThat(ChannelCoverageService.stateOf(ChannelCoverageService.Support.SUPPORTED, true, account(ChannelStatus.CONNECTED),
                true, fourHoursAgo, daily, 18, NOW))
                .isEqualTo(ChannelDataState.OBSERVED_FRESH);
    }

    @Test
    @DisplayName("a schedule that has never succeeded is not fresh, whatever it is set to")
    void anArmedScheduleIsNotAProvenOne() {
        assertThat(ChannelCoverageService.stateOf(ChannelCoverageService.Support.SUPPORTED, true, account(ChannelStatus.CONNECTED),
                true, null, schedule(true, 60), 18, NOW))
                .isEqualTo(ChannelDataState.OBSERVED_FRESHNESS_UNPROVEN);
    }

    @Test
    @DisplayName("only ZERO licenses an absence claim; only ZERO and FRESH license a 'now' claim")
    void theTwoPermissionsAreDistinct() {
        for (ChannelDataState state : ChannelDataState.values()) {
            assertThat(state.cannotProveAbsence())
                    .as("%s", state)
                    .isEqualTo(state != ChannelDataState.ZERO);
        }
        assertThat(ChannelDataState.OBSERVED_FRESH.hasObservations()).isTrue();
        assertThat(ChannelDataState.OBSERVED_FRESHNESS_UNPROVEN.hasObservations()).isTrue();
        assertThat(ChannelDataState.NOT_SUPPORTED.hasObservations()).isFalse();
    }

    @Test
    @DisplayName("an UNDECLARED capability is never reported as unsupported")
    void anUndeclaredRowIsNotAVerdict() {
        // Cafe24 held 113 inquiries, 69 unanswered, and had no row in `connector_capabilities` at all.
        // The first live read called it NOT_SUPPORTED. A missing declaration is nobody's verdict.
        ChannelDataState state = ChannelCoverageService.stateOf(
                ChannelCoverageService.Support.UNDECLARED, true, account(ChannelStatus.CONNECTED),
                true, NOW.minusSeconds(600), schedule(true, 60), 113, NOW);
        assertThat(state).isNotEqualTo(ChannelDataState.NOT_SUPPORTED);
        assertThat(state).isEqualTo(ChannelDataState.OBSERVED_FRESH);
    }

    @Test
    @DisplayName("no API is not no data — rows acquired another way are not erased by NOT_SUPPORTED")
    void anUnsupportedApiWithRowsStillHasRows() {
        // NAVER has no review API and this org holds 4,340 NAVER reviews from an approved export path.
        // "네이버는 리뷰 데이터를 제공하지 않습니다" is true about the API and false about the data.
        assertThat(ChannelCoverageService.stateOf(ChannelCoverageService.Support.UNSUPPORTED, true,
                account(ChannelStatus.CONNECTED), false, null, null, 4340, NOW))
                .isEqualTo(ChannelDataState.OBSERVED_FRESHNESS_UNPROVEN);
        // With no rows it is the plain capability statement, which is what that value is for.
        assertThat(ChannelCoverageService.stateOf(ChannelCoverageService.Support.UNSUPPORTED, true,
                account(ChannelStatus.CONNECTED), false, null, null, 0, NOW))
                .isEqualTo(ChannelDataState.NOT_SUPPORTED);
    }
}
