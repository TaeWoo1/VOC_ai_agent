package com.sellerops.connector.coupang;

import java.net.URI;
import java.util.Map;
import java.util.Optional;

/**
 * The single, fakeable HTTP boundary of the Coupang connector. Every outbound
 * call the connector will ever make goes through this interface — unit tests
 * substitute a fake, so no test can reach the network by construction. In the
 * Phase 3D-2 auth skeleton no code path calls it at all (capabilities are
 * empty and {@code fetch} stops before HTTP); the order-collection slice makes
 * it live.
 *
 * <p>{@code headers} carries the per-request signed headers ({@code
 * Authorization} CEA signature, {@code X-Requested-By}, {@code X-MARKET}) —
 * Coupang's HMAC is per-request, so unlike the Naver boundary there is no
 * token-shaped method split.
 */
public interface CoupangHttpClient {

    /** GET with fully assembled headers (Coupang signs per request). */
    Response get(URI uri, Map<String, String> headers);

    /**
     * POST with fully assembled headers and a JSON body — the only WRITE verb this connector has.
     *
     * <p><b>Why it is separate rather than a generic {@code send}.</b> A GET that times out can be
     * retried; a POST that times out may already have posted a reply to a customer. Keeping the write
     * verb its own method keeps that difference visible at the boundary, and lets the caller map a
     * transport ambiguity to DELIVERY_UNKNOWN instead of to a retry.
     *
     * @throws CoupangTransportAmbiguityException when the request left but no response was read —
     *         the one case where "did it happen?" is genuinely unanswerable from here
     */
    Response post(URI uri, Map<String, String> headers, String body);

    /**
     * One HTTP response. {@code headers} are single-valued (first value wins);
     * use {@link #header} for case-insensitive lookup.
     */
    record Response(int statusCode, String body, Map<String, String> headers) {

        public Optional<String> header(String name) {
            return headers.entrySet().stream()
                    .filter(e -> e.getKey().equalsIgnoreCase(name))
                    .map(Map.Entry::getValue)
                    .findFirst();
        }

        /** Masked — response bodies must not leak via accidental rendering. */
        @Override
        public String toString() {
            return "Response[statusCode=" + statusCode
                    + ", body=<masked:" + (body != null ? body.length() : 0) + " chars>"
                    + ", headers=<" + headers.size() + ">]";
        }
    }
}
