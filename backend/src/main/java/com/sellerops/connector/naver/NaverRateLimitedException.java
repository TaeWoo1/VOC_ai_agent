package com.sellerops.connector.naver;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * HTTP 429 from a Naver Commerce API call. The official gateway distinguishes
 * two causes by error code (intro-restriction.md / intro-troubleshooting.md):
 * {@code GW.RATE_LIMIT} (per-second token bucket exceeded) and
 * {@code GW.QUOTA_LIMIT} (per-period seller-resource quota exceeded). The cause
 * is classified into {@link LimitType} so callers can back off differently — a
 * quota breach needs a far longer wait than a one-second rate breach.
 *
 * <p>Naver sends no {@code Retry-After} header (clients back off themselves), so
 * {@link #retryAfterSeconds()} is null unless the header unexpectedly appears.
 * No request/response material (only the classified code) appears in the message.
 */
public class NaverRateLimitedException extends RuntimeException {

    /** Which 429 cause the gateway reported. */
    public enum LimitType {
        RATE_LIMIT,
        QUOTA_LIMIT,
        UNKNOWN
    }

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final Integer retryAfterSeconds;
    private final LimitType limitType;

    public NaverRateLimitedException(Integer retryAfterSeconds, LimitType limitType) {
        super("네이버 API 호출이 속도 제한되었습니다 (HTTP 429, " + limitType + ").");
        this.retryAfterSeconds = retryAfterSeconds;
        this.limitType = limitType;
    }

    /** The {@code Retry-After} hint in seconds, or null when absent (the official norm). */
    public Integer retryAfterSeconds() {
        return retryAfterSeconds;
    }

    /** The classified 429 cause; {@link LimitType#UNKNOWN} when the code is missing/unrecognized. */
    public LimitType limitType() {
        return limitType;
    }

    static NaverRateLimitedException fromResponse(NaverHttpClient.Response response) {
        Integer retryAfter = response.header("Retry-After")
                .map(NaverRateLimitedException::parseSeconds)
                .orElse(null);
        return new NaverRateLimitedException(retryAfter, classify(response.body()));
    }

    /**
     * Classify by the envelope's {@code code} only — never echo the body. The
     * official codes are {@code GW.RATE_LIMIT} and {@code GW.QUOTA_LIMIT}; an
     * unparseable or unrecognized body is {@link LimitType#UNKNOWN}.
     */
    static LimitType classify(String body) {
        if (body == null || body.isBlank()) {
            return LimitType.UNKNOWN;
        }
        try {
            JsonNode root = MAPPER.readTree(body);
            JsonNode code = root == null ? null : root.get("code");
            if (code == null || !code.isValueNode()) {
                return LimitType.UNKNOWN;
            }
            String value = code.asText();
            if (value.contains("QUOTA_LIMIT")) {
                return LimitType.QUOTA_LIMIT;
            }
            if (value.contains("RATE_LIMIT")) {
                return LimitType.RATE_LIMIT;
            }
            return LimitType.UNKNOWN;
        } catch (Exception e) {
            return LimitType.UNKNOWN;
        }
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
