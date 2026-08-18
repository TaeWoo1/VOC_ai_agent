package com.sellerops.auth.social;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * The one-time-ness lives in one SQL statement: {@code consume} turns a live row into a spent one exactly once,
 * and never touches a row of another purpose or one past its TTL. Pinned against the real query (H2), not a mock.
 */
@DataJpaTest
@ActiveProfiles("test")
class AuthHandoffRepositoryTest {

    @Autowired AuthHandoffRepository handoffs;

    private AuthHandoff row(String code, AuthHandoff.Purpose purpose, Instant expiresAt) {
        AuthHandoff h = new AuthHandoff();
        h.setCodeHash(AuthCodes.hash(code));
        h.setPurpose(purpose);
        h.setProvider("google");
        h.setProviderSubject("s");
        h.setExpiresAt(expiresAt);
        return handoffs.saveAndFlush(h);
    }

    @Test
    void consumeSucceedsExactlyOnceForALiveRowOfTheRightPurpose() {
        Instant now = Instant.parse("2026-08-19T00:00:00Z");
        row("c1", AuthHandoff.Purpose.SESSION, now.plusSeconds(60));

        assertThat(handoffs.consume(AuthCodes.hash("c1"), AuthHandoff.Purpose.ONBOARDING, now)).isZero();
        assertThat(handoffs.consume(AuthCodes.hash("c1"), AuthHandoff.Purpose.SESSION, now)).isEqualTo(1);
        assertThat(handoffs.consume(AuthCodes.hash("c1"), AuthHandoff.Purpose.SESSION, now)).isZero();
        assertThat(handoffs.findByCodeHash(AuthCodes.hash("c1")).orElseThrow().getConsumedAt()).isEqualTo(now);
    }

    @Test
    void expiredRowsCannotBeConsumedAndArePurged() {
        Instant now = Instant.parse("2026-08-19T00:00:00Z");
        row("old", AuthHandoff.Purpose.ONBOARDING_TOKEN, now.minusSeconds(1));
        row("live", AuthHandoff.Purpose.ONBOARDING_TOKEN, now.plusSeconds(1));

        assertThat(handoffs.consume(AuthCodes.hash("old"), AuthHandoff.Purpose.ONBOARDING_TOKEN, now)).isZero();
        assertThat(handoffs.deleteExpiredBefore(now)).isEqualTo(1);
        assertThat(handoffs.findByCodeHash(AuthCodes.hash("old"))).isEmpty();
        assertThat(handoffs.findByCodeHash(AuthCodes.hash("live"))).isPresent();
    }
}
