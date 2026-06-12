package com.sellerops.connector.naver;

/**
 * HTTP 429 from a Naver Commerce API call. Naver officially sends no
 * {@code Retry-After} header (commerce-api discussion #1538 — clients are told
 * to back off exponentially), so {@link #retryAfterSeconds()} is null unless
 * the header unexpectedly appears; callers choose their own conservative hint
 * for the null case. The message carries no request/response material.
 */
public class NaverRateLimitedException extends RuntimeException {

    private final Integer retryAfterSeconds;

    public NaverRateLimitedException(Integer retryAfterSeconds) {
        super("네이버 API 호출이 속도 제한되었습니다 (HTTP 429).");
        this.retryAfterSeconds = retryAfterSeconds;
    }

    /** The {@code Retry-After} hint in seconds, or null when absent (the official norm). */
    public Integer retryAfterSeconds() {
        return retryAfterSeconds;
    }

    static NaverRateLimitedException fromResponse(NaverHttpClient.Response response) {
        Integer retryAfter = response.header("Retry-After")
                .map(NaverRateLimitedException::parseSeconds)
                .orElse(null);
        return new NaverRateLimitedException(retryAfter);
    }

    private static Integer parseSeconds(String value) {
        try {
            int seconds = Integer.parseInt(value.trim());
            return seconds > 0 ? seconds : null;
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
