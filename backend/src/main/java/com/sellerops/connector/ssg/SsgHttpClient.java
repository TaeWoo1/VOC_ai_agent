package com.sellerops.connector.ssg;

import java.net.URI;
import java.util.Map;
import java.util.Optional;

/**
 * The single, fakeable HTTP boundary of the SSG.COM connector. Every outbound
 * call the connector will ever make goes through this interface — unit tests
 * substitute a fake, so no test can reach the network by construction. In the
 * Phase 3D-6 auth skeleton no code path calls it at all (capabilities are
 * empty and {@code fetch} stops before HTTP); a later, separately approved
 * fetch slice makes it live.
 *
 * <p>SSG auth is a single static vendor key (업체 인증키) sent verbatim as the
 * {@code Authorization} header on every request — no token endpoint, no
 * signature — and {@code headers} carries that assembled header. Official
 * endpoint specs serve XML or JSON selected via {@code Accept}/
 * {@code Content-Type}; per-endpoint request shapes are deferred to the
 * fetch slices.
 */
public interface SsgHttpClient {

    /** GET with fully assembled headers ({@code Authorization} key attached per request). */
    Response get(URI uri, Map<String, String> headers);

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
