package com.sellerops.connector.coupang;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.connector.coupang.CoupangCredentialExpiryStatus.State;
import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.Test;

/**
 * The PURE expiry-status state machine — every state and boundary, with {@code now}
 * always a parameter (no wall-clock inside the class). Covers the two rules that
 * matter most for correctness: a 401 / auth failure ALONE (date not passed) is NOT
 * expired, and date-passed + auth-failing IS expired.
 */
class CoupangCredentialExpiryStatusTest {

    private static final Instant NOW = Instant.parse("2026-08-07T00:00:00Z");

    private static CoupangCredentialExpiryStatus at(Duration fromNow, boolean authFailing) {
        return CoupangCredentialExpiryStatus.compute(NOW.plus(fromNow), NOW, authFailing);
    }

    @Test
    void nullExpiryIsUnknownAndNeverRenewRecommended() {
        CoupangCredentialExpiryStatus s = CoupangCredentialExpiryStatus.compute(null, NOW, false);
        assertThat(s.state()).isEqualTo(State.UNKNOWN);
        assertThat(s.daysRemaining()).isNull();
        assertThat(s.expiresAt()).isNull();
        assertThat(s.renewRecommended()).isFalse();
        assertThat(s.authFailing()).isFalse();
    }

    @Test
    void unknownStillSurfacesAuthFailing() {
        // Auth is failing but there is no date: still UNKNOWN (never guessed EXPIRED), authFailing carried.
        CoupangCredentialExpiryStatus s = CoupangCredentialExpiryStatus.compute(null, NOW, true);
        assertThat(s.state()).isEqualTo(State.UNKNOWN);
        assertThat(s.authFailing()).isTrue();
        assertThat(s.renewRecommended()).isFalse();
    }

    @Test
    void moreThan30DaysIsOk() {
        CoupangCredentialExpiryStatus s = at(Duration.ofDays(31), false);
        assertThat(s.state()).isEqualTo(State.OK);
        assertThat(s.renewRecommended()).isFalse();
        assertThat(s.daysRemaining()).isEqualTo(31);
    }

    @Test
    void exactly30DaysIsWarn30_andNotRenewRecommended() {
        CoupangCredentialExpiryStatus s = at(Duration.ofDays(30), false);
        assertThat(s.state()).isEqualTo(State.WARN_30);
        assertThat(s.daysRemaining()).isEqualTo(30);
        assertThat(s.renewRecommended()).isFalse(); // WARN_30 does not yet recommend renewal
    }

    @Test
    void justInsideTheWarn14BoundaryIsWarn14_andRenewRecommended() {
        CoupangCredentialExpiryStatus s = at(Duration.ofDays(14), false);
        assertThat(s.state()).isEqualTo(State.WARN_14);
        assertThat(s.daysRemaining()).isEqualTo(14);
        assertThat(s.renewRecommended()).isTrue();
    }

    @Test
    void fifteenDaysIsStillWarn30() {
        assertThat(at(Duration.ofDays(15), false).state()).isEqualTo(State.WARN_30);
    }

    @Test
    void sevenDaysIsWarn7() {
        CoupangCredentialExpiryStatus s = at(Duration.ofDays(7), false);
        assertThat(s.state()).isEqualTo(State.WARN_7);
        assertThat(s.renewRecommended()).isTrue();
    }

    @Test
    void eightDaysIsWarn14() {
        assertThat(at(Duration.ofDays(8), false).state()).isEqualTo(State.WARN_14);
    }

    @Test
    void oneDayIsWarn1() {
        CoupangCredentialExpiryStatus s = at(Duration.ofDays(1), false);
        assertThat(s.state()).isEqualTo(State.WARN_1);
        assertThat(s.daysRemaining()).isEqualTo(1);
        assertThat(s.renewRecommended()).isTrue();
    }

    @Test
    void twoDaysIsWarn7() {
        assertThat(at(Duration.ofDays(2), false).state()).isEqualTo(State.WARN_7);
    }

    @Test
    void hoursRemainingIsWarn1() {
        // 12 hours left → ceil(0.5) = 1 day remaining → WARN_1, not yet passed.
        CoupangCredentialExpiryStatus s = at(Duration.ofHours(12), false);
        assertThat(s.state()).isEqualTo(State.WARN_1);
    }

    @Test
    void datePassedWithoutAuthFailingIsSoftDatePassed() {
        CoupangCredentialExpiryStatus s = at(Duration.ofDays(-3), false);
        assertThat(s.state()).isEqualTo(State.DATE_PASSED);
        assertThat(s.renewRecommended()).isTrue();
        assertThat(s.authFailing()).isFalse();
    }

    @Test
    void datePassedWithAuthFailingIsStrongExpired() {
        CoupangCredentialExpiryStatus s = at(Duration.ofDays(-3), true);
        assertThat(s.state()).isEqualTo(State.EXPIRED);
        assertThat(s.renewRecommended()).isTrue();
        assertThat(s.authFailing()).isTrue();
    }

    @Test
    void authFailingAloneWhileDateStillInFutureIsNotExpired() {
        // The key rule: a 401 / auth failure alone, WITHOUT the date having passed,
        // must NOT read as EXPIRED — it stays OK/WARN by the date.
        assertThat(at(Duration.ofDays(31), true).state()).isEqualTo(State.OK);
        assertThat(at(Duration.ofDays(5), true).state()).isEqualTo(State.WARN_7);
        assertThat(at(Duration.ofDays(20), true).state()).isEqualTo(State.WARN_30);
    }

    @Test
    void exactlyNowCountsAsDatePassed() {
        // expiresAt == now: the date has passed (not after now). Auth-failing ⇒ EXPIRED.
        assertThat(CoupangCredentialExpiryStatus.compute(NOW, NOW, true).state()).isEqualTo(State.EXPIRED);
        assertThat(CoupangCredentialExpiryStatus.compute(NOW, NOW, false).state()).isEqualTo(State.DATE_PASSED);
    }

    @Test
    void nullNowIsRejected() {
        assertThatThrownBy(() -> CoupangCredentialExpiryStatus.compute(NOW, null, false))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
