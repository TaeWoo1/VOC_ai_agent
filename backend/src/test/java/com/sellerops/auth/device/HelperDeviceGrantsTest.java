package com.sellerops.auth.device;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** The pending grant: two codes, one approval, one redemption, five minutes. */
class HelperDeviceGrantsTest {

    private static final class MutableClock extends Clock {
        Instant now = Instant.parse("2026-09-05T00:00:00Z");
        @Override public java.time.ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(java.time.ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }
    }

    private final MutableClock clock = new MutableClock();
    private final HelperDeviceGrants grants = new HelperDeviceGrants(clock);

    @Test
    void approvedGrantIsHandedOverExactlyOnce() {
        var issued = grants.issue("Mac (arm64)", "0.2.0").orElseThrow();
        assertThat(issued.userCode()).hasSize(8).doesNotContain("0", "O", "1", "I");
        assertThat(grants.poll(issued.deviceCode()).outcome()).isEqualTo(HelperDeviceGrants.PollOutcome.AUTHORIZATION_PENDING);

        UUID org = UUID.randomUUID();
        UUID user = UUID.randomUUID();
        assertThat(grants.approve(issued.userCode().toLowerCase(), org, user)).isTrue();
        // A second approval of the same code is not a second grant.
        assertThat(grants.approve(issued.userCode(), UUID.randomUUID(), UUID.randomUUID())).isFalse();

        var poll = grants.poll(issued.deviceCode());
        assertThat(poll.outcome()).isEqualTo(HelperDeviceGrants.PollOutcome.APPROVED);
        assertThat(poll.orgId()).isEqualTo(org);
        assertThat(poll.userId()).isEqualTo(user);
        assertThat(poll.deviceName()).isEqualTo("Mac (arm64)");
        // Spent: the same device code never yields a second token.
        assertThat(grants.poll(issued.deviceCode()).outcome()).isEqualTo(HelperDeviceGrants.PollOutcome.EXPIRED_TOKEN);
        assertThat(grants.pendingCount()).isZero();
    }

    @Test
    void unknownCodesAreRefusedAndAGrantExpiresAfterFiveMinutes() {
        assertThat(grants.approve("NOPE1234", UUID.randomUUID(), UUID.randomUUID())).isFalse();
        assertThat(grants.poll("not-a-device-code").outcome()).isEqualTo(HelperDeviceGrants.PollOutcome.EXPIRED_TOKEN);

        var issued = grants.issue("Mac (arm64)", null).orElseThrow();
        clock.now = clock.now.plus(HelperDeviceGrants.TTL).plus(Duration.ofSeconds(1));
        assertThat(grants.approve(issued.userCode(), UUID.randomUUID(), UUID.randomUUID())).isFalse();
        assertThat(grants.poll(issued.deviceCode()).outcome()).isEqualTo(HelperDeviceGrants.PollOutcome.EXPIRED_TOKEN);
    }

    @Test
    void theDeploymentHoldsABoundedNumberOfPendingGrants() {
        for (int i = 0; i < HelperDeviceGrants.MAX_PENDING; i++) {
            assertThat(grants.issue("Mac", null)).isPresent();
        }
        assertThat(grants.issue("Mac", null)).isEmpty();
        clock.now = clock.now.plus(HelperDeviceGrants.TTL).plus(Duration.ofSeconds(1));
        assertThat(grants.issue("Mac", null)).isPresent();
    }
}
