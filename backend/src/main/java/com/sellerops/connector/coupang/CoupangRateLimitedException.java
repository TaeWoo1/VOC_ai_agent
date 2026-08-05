package com.sellerops.connector.coupang;

/**
 * Signals an HTTP 429 from a Coupang WING Open API call. The connector maps it to
 * a rate-limited {@link com.sellerops.connector.FetchPage} with the cursor
 * unchanged, so a retry re-requests the same window.
 *
 * <p><b>Official basis.</b> Coupang's rate-limit policy (developers.coupang.com,
 * "Introduction of Open API rate limit policy") meters per <b>vendorId</b> at
 * roughly five calls per second and returns {@code 429 Too Many Requests} when
 * exceeded; recovery is "within minutes to tens of minutes" once the rate drops.
 * The policy documents <b>no</b> {@code Retry-After} header and no per-limit-type
 * split, so — unlike the NAVER equivalent — there is a single conservative
 * fallback hint and no envelope classification (nothing is guessed).
 *
 * <p>No provider material (body, headers) is carried: the exception holds only the
 * optional numeric {@code Retry-After} the server might send and never a raw string.
 */
public class CoupangRateLimitedException extends RuntimeException {

    /**
     * Coupang's meter is per-second, but a breach is cleared over "minutes"; without
     * a server hint a full minute is the conservative earliest-retry. The scheduled
     * runner clamps rate-limit waits to ≥1 minute regardless.
     */
    static final int FALLBACK_RETRY_AFTER_SECONDS = 60;

    private final transient Integer retryAfterSeconds;

    private CoupangRateLimitedException(Integer retryAfterSeconds) {
        super("쿠팡 API 호출이 속도 제한(429)에 도달했습니다.");
        this.retryAfterSeconds = retryAfterSeconds;
    }

    /**
     * Build from a 429 response, reading only a well-formed numeric {@code Retry-After}
     * header (seconds). Any other value — absent, blank, non-numeric, or an HTTP-date —
     * yields {@code null}, and the connector falls back to {@link #FALLBACK_RETRY_AFTER_SECONDS}.
     * The response body is never read (it could carry order PII on some endpoints).
     */
    static CoupangRateLimitedException fromResponse(CoupangHttpClient.Response response) {
        return new CoupangRateLimitedException(parseRetryAfterSeconds(response));
    }

    /** The server's {@code Retry-After} in seconds, or {@code null} when none was sent. */
    public Integer retryAfterSeconds() {
        return retryAfterSeconds;
    }

    /** The earliest-retry hint: the server's value if present, else the conservative fallback. */
    public int effectiveRetryAfterSeconds() {
        return retryAfterSeconds != null ? retryAfterSeconds : FALLBACK_RETRY_AFTER_SECONDS;
    }

    private static Integer parseRetryAfterSeconds(CoupangHttpClient.Response response) {
        if (response == null) {
            return null;
        }
        return response.header("Retry-After")
                .map(String::trim)
                .filter(value -> value.matches("\\d+"))
                .map(Integer::parseInt)
                .orElse(null);
    }
}
