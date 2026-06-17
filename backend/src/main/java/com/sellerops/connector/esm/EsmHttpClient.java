package com.sellerops.connector.esm;

import java.net.URI;
import java.util.Map;
import java.util.Optional;

/**
 * The single, fakeable HTTP boundary of the ESM (G마켓/옥션) connector. Every
 * outbound call the connector will ever make goes through this interface —
 * unit tests substitute a fake, so no test can reach the network by
 * construction. In the Phase 3D-4 auth skeleton no code path calls it at all
 * (capabilities are empty and {@code fetch} stops before HTTP); the
 * order-collection slice makes it live.
 *
 * <p>The documented ESM Sell-API endpoints are POST with a JSON body and the
 * signed JWT in {@code Authorization: Bearer} — {@code headers} carries that
 * assembled header.
 */
public interface EsmHttpClient {

    /** POST a JSON body with fully assembled headers. */
    Response postJson(URI uri, Map<String, String> headers, String jsonBody);

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
