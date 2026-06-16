package com.sellerops.connector.naver;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.bcrypt.BCrypt;

/**
 * Slice 1a: token/signature client against the fake HTTP boundary — signature
 * shape, confirmed form fields, cache/expiry behavior, and the guarantee that
 * no failure path leaks secret material. No test touches the network.
 */
class NaverTokenClientTest {

    private static final String BASE_URL = "https://fake.naver.test";
    private static final Instant T0 = Instant.parse("2026-06-12T00:00:00Z");
    private static final String CLIENT_ID = "test-client-id";
    /** Naver-issued client secrets are bcrypt salts; generate a real one. */
    private static final String CLIENT_SECRET = BCrypt.gensalt();

    /** Minimal mutable clock so expiry behavior is tested deterministically. */
    static final class SettableClock extends Clock {
        private Instant now;

        SettableClock(Instant start) {
            this.now = start;
        }

        void advanceSeconds(long seconds) {
            now = now.plusSeconds(seconds);
        }

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    }

    private final FakeNaverHttpClient http = new FakeNaverHttpClient();
    private final SettableClock clock = new SettableClock(T0);
    private final NaverTokenClient client = new NaverTokenClient(http, clock, BASE_URL);

    @Test
    void signatureIsDeterministicAndBcryptVerifiable() {
        long timestamp = T0.toEpochMilli();

        String first = NaverTokenClient.signature(CLIENT_ID, CLIENT_SECRET, timestamp);
        String second = NaverTokenClient.signature(CLIENT_ID, CLIENT_SECRET, timestamp);

        assertThat(first).isEqualTo(second);
        // The confirmed construction: bcrypt(client_id + "_" + timestamp_ms,
        // salt = client_secret), Base64-encoded — verifiable with bcrypt itself.
        String hashed = new String(Base64.getDecoder().decode(first), StandardCharsets.UTF_8);
        assertThat(BCrypt.checkpw(CLIENT_ID + "_" + timestamp, hashed)).isTrue();
    }

    // --- verify(): live, no-cache, status-aware auth check (test-connection) ---

    @Test
    void verifyReturnsOkWhenTokenMints() {
        http.enqueue(FakeNaverHttpClient.tokenOk("token-1", 3000));
        assertThat(client.verify(CLIENT_ID, CLIENT_SECRET)).isEqualTo(NaverTokenClient.AuthCheck.OK);
    }

    @Test
    void verifyReturnsInvalidOnFourXxOtherThan429() {
        for (int status : new int[] {400, 401, 403}) {
            FakeNaverHttpClient h = new FakeNaverHttpClient();
            NaverTokenClient c = new NaverTokenClient(h, clock, BASE_URL);
            h.enqueue(new NaverHttpClient.Response(status, "{\"code\":\"X\"}", Map.of()));
            assertThat(c.verify(CLIENT_ID, CLIENT_SECRET))
                    .as("HTTP %d → INVALID", status)
                    .isEqualTo(NaverTokenClient.AuthCheck.INVALID);
        }
    }

    @Test
    void verifyReturnsRateLimitedOn429() {
        http.enqueue(FakeNaverHttpClient.rateLimited429());
        assertThat(client.verify(CLIENT_ID, CLIENT_SECRET))
                .isEqualTo(NaverTokenClient.AuthCheck.RATE_LIMITED);
    }

    @Test
    void verifyReturnsUnavailableOn5xx() {
        http.enqueue(new NaverHttpClient.Response(500, "{}", Map.of()));
        assertThat(client.verify(CLIENT_ID, CLIENT_SECRET))
                .isEqualTo(NaverTokenClient.AuthCheck.UNAVAILABLE);
    }

    @Test
    void verifyReturnsUnavailableOnNetworkError() {
        http.enqueueNetworkFailure();
        assertThat(client.verify(CLIENT_ID, CLIENT_SECRET))
                .isEqualTo(NaverTokenClient.AuthCheck.UNAVAILABLE);
    }

    @Test
    void verifyReturnsUnavailableOnUnreadable200Body() {
        http.enqueue(FakeNaverHttpClient.ok("{\"not\":\"a token\"}"));
        assertThat(client.verify(CLIENT_ID, CLIENT_SECRET))
                .isEqualTo(NaverTokenClient.AuthCheck.UNAVAILABLE);
    }

    @Test
    void verifyDoesNotCacheAndMintsEveryCall() {
        http.enqueue(FakeNaverHttpClient.tokenOk("token-1", 3000));
        http.enqueue(FakeNaverHttpClient.tokenOk("token-2", 3000));

        assertThat(client.verify(CLIENT_ID, CLIENT_SECRET)).isEqualTo(NaverTokenClient.AuthCheck.OK);
        assertThat(client.verify(CLIENT_ID, CLIENT_SECRET)).isEqualTo(NaverTokenClient.AuthCheck.OK);

        // Unlike accessToken(), verify never reads or writes the cache — a live check each time.
        assertThat(http.sent).hasSize(2);
    }

    @Test
    void verifyReturnsInvalidOnBadSaltWithoutHttp() {
        assertThat(client.verify(CLIENT_ID, "not-a-bcrypt-salt"))
                .isEqualTo(NaverTokenClient.AuthCheck.INVALID);
        // The signature fails before any request — fail closed, zero HTTP.
        assertThat(http.sent).isEmpty();
    }

    @Test
    void tokenRequestUsesConfirmedEndpointAndFormShape() {
        http.enqueue(FakeNaverHttpClient.tokenOk("token-1", 3000));

        client.accessToken(CLIENT_ID, CLIENT_SECRET);

        FakeNaverHttpClient.Sent request = http.sent.get(0);
        assertThat(request.uri()).isEqualTo(URI.create(BASE_URL + "/external/v1/oauth2/token"));
        Map<String, String> form = request.form();
        assertThat(form.keySet()).containsExactlyInAnyOrder(
                "client_id", "timestamp", "client_secret_sign", "grant_type", "type");
        assertThat(form.get("client_id")).isEqualTo(CLIENT_ID);
        assertThat(form.get("grant_type")).isEqualTo("client_credentials");
        assertThat(form.get("type")).isEqualTo("SELF");
        // The signed timestamp and the sent timestamp must be the same value.
        long timestamp = Long.parseLong(form.get("timestamp"));
        assertThat(timestamp).isEqualTo(T0.toEpochMilli());
        assertThat(form.get("client_secret_sign"))
                .isEqualTo(NaverTokenClient.signature(CLIENT_ID, CLIENT_SECRET, timestamp));
    }

    @Test
    void tokenIsCachedUntilExpiryMinusSkew() {
        http.enqueue(FakeNaverHttpClient.tokenOk("token-1", 1000));

        assertThat(client.accessToken(CLIENT_ID, CLIENT_SECRET)).isEqualTo("token-1");
        // Just before expires_in(1000s) - skew(60s): still served from cache.
        clock.advanceSeconds(939);
        assertThat(client.accessToken(CLIENT_ID, CLIENT_SECRET)).isEqualTo("token-1");

        assertThat(http.sent).hasSize(1);
    }

    @Test
    void expiredTokenIsReMinted() {
        http.enqueue(FakeNaverHttpClient.tokenOk("token-1", 1000));
        http.enqueue(FakeNaverHttpClient.tokenOk("token-2", 1000));

        client.accessToken(CLIENT_ID, CLIENT_SECRET);
        // Crossing expires_in - skew forces a fresh mint.
        clock.advanceSeconds(941);
        assertThat(client.accessToken(CLIENT_ID, CLIENT_SECRET)).isEqualTo("token-2");

        assertThat(http.sent).hasSize(2);
    }

    @Test
    void malformedTokenResponseFailsWithoutSecretMaterial() {
        http.enqueue(new NaverHttpClient.Response(200, "{\"unexpected\":\"shape\"}", Map.of()));

        assertThatThrownBy(() -> client.accessToken(CLIENT_ID, CLIENT_SECRET))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageNotContaining(CLIENT_SECRET)
                .hasMessageNotContaining("unexpected");
    }

    @Test
    void nonJsonTokenResponseFailsWithoutBodyInMessage() {
        http.enqueue(new NaverHttpClient.Response(200, "<html>gateway error</html>", Map.of()));

        assertThatThrownBy(() -> client.accessToken(CLIENT_ID, CLIENT_SECRET))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageNotContaining(CLIENT_SECRET)
                .hasMessageNotContaining("gateway");
    }

    @Test
    void rateLimited429ThrowsWithNullHintWhenNoRetryAfterHeader() {
        http.enqueue(FakeNaverHttpClient.rateLimited429());

        assertThatThrownBy(() -> client.accessToken(CLIENT_ID, CLIENT_SECRET))
                .isInstanceOf(NaverRateLimitedException.class)
                .extracting(e -> ((NaverRateLimitedException) e).retryAfterSeconds())
                .isNull();
    }

    @Test
    void rateLimited429HonorsRetryAfterHeaderWhenPresent() {
        http.enqueue(new NaverHttpClient.Response(429,
                "{\"code\":\"GW.RATE_LIMIT\"}", Map.of("retry-after", "3")));

        assertThatThrownBy(() -> client.accessToken(CLIENT_ID, CLIENT_SECRET))
                .isInstanceOf(NaverRateLimitedException.class)
                .extracting(e -> ((NaverRateLimitedException) e).retryAfterSeconds())
                .isEqualTo(3);
    }

    @Test
    void nonBcryptSaltSecretFailsClosedBeforeAnyHttp() {
        assertThatThrownBy(() -> client.accessToken(CLIENT_ID, "not-a-bcrypt-salt"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageNotContaining("not-a-bcrypt-salt");

        assertThat(http.sent).isEmpty();
    }

    @Test
    void rotatedSecretMintsFreshTokenImmediately() {
        http.enqueue(FakeNaverHttpClient.tokenOk("token-old-secret", 3000));
        http.enqueue(FakeNaverHttpClient.tokenOk("token-new-secret", 3000));

        assertThat(client.accessToken(CLIENT_ID, CLIENT_SECRET)).isEqualTo("token-old-secret");
        // Same client id, rotated secret: the stale cached token must not be served.
        assertThat(client.accessToken(CLIENT_ID, BCrypt.gensalt())).isEqualTo("token-new-secret");
        assertThat(http.sent).hasSize(2);
    }

    @Test
    void nonPositiveExpiresInIsRejectedAsMalformed() {
        http.enqueue(FakeNaverHttpClient.tokenOk("token-1", 0));

        assertThatThrownBy(() -> client.accessToken(CLIENT_ID, CLIENT_SECRET))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageNotContaining(CLIENT_SECRET)
                .hasMessageNotContaining("token-1");
    }

    @Test
    void subSkewTtlTokenIsServedOnceButNeverCached() {
        http.enqueue(FakeNaverHttpClient.tokenOk("token-1", 30)); // < 60s skew
        http.enqueue(FakeNaverHttpClient.tokenOk("token-2", 30));

        assertThat(client.accessToken(CLIENT_ID, CLIENT_SECRET)).isEqualTo("token-1");
        // Caching it would store an already-expired entry; the next call re-mints.
        assertThat(client.accessToken(CLIENT_ID, CLIENT_SECRET)).isEqualTo("token-2");
        assertThat(http.sent).hasSize(2);
    }

    @Test
    void failedMintIsNotCached() {
        http.enqueue(new NaverHttpClient.Response(500, "{}", Map.of()));
        http.enqueue(FakeNaverHttpClient.tokenOk("token-after-failure", 1000));

        assertThatThrownBy(() -> client.accessToken(CLIENT_ID, CLIENT_SECRET))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("HTTP 500");
        assertThat(client.accessToken(CLIENT_ID, CLIENT_SECRET)).isEqualTo("token-after-failure");
    }
}
