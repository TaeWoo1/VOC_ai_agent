package com.sellerops.connector.cafe24;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.URI;
import org.junit.jupiter.api.Test;

/**
 * The transport's Admin-API version pinning: blank fails closed, and the
 * {@code X-Cafe24-Api-Version} header is attached to admin (v2) data calls only
 * — never to the OAuth token/authorize endpoints. Pure logic (no network).
 */
class JdkCafe24HttpClientTest {

    private static final String VERSION = "2025-12-01";
    private static final URI ORDERS = URI.create("https://samplemall.cafe24api.com/api/v2/admin/orders");
    private static final URI BOARDS = URI.create("https://samplemall.cafe24api.com/api/v2/admin/boards");
    private static final URI ARTICLES =
            URI.create("https://samplemall.cafe24api.com/api/v2/admin/boards/6/articles");
    private static final URI TOKEN = URI.create("https://samplemall.cafe24api.com/api/v2/oauth/token");
    private static final URI AUTHORIZE = URI.create("https://samplemall.cafe24api.com/api/v2/oauth/authorize");

    @Test
    void blankApiVersionFailsClosed() {
        assertThatThrownBy(() -> new JdkCafe24HttpClient(""))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("API 버전");
        assertThatThrownBy(() -> new JdkCafe24HttpClient(null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("API 버전");
        assertThatThrownBy(() -> new JdkCafe24HttpClient("   "))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void validApiVersionConstructs() {
        assertThatCode(() -> new JdkCafe24HttpClient(VERSION)).doesNotThrowAnyException();
    }

    @Test
    void adminDataCallsCarryTheVersionHeader() {
        for (URI admin : new URI[] {ORDERS, BOARDS, ARTICLES}) {
            assertThat(JdkCafe24HttpClient.requiresApiVersion(admin)).as("%s", admin).isTrue();
            assertThat(JdkCafe24HttpClient.apiVersionHeader(admin, VERSION))
                    .containsExactlyEntriesOf(java.util.Map.of(
                            JdkCafe24HttpClient.API_VERSION_HEADER, VERSION));
        }
    }

    @Test
    void oauthEndpointsOmitTheVersionHeader() {
        for (URI oauth : new URI[] {TOKEN, AUTHORIZE}) {
            assertThat(JdkCafe24HttpClient.requiresApiVersion(oauth)).as("%s", oauth).isFalse();
            assertThat(JdkCafe24HttpClient.apiVersionHeader(oauth, VERSION)).isEmpty();
        }
    }
}
