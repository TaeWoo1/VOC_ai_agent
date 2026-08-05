package com.sellerops.connector.coupang;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * The 429 signal: read only a well-formed numeric {@code Retry-After}; anything else falls back to the
 * conservative minute (Coupang documents no Retry-After and clears a breach over minutes).
 */
class CoupangRateLimitedExceptionTest {

    private static CoupangHttpClient.Response resp(Map<String, String> headers) {
        return new CoupangHttpClient.Response(429, "{\"code\":429}", headers);
    }

    @Test
    void readsNumericRetryAfterSeconds() {
        CoupangRateLimitedException e = CoupangRateLimitedException.fromResponse(resp(Map.of("Retry-After", "45")));
        assertThat(e.retryAfterSeconds()).isEqualTo(45);
        assertThat(e.effectiveRetryAfterSeconds()).isEqualTo(45);
    }

    @Test
    void fallsBackToAMinuteWhenHeaderAbsentOrNonNumeric() {
        assertThat(CoupangRateLimitedException.fromResponse(resp(Map.of())).retryAfterSeconds()).isNull();
        assertThat(CoupangRateLimitedException.fromResponse(resp(Map.of("Retry-After", "Wed, 21 Oct"))).retryAfterSeconds())
                .isNull();
        assertThat(CoupangRateLimitedException.fromResponse(resp(Map.of())).effectiveRetryAfterSeconds())
                .isEqualTo(CoupangRateLimitedException.FALLBACK_RETRY_AFTER_SECONDS);
    }

    @Test
    void neverThrowsAndCarriesNoProviderBody() {
        // Construction reads only the header; the body is never surfaced.
        CoupangRateLimitedException e = CoupangRateLimitedException.fromResponse(resp(Map.of("Retry-After", "10")));
        assertThat(e.getMessage()).doesNotContain("429}").contains("속도 제한");
    }
}
