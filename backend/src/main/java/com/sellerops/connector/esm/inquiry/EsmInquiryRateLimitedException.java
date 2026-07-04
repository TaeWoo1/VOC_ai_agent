package com.sellerops.connector.esm.inquiry;

import com.sellerops.connector.esm.EsmHttpClient;
import java.time.Duration;
import java.time.Instant;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Optional;

/**
 * HTTP 429 (Too Many Requests) from an ESM+ INQUIRY API call. This is
 * <b>HTTP-standard hardening only</b>: it reads the standard {@code Retry-After}
 * response header and exposes a safe retry hint. It deliberately does <b>not</b>
 * classify the cause from an ESM-specific error code — that taxonomy is
 * live-response unverified (the {@code { resultCode, message }} failure shape is
 * doc-level, not yet checked against a captured live response), so inventing one
 * would be a guess. No request/response body ever appears in the message.
 *
 * <p>{@code Retry-After} has two standard forms (RFC 9110 §10.2.3):
 * <ul>
 *   <li><b>delta-seconds</b> (e.g. {@code 120}) → {@link #retryAfterSeconds()}.</li>
 *   <li><b>HTTP-date</b> (e.g. {@code Wed, 21 Oct 2026 07:28:00 GMT}) →
 *       {@link #retryAfterAt()} as an absolute {@link Instant}.</li>
 * </ul>
 * The HTTP-date form is parsed to an absolute instant rather than to
 * seconds-from-now, so this class never reads a clock — a caller converts it to
 * a wait via {@link #retryAfterSeconds(Instant)} using its own explicit reference
 * time (the recency rules forbid {@code Date.now}/{@code new Date}).
 */
public class EsmInquiryRateLimitedException extends RuntimeException {

    private final Integer retryAfterSeconds;
    private final Instant retryAfterAt;

    public EsmInquiryRateLimitedException(Integer retryAfterSeconds, Instant retryAfterAt) {
        super("ESM 문의 조회가 속도 제한되었습니다 (HTTP 429).");
        this.retryAfterSeconds = retryAfterSeconds;
        this.retryAfterAt = retryAfterAt;
    }

    /** The {@code Retry-After} delta-seconds hint, or null when absent / HTTP-date / invalid. */
    public Integer retryAfterSeconds() {
        return retryAfterSeconds;
    }

    /** The {@code Retry-After} absolute instant (HTTP-date form), or empty otherwise. */
    public Optional<Instant> retryAfterAt() {
        return Optional.ofNullable(retryAfterAt);
    }

    /**
     * The effective wait in seconds given an <b>explicit</b> reference time
     * (never reads a clock). Returns the delta-seconds hint directly when present;
     * otherwise the non-negative seconds from {@code referenceTime} to the
     * HTTP-date instant; or empty when no {@code Retry-After} was provided.
     */
    public Optional<Long> retryAfterSeconds(Instant referenceTime) {
        if (retryAfterSeconds != null) {
            return Optional.of((long) retryAfterSeconds);
        }
        if (retryAfterAt != null) {
            long seconds = Duration.between(referenceTime, retryAfterAt).getSeconds();
            return Optional.of(Math.max(0L, seconds));
        }
        return Optional.empty();
    }

    /** Build from a 429 response, reading only the standard {@code Retry-After} header. */
    static EsmInquiryRateLimitedException fromResponse(EsmHttpClient.Response response) {
        String raw = response.header("Retry-After").orElse(null);
        Integer seconds = parseSeconds(raw);
        Instant at = seconds == null ? parseHttpDate(raw) : null;
        return new EsmInquiryRateLimitedException(seconds, at);
    }

    private static Integer parseSeconds(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            int seconds = Integer.parseInt(value.trim());
            return seconds >= 0 ? seconds : null;
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static Instant parseHttpDate(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return ZonedDateTime.parse(value.trim(), DateTimeFormatter.RFC_1123_DATE_TIME).toInstant();
        } catch (Exception e) {
            // Unrecognized Retry-After form — degrade to "no hint", never throw.
            return null;
        }
    }
}
