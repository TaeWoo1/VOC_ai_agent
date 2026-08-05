package com.sellerops.connector.cafe24;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * Phase 3D-3: the refresh-token grant against the officially documented shape
 * (developers.cafe24.com, verified 2026-06-12) — per-mall token URL, Basic
 * client authentication, grant_type=refresh_token form, expires_at (datetime)
 * response fields, single-use rotation surfaced via {@link Cafe24TokenResult}.
 * All offline via the recording fake.
 */
class Cafe24TokenClientTest {

    private static final String MALL_ID = "samplemall";
    private static final String CLIENT_ID = "test-client-id";
    private static final String CLIENT_SECRET = "test-client-secret";
    private static final String OLD_REFRESH = "old-refresh-token";

    private final FakeCafe24HttpClient http = new FakeCafe24HttpClient();
    private final Cafe24TokenClient client = new Cafe24TokenClient(http);

    @Test
    void buildsTheMallSpecificTokenUrl() {
        http.enqueue(FakeCafe24HttpClient.tokenOk("at-1", "rt-1"));

        client.refresh(MALL_ID, CLIENT_ID, CLIENT_SECRET, OLD_REFRESH);

        assertThat(http.sent).hasSize(1);
        assertThat(http.sent.get(0).uri())
                .hasToString("https://samplemall.cafe24api.com/api/v2/oauth/token");
    }

    @Test
    void sendsTheOfficialBasicAuthAndRefreshGrantForm() {
        http.enqueue(FakeCafe24HttpClient.tokenOk("at-1", "rt-1"));

        client.refresh(MALL_ID, CLIENT_ID, CLIENT_SECRET, OLD_REFRESH);

        FakeCafe24HttpClient.Sent sent = http.sent.get(0);
        // Authorization: Basic base64(client_id:client_secret) — decoded and
        // verified rather than string-matched against the implementation.
        String authorization = sent.headers().get("Authorization");
        assertThat(authorization).startsWith("Basic ");
        String decoded = new String(
                Base64.getDecoder().decode(authorization.substring("Basic ".length())),
                StandardCharsets.UTF_8);
        assertThat(decoded).isEqualTo(CLIENT_ID + ":" + CLIENT_SECRET);
        // Official body: grant_type + refresh_token, nothing else (the client
        // pair authenticates via the header, not the form).
        assertThat(sent.form()).containsExactlyInAnyOrderEntriesOf(Map.of(
                "grant_type", "refresh_token",
                "refresh_token", OLD_REFRESH));
    }

    @Test
    void parsesAccessTokenAndRotatedRefreshToken() {
        http.enqueue(FakeCafe24HttpClient.tokenOk("at-new", "rt-new"));

        Cafe24TokenResult result = client.refresh(MALL_ID, CLIENT_ID, CLIENT_SECRET, OLD_REFRESH);

        assertThat(result.accessToken()).isEqualTo("at-new");
        assertThat(result.refreshToken()).isEqualTo("rt-new");
        assertThat(result.rotatedFrom(OLD_REFRESH)).isTrue();
        assertThat(result.expiresAt()).isEqualTo("2026-06-12T15:50:00.000");
        assertThat(result.refreshTokenExpiresAt()).isEqualTo("2026-06-26T13:50:00.000");
    }

    @Test
    void sameRefreshTokenEchoedBackIsNotARotation() {
        http.enqueue(FakeCafe24HttpClient.tokenOk("at-new", OLD_REFRESH));

        Cafe24TokenResult result = client.refresh(MALL_ID, CLIENT_ID, CLIENT_SECRET, OLD_REFRESH);

        assertThat(result.rotatedFrom(OLD_REFRESH)).isFalse();
    }

    @Test
    void responseWithoutRefreshTokenIsNotARotation() {
        http.enqueue(new Cafe24HttpClient.Response(200,
                "{\"access_token\":\"at-new\",\"expires_at\":\"2026-06-12T15:50:00.000\"}",
                Map.of()));

        Cafe24TokenResult result = client.refresh(MALL_ID, CLIENT_ID, CLIENT_SECRET, OLD_REFRESH);

        assertThat(result.accessToken()).isEqualTo("at-new");
        assertThat(result.refreshToken()).isNull();
        assertThat(result.rotatedFrom(OLD_REFRESH)).isFalse();
    }

    @Test
    void invalidGrantIsClassifiedWithoutLeakingTheBody() {
        // A dead/revoked refresh token → RFC 6749 invalid_grant → reconnect. The message carries
        // only the HTTP status and the standard code, never the (possibly token-bearing) body.
        http.enqueue(new Cafe24HttpClient.Response(401,
                "{\"error\":\"invalid_grant\",\"error_description\":\"" + OLD_REFRESH + "\"}", Map.of()));

        assertThatThrownBy(() -> client.refresh(MALL_ID, CLIENT_ID, CLIENT_SECRET, OLD_REFRESH))
                .isInstanceOf(Cafe24OAuthException.class)
                .satisfies(e -> {
                    assertThat(((Cafe24OAuthException) e).kind())
                            .isEqualTo(Cafe24OAuthException.Kind.INVALID_GRANT);
                    assertThat(((Cafe24OAuthException) e).statusCode()).isEqualTo(401);
                })
                .hasMessageNotContaining(OLD_REFRESH);
    }

    @Test
    void insufficientScopeIsClassifiedDistinctlyFromInvalidGrant() {
        // Both invalid_scope and insufficient_scope (RFC 6749 / RFC 6750) map to INSUFFICIENT_SCOPE.
        for (String code : new String[] {"invalid_scope", "insufficient_scope"}) {
            http.enqueue(new Cafe24HttpClient.Response(403,
                    "{\"error\":\"" + code + "\"}", Map.of()));

            assertThatThrownBy(() -> client.refresh(MALL_ID, CLIENT_ID, CLIENT_SECRET, OLD_REFRESH))
                    .isInstanceOf(Cafe24OAuthException.class)
                    .satisfies(e -> assertThat(((Cafe24OAuthException) e).kind())
                            .isEqualTo(Cafe24OAuthException.Kind.INSUFFICIENT_SCOPE));
        }
    }

    @Test
    void unrecognizedOrMissingErrorCodeIsUnknownNotGuessed() {
        // A non-standard / absent error value must NOT be force-fit to a known kind — it stays
        // UNKNOWN so downstream treats it as a generic provider failure (assumes nothing).
        for (String body : new String[] {
                "{\"error\":\"some_cafe24_specific_code\"}", "{\"message\":\"nope\"}", "not-json"}) {
            http.enqueue(new Cafe24HttpClient.Response(400, body, Map.of()));

            assertThatThrownBy(() -> client.refresh(MALL_ID, CLIENT_ID, CLIENT_SECRET, OLD_REFRESH))
                    .isInstanceOf(Cafe24OAuthException.class)
                    .satisfies(e -> assertThat(((Cafe24OAuthException) e).kind())
                            .isEqualTo(Cafe24OAuthException.Kind.UNKNOWN));
        }
    }

    @Test
    void malformedResponseFailsWithoutLeakingTheBody() {
        http.enqueue(new Cafe24HttpClient.Response(200, "not-json " + OLD_REFRESH, Map.of()));

        assertThatThrownBy(() -> client.refresh(MALL_ID, CLIENT_ID, CLIENT_SECRET, OLD_REFRESH))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("카페24 인증 토큰 응답을 해석할 수 없습니다.");
    }

    @Test
    void blankAccessTokenIsAMalformedResponse() {
        http.enqueue(new Cafe24HttpClient.Response(200,
                "{\"access_token\":\"\",\"refresh_token\":\"rt-new\"}", Map.of()));

        assertThatThrownBy(() -> client.refresh(MALL_ID, CLIENT_ID, CLIENT_SECRET, OLD_REFRESH))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("카페24 인증 토큰 응답을 해석할 수 없습니다.");
    }

    @Test
    void rateLimitedRefreshCarriesTheOfficialResumptionHint() {
        http.enqueue(FakeCafe24HttpClient.rateLimited429("7"));

        assertThatThrownBy(() -> client.refresh(MALL_ID, CLIENT_ID, CLIENT_SECRET, OLD_REFRESH))
                .isInstanceOf(Cafe24RateLimitedException.class)
                .satisfies(e -> assertThat(((Cafe24RateLimitedException) e).retryAfterSeconds())
                        .isEqualTo(7));
    }

    @Test
    void rateLimitedWithoutHintCarriesNull() {
        http.enqueue(FakeCafe24HttpClient.rateLimited429(null));

        assertThatThrownBy(() -> client.refresh(MALL_ID, CLIENT_ID, CLIENT_SECRET, OLD_REFRESH))
                .isInstanceOf(Cafe24RateLimitedException.class)
                .satisfies(e -> assertThat(((Cafe24RateLimitedException) e).retryAfterSeconds())
                        .isNull());
    }

    @Test
    void malformedMallIdFailsClosedBeforeAnyHttp() {
        // mall_id becomes the hostname — a value that could redirect the
        // request anywhere must be rejected with zero HTTP and no echo.
        for (String bad : new String[] {null, "", "evil.example.com", "mall/../x", "MALL", "a b"}) {
            assertThatThrownBy(() -> client.refresh(bad, CLIENT_ID, CLIENT_SECRET, OLD_REFRESH))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessage("카페24 mall_id 형식이 올바르지 않습니다.");
        }
        assertThat(http.sent).isEmpty();
    }
}
