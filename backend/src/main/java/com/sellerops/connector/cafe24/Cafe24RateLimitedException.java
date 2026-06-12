package com.sellerops.connector.cafe24;

/**
 * HTTP 429 from a Cafe24 endpoint (official leaky bucket: capacity 40, drains
 * 2/sec per mall). {@code retryAfterSeconds} comes from the official
 * {@code X-Cafe24-Call-Remain} header — seconds until calls resume, sent when
 * usage reaches 100% — and is null when absent or unreadable.
 */
public class Cafe24RateLimitedException extends RuntimeException {

    private final Integer retryAfterSeconds;

    Cafe24RateLimitedException(Integer retryAfterSeconds) {
        super("카페24 API 속도 제한에 도달했습니다 (HTTP 429).");
        this.retryAfterSeconds = retryAfterSeconds;
    }

    public Integer retryAfterSeconds() {
        return retryAfterSeconds;
    }

    static Cafe24RateLimitedException fromResponse(Cafe24HttpClient.Response response) {
        Integer hint = response.header("X-Cafe24-Call-Remain")
                .map(value -> {
                    try {
                        int seconds = (int) Math.ceil(Double.parseDouble(value.trim()));
                        return seconds > 0 ? seconds : null;
                    } catch (NumberFormatException e) {
                        return null;
                    }
                })
                .orElse(null);
        return new Cafe24RateLimitedException(hint);
    }
}
