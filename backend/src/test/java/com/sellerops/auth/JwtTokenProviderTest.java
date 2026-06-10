package com.sellerops.auth;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.UUID;
import org.junit.jupiter.api.Test;

/** Pure unit test — no Spring context / DB required, so `gradle test` runs offline. */
class JwtTokenProviderTest {

    private final JwtTokenProvider provider =
            new JwtTokenProvider("test-secret-test-secret-test-secret-1234567890", 60);

    @Test
    void roundTripsUserAndOrg() {
        UUID userId = UUID.randomUUID();
        UUID orgId = UUID.randomUUID();
        String token = provider.createToken(userId, orgId, "demo@sellerops.ai");

        AuthPrincipal principal = provider.parse(token);

        assertThat(principal).isNotNull();
        assertThat(principal.userId()).isEqualTo(userId);
        assertThat(principal.orgId()).isEqualTo(orgId);
        assertThat(principal.email()).isEqualTo("demo@sellerops.ai");
    }

    @Test
    void returnsNullForGarbageToken() {
        assertThat(provider.parse("not-a-real-token")).isNull();
    }
}
