package com.sellerops.connector.elevenst;

import java.net.URI;
import java.util.Map;
import java.util.Optional;

/**
 * The single, fakeable HTTP boundary of the 11st (11번가) connector. Every
 * outbound call the connector will ever make goes through this interface —
 * unit tests substitute a fake, so no test can reach the network by
 * construction. In the Phase 3D-5 auth skeleton no code path calls it at all
 * (capabilities are empty and {@code fetch} stops before HTTP); a later,
 * separately approved fetch slice makes it live.
 *
 * <p>11st seller auth is a single static key sent as the {@code openapikey}
 * header on every request (no token endpoint, no signature) — {@code headers}
 * carries that assembled header. The publicly documented seller endpoints are
 * REST over {@code api.11st.co.kr} returning XML (EUC-KR); per-endpoint
 * request shapes are seller-login-walled, so nothing beyond the auth header
 * is assumed here.
 */
public interface ElevenstHttpClient {

    /** GET with fully assembled headers ({@code openapikey} attached per request). */
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
