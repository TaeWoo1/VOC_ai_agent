package com.sellerops.auth.password;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.auth.social.AuthCodes;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/** The one-time-ness of a reset link is one SQL statement; pinned against the real query (H2). */
@DataJpaTest
@ActiveProfiles("test")
class PasswordResetTokenRepositoryTest {

    @Autowired PasswordResetTokenRepository tokens;

    private PasswordResetToken row(UUID user, String token, Instant expiresAt) {
        PasswordResetToken t = new PasswordResetToken();
        t.setUserId(user);
        t.setTokenHash(AuthCodes.hash(token));
        t.setExpiresAt(expiresAt);
        return tokens.saveAndFlush(t);
    }

    @Test
    void consumeIsExactlyOnceAndNeverForAnExpiredRow() {
        Instant now = Instant.parse("2026-08-19T00:00:00Z");
        UUID user = UUID.randomUUID();
        row(user, "live", now.plusSeconds(60));
        row(user, "old", now.minusSeconds(1));

        assertThat(tokens.consume(AuthCodes.hash("old"), now)).isZero();
        assertThat(tokens.consume(AuthCodes.hash("live"), now)).isEqualTo(1);
        assertThat(tokens.consume(AuthCodes.hash("live"), now)).isZero();
        assertThat(tokens.deleteExpiredBefore(now)).isEqualTo(1);
    }

    @Test
    void aNewRequestRetiresTheUsersOlderLiveLinksOnly() {
        Instant now = Instant.parse("2026-08-19T00:00:00Z");
        UUID a = UUID.randomUUID();
        UUID b = UUID.randomUUID();
        row(a, "a1", now.plusSeconds(60));
        row(a, "a2", now.plusSeconds(60));
        row(b, "b1", now.plusSeconds(60));

        assertThat(tokens.consumeAllLiveForUser(a, now)).isEqualTo(2);
        assertThat(tokens.consume(AuthCodes.hash("a1"), now)).isZero();
        assertThat(tokens.consume(AuthCodes.hash("b1"), now)).isEqualTo(1);
    }
}
