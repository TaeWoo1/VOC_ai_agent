package com.sellerops.connector.naver;

/**
 * Safe, parsed view of Naver's rate-limit / quota response headers
 * (intro-restriction.md). Every field is numeric or a known enum string — none
 * carries secret or order material — so a snapshot is safe to keep and act on.
 * Absent or unparseable headers become {@code null}; the connector never assumes
 * a fixed universal limit and only reacts to values actually present.
 *
 * <ul>
 *   <li>{@code GNCP-GW-RateLimit-Replenish-Rate} — per-second max concurrent requests.</li>
 *   <li>{@code GNCP-GW-RateLimit-Burst-Capacity} — burst ceiling (2× the rate; borrows
 *       from the next second, so sustained calls must stay well under it).</li>
 *   <li>{@code GNCP-GW-RateLimit-Remaining} — concurrent requests left this window.</li>
 *   <li>{@code GNCP-GW-Quota-Period} — quota unit ({@code SECONDS} / {@code ROUND}).</li>
 *   <li>{@code GNCP-GW-Quota-Limit} / {@code GNCP-GW-Quota-Remaining} — per-period quota.</li>
 * </ul>
 */
record NaverRateLimitSnapshot(
        Integer replenishRate,
        Integer burstCapacity,
        Integer remaining,
        String quotaPeriod,
        Integer quotaLimit,
        Integer quotaRemaining) {

    /** No headers present — the common case for endpoints that omit the meters. */
    static final NaverRateLimitSnapshot EMPTY =
            new NaverRateLimitSnapshot(null, null, null, null, null, null);

    static NaverRateLimitSnapshot from(NaverHttpClient.Response response) {
        if (response == null) {
            return EMPTY;
        }
        NaverRateLimitSnapshot snapshot = new NaverRateLimitSnapshot(
                intHeader(response, "GNCP-GW-RateLimit-Replenish-Rate"),
                intHeader(response, "GNCP-GW-RateLimit-Burst-Capacity"),
                intHeader(response, "GNCP-GW-RateLimit-Remaining"),
                stringHeader(response, "GNCP-GW-Quota-Period"),
                intHeader(response, "GNCP-GW-Quota-Limit"),
                intHeader(response, "GNCP-GW-Quota-Remaining"));
        return snapshot.hasAnyData() ? snapshot : EMPTY;
    }

    /** True once either meter reports nothing left — the next call must wait a full window. */
    boolean isExhausted() {
        return (remaining != null && remaining <= 0)
                || (quotaRemaining != null && quotaRemaining <= 0);
    }

    boolean hasAnyData() {
        return replenishRate != null || burstCapacity != null || remaining != null
                || quotaPeriod != null || quotaLimit != null || quotaRemaining != null;
    }

    private static Integer intHeader(NaverHttpClient.Response response, String name) {
        return response.header(name)
                .map(NaverRateLimitSnapshot::parseIntOrNull)
                .orElse(null);
    }

    private static String stringHeader(NaverHttpClient.Response response, String name) {
        return response.header(name)
                .map(String::trim)
                .filter(value -> !value.isEmpty())
                .orElse(null);
    }

    private static Integer parseIntOrNull(String value) {
        try {
            return Integer.parseInt(value.trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
