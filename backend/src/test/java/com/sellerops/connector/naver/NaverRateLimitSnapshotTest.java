package com.sellerops.connector.naver;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * Parsing the official rate/quota headers (intro-restriction.md) into safe
 * metadata: numeric fields parsed, absent/garbage tolerated, exhaustion detected.
 */
class NaverRateLimitSnapshotTest {

    private static NaverHttpClient.Response response(Map<String, String> headers) {
        return new NaverHttpClient.Response(200, "{}", headers);
    }

    @Test
    void parsesAllRateAndQuotaHeaders() {
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("GNCP-GW-RateLimit-Replenish-Rate", "2");
        headers.put("GNCP-GW-RateLimit-Burst-Capacity", "4");
        headers.put("GNCP-GW-RateLimit-Remaining", "1");
        headers.put("GNCP-GW-Quota-Period", "SECONDS");
        headers.put("GNCP-GW-Quota-Limit", "1000");
        headers.put("GNCP-GW-Quota-Remaining", "950");

        NaverRateLimitSnapshot snapshot = NaverRateLimitSnapshot.from(response(headers));

        assertThat(snapshot.replenishRate()).isEqualTo(2);
        assertThat(snapshot.burstCapacity()).isEqualTo(4);
        assertThat(snapshot.remaining()).isEqualTo(1);
        assertThat(snapshot.quotaPeriod()).isEqualTo("SECONDS");
        assertThat(snapshot.quotaLimit()).isEqualTo(1000);
        assertThat(snapshot.quotaRemaining()).isEqualTo(950);
        assertThat(snapshot.isExhausted()).isFalse();
    }

    @Test
    void headerLookupIsCaseInsensitive() {
        NaverRateLimitSnapshot snapshot = NaverRateLimitSnapshot.from(
                response(Map.of("gncp-gw-ratelimit-remaining", "3")));

        assertThat(snapshot.remaining()).isEqualTo(3);
    }

    @Test
    void absentHeadersYieldTheEmptySnapshot() {
        NaverRateLimitSnapshot snapshot = NaverRateLimitSnapshot.from(response(Map.of()));

        assertThat(snapshot).isSameAs(NaverRateLimitSnapshot.EMPTY);
        assertThat(snapshot.isExhausted()).isFalse();
        assertThat(snapshot.hasAnyData()).isFalse();
    }

    @Test
    void nonNumericHeaderValuesBecomeNullNotErrors() {
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("GNCP-GW-RateLimit-Remaining", "not-a-number");
        headers.put("GNCP-GW-Quota-Period", "ROUND");

        NaverRateLimitSnapshot snapshot = NaverRateLimitSnapshot.from(response(headers));

        assertThat(snapshot.remaining()).isNull();
        assertThat(snapshot.quotaPeriod()).isEqualTo("ROUND");
    }

    @Test
    void zeroRateRemainingIsExhausted() {
        NaverRateLimitSnapshot snapshot = NaverRateLimitSnapshot.from(
                response(Map.of("GNCP-GW-RateLimit-Remaining", "0")));

        assertThat(snapshot.isExhausted()).isTrue();
    }

    @Test
    void zeroQuotaRemainingIsExhausted() {
        NaverRateLimitSnapshot snapshot = NaverRateLimitSnapshot.from(
                response(Map.of("GNCP-GW-Quota-Remaining", "0")));

        assertThat(snapshot.isExhausted()).isTrue();
    }
}
