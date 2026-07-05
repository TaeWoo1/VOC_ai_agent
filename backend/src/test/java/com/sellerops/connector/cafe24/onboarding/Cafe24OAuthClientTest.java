package com.sellerops.connector.cafe24.onboarding;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.connector.cafe24.Cafe24TokenResult;
import java.util.Base64;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;

/**
 * The dedicated authorization-code OAuth client: consent URL shape (read-only scope,
 * per-mall host) and code→token exchange (grant, Basic auth, parse), with no secret or
 * code ever appearing in an error message.
 */
class Cafe24OAuthClientTest {

    private final RecordingCafe24HttpClient http = new RecordingCafe24HttpClient();
    private final Cafe24OAuthClient client = new Cafe24OAuthClient(http);

    @Test
    void authorizationUrlCarriesCodeGrantReadOnlyScopeAndState() {
        String url = client.authorizationUrl("samplemall", "the-client-id",
                "http://localhost:8080/api/connect/cafe24/callback", "mall.read_community,mall.read_order", "st-123");

        assertThat(url).startsWith("https://samplemall.cafe24api.com/api/v2/oauth/authorize?");
        assertThat(url).contains("response_type=code");
        assertThat(url).contains("client_id=the-client-id");
        assertThat(url).contains("state=st-123");
        assertThat(url).contains("scope=mall.read_community%2Cmall.read_order");
        assertThat(url).contains("redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Fapi%2Fconnect%2Fcafe24%2Fcallback");
        // Read-only by contract — never a write scope.
        assertThat(url).doesNotContain("write");
    }

    @Test
    void invalidMallIdIsRejectedBeforeAnyUrlOrCall() {
        assertThatThrownBy(() -> client.authorizationUrl("bad_mall!", "c", "r", "s", "st"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("mall_id")
                .hasMessageNotContaining("bad_mall!");
    }

    @Test
    void exchangeSendsAuthorizationCodeGrantWithBasicAuthAndParsesTokens() {
        http.respondWith(200, RecordingCafe24HttpClient.tokenBody("access-xyz", "refresh-abc"));

        Cafe24TokenResult result = client.exchangeAuthorizationCode(
                "samplemall", "cid", "csecret", "the-code", "http://localhost:8080/api/connect/cafe24/callback");

        assertThat(result.accessToken()).isEqualTo("access-xyz");
        assertThat(result.refreshToken()).isEqualTo("refresh-abc");

        RecordingCafe24HttpClient.Sent sent = http.posts.get(0);
        assertThat(sent.uri().toString()).isEqualTo("https://samplemall.cafe24api.com/api/v2/oauth/token");
        assertThat(sent.form()).containsEntry("grant_type", "authorization_code")
                .containsEntry("code", "the-code")
                .containsEntry("redirect_uri", "http://localhost:8080/api/connect/cafe24/callback");
        String expectedBasic = "Basic " + Base64.getEncoder()
                .encodeToString("cid:csecret".getBytes(StandardCharsets.UTF_8));
        assertThat(sent.headers()).containsEntry("Authorization", expectedBasic);
    }

    @Test
    void nonSuccessExchangeThrowsWithoutLeakingCodeOrBody() {
        http.respondWith(400, "{\"error\":\"invalid_grant\",\"access_token\":\"leak\"}");

        assertThatThrownBy(() -> client.exchangeAuthorizationCode(
                "samplemall", "cid", "csecret", "secret-code", "http://cb"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("HTTP 400")
                .hasMessageNotContaining("secret-code")
                .hasMessageNotContaining("leak");
    }

    @Test
    void aResponseMissingTheRefreshTokenIsRejected() {
        http.respondWith(200, "{\"access_token\":\"a\"}"); // no refresh_token

        assertThatThrownBy(() -> client.exchangeAuthorizationCode(
                "samplemall", "cid", "csecret", "code", "http://cb"))
                .isInstanceOf(IllegalStateException.class);
    }
}
