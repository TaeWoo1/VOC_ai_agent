package com.sellerops.connector.cafe24.spike;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.connector.cafe24.Cafe24HttpClient;
import java.net.URI;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * Verifies the spike token client parses the granted scope the production DTO drops,
 * exposing only booleans — and fails closed on a non-200 without leaking the body.
 */
class SpikeTokenClientTest {

    /** Minimal fake HTTP client returning a canned token response for the form POST. */
    private static final class FakeHttp implements Cafe24HttpClient {
        private final int status;
        private final String body;

        FakeHttp(int status, String body) {
            this.status = status;
            this.body = body;
        }

        @Override
        public Response postForm(URI uri, Map<String, String> headers, Map<String, String> form) {
            return new Response(status, body, Map.of());
        }

        @Override
        public Response get(URI uri, Map<String, String> headers) {
            throw new UnsupportedOperationException("not used");
        }
    }

    @Test
    void parsesWriteScopeFromScopesArray() {
        String body = "{\"access_token\":\"a\",\"refresh_token\":\"r\","
                + "\"scopes\":[\"mall.read_community\",\"mall.write_community\"]}";
        SpikeToken token = new SpikeTokenClient(new FakeHttp(200, body))
                .refresh("teststore", "cid", "secret", "old-refresh");
        assertThat(token.writeCommunityGranted()).isTrue();
        assertThat(token.readCommunityGranted()).isTrue();
        assertThat(token.refreshToken()).isEqualTo("r");
    }

    @Test
    void parsesReadOnlyGrantAsWriteNotGranted() {
        String body = "{\"access_token\":\"a\",\"refresh_token\":\"r\","
                + "\"scopes\":[\"mall.read_community\",\"mall.read_order\"]}";
        SpikeToken token = new SpikeTokenClient(new FakeHttp(200, body))
                .refresh("teststore", "cid", "secret", "old-refresh");
        assertThat(token.writeCommunityGranted()).isFalse();
    }

    @Test
    void supportsSpaceSeparatedScopeStringField() {
        SpikeTokenClient.TokenResponse token = new SpikeTokenClient.TokenResponse(
                "a", "r", null, "mall.read_community mall.write_community");
        assertThat(SpikeTokenClient.scopeString(token))
                .isEqualTo("mall.read_community mall.write_community");
    }

    @Test
    void failsClosedOnNon200WithoutLeakingBody() {
        assertThatThrownBy(() -> new SpikeTokenClient(new FakeHttp(401, "{\"access_token\":\"leak\"}"))
                .refresh("teststore", "cid", "secret", "old-refresh"))
                .isInstanceOf(SpikeTransportException.class)
                .satisfies(e -> assertThat(e.getMessage()).doesNotContain("leak"));
    }
}
