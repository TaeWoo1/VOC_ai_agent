package com.sellerops.connector.esm.inquiry;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.connector.esm.EsmHttpClient;
import java.time.Instant;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * Unit tests for the HTTP-standard 429 hardening. All synthetic; no live call,
 * no real credential. Verifies standard {@code Retry-After} parsing (both forms)
 * and that no response body leaks into the message.
 */
class EsmInquiryRateLimitedExceptionTest {

    private static EsmHttpClient.Response resp429(Map<String, String> headers, String body) {
        return new EsmHttpClient.Response(429, body, headers);
    }

    @Test
    void noRetryAfterHeaderYieldsNoHint() {
        EsmInquiryRateLimitedException e = EsmInquiryRateLimitedException.fromResponse(
                resp429(Map.of(), "{}"));

        assertThat(e.retryAfterSeconds()).isNull();
        assertThat(e.retryAfterAt()).isEmpty();
        assertThat(e.retryAfterSeconds(Instant.parse("2026-06-29T00:00:00Z"))).isEmpty();
    }

    @Test
    void numericRetryAfterParsesToSeconds() {
        EsmInquiryRateLimitedException e = EsmInquiryRateLimitedException.fromResponse(
                resp429(Map.of("Retry-After", "120"), "{}"));

        assertThat(e.retryAfterSeconds()).isEqualTo(120);
        assertThat(e.retryAfterAt()).isEmpty();
        // delta-seconds is reference-independent.
        assertThat(e.retryAfterSeconds(Instant.parse("2026-06-29T00:00:00Z"))).contains(120L);
    }

    @Test
    void httpDateRetryAfterParsesToAbsoluteInstantAndDeltaFromReference() {
        EsmInquiryRateLimitedException e = EsmInquiryRateLimitedException.fromResponse(
                resp429(Map.of("Retry-After", "Wed, 21 Oct 2026 07:28:00 GMT"), "{}"));

        assertThat(e.retryAfterSeconds()).isNull();
        assertThat(e.retryAfterAt()).contains(Instant.parse("2026-10-21T07:28:00Z"));
        // 90s before the target => 90s wait, computed from an explicit reference time.
        assertThat(e.retryAfterSeconds(Instant.parse("2026-10-21T07:26:30Z"))).contains(90L);
        // A reference already past the target clamps to 0 (never negative).
        assertThat(e.retryAfterSeconds(Instant.parse("2026-10-21T08:00:00Z"))).contains(0L);
    }

    @Test
    void invalidRetryAfterDegradesToNoHintWithoutThrowing() {
        EsmInquiryRateLimitedException e = EsmInquiryRateLimitedException.fromResponse(
                resp429(Map.of("Retry-After", "soon-ish"), "{}"));

        assertThat(e.retryAfterSeconds()).isNull();
        assertThat(e.retryAfterAt()).isEmpty();
    }

    @Test
    void messageNeverEchoesResponseBody() {
        EsmInquiryRateLimitedException e = EsmInquiryRateLimitedException.fromResponse(
                resp429(Map.of("Retry-After", "30"),
                        "{\"trace\":\"secret-marker-9999\",\"buyer\":\"홍길동\"}"));

        assertThat(e.getMessage()).contains("429");
        assertThat(e.getMessage()).doesNotContain("secret-marker-9999");
        assertThat(e.getMessage()).doesNotContain("홍길동");
    }
}
