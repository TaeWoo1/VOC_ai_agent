package com.sellerops.connector.naver;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.connector.naver.NaverRateLimitedException.LimitType;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * Classifying the two official 429 causes by error code (intro-troubleshooting.md):
 * GW.RATE_LIMIT vs GW.QUOTA_LIMIT, with unknown/garbage tolerated. The body is
 * only inspected for {@code code}; nothing from it appears in the message.
 */
class NaverRateLimitedExceptionTest {

    private static NaverHttpClient.Response body429(String json) {
        return new NaverHttpClient.Response(429, json, Map.of());
    }

    @Test
    void rateLimitCodeClassifiesAsRateLimit() {
        NaverRateLimitedException e = NaverRateLimitedException.fromResponse(
                body429("{\"code\":\"GW.RATE_LIMIT\",\"message\":\"요청이 많습니다.\"}"));

        assertThat(e.limitType()).isEqualTo(LimitType.RATE_LIMIT);
    }

    @Test
    void quotaLimitCodeClassifiesAsQuotaLimit() {
        NaverRateLimitedException e = NaverRateLimitedException.fromResponse(
                body429("{\"code\":\"GW.QUOTA_LIMIT\",\"message\":\"할당량 초과\"}"));

        assertThat(e.limitType()).isEqualTo(LimitType.QUOTA_LIMIT);
    }

    @Test
    void unrecognizedOrMissingCodeClassifiesAsUnknown() {
        assertThat(NaverRateLimitedException.fromResponse(body429("{\"code\":\"GW.SOMETHING\"}")).limitType())
                .isEqualTo(LimitType.UNKNOWN);
        assertThat(NaverRateLimitedException.fromResponse(body429("{}")).limitType())
                .isEqualTo(LimitType.UNKNOWN);
        assertThat(NaverRateLimitedException.fromResponse(body429("not-json")).limitType())
                .isEqualTo(LimitType.UNKNOWN);
    }

    @Test
    void retryAfterHeaderStillHonoredAlongsideClassification() {
        NaverRateLimitedException e = NaverRateLimitedException.fromResponse(
                new NaverHttpClient.Response(429,
                        "{\"code\":\"GW.QUOTA_LIMIT\"}", Map.of("retry-after", "30")));

        assertThat(e.retryAfterSeconds()).isEqualTo(30);
        assertThat(e.limitType()).isEqualTo(LimitType.QUOTA_LIMIT);
    }

    @Test
    void messageNeverEchoesTheResponseBody() {
        NaverRateLimitedException e = NaverRateLimitedException.fromResponse(
                body429("{\"code\":\"GW.RATE_LIMIT\",\"message\":\"secret-trace-id-xyz\"}"));

        assertThat(e.getMessage()).doesNotContain("secret-trace-id-xyz");
    }
}
