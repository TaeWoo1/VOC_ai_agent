package com.sellerops.connector.cafe24;

import java.net.URI;
import java.util.Map;
import java.util.Optional;

/**
 * The single, fakeable HTTP boundary of the Cafe24 connector. Every outbound
 * call the connector ever makes goes through this interface — unit tests
 * substitute a fake, so no test can reach the network by construction.
 *
 * <p>{@code headers} carries the per-request auth header (the token endpoint
 * uses {@code Authorization: Basic base64(client_id:client_secret)}); the
 * implementation owns the {@code Content-Type} of the form encoding.
 */
public interface Cafe24HttpClient {

    /** POST an {@code application/x-www-form-urlencoded} body with headers. */
    Response postForm(URI uri, Map<String, String> headers, Map<String, String> form);

    /** GET with headers (e.g. {@code Authorization: Bearer {access_token}}). */
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

        /** Masked — a token response body must not leak via accidental rendering. */
        @Override
        public String toString() {
            return "Response[statusCode=" + statusCode
                    + ", body=<masked:" + (body != null ? body.length() : 0) + " chars>"
                    + ", headers=<" + headers.size() + ">]";
        }
    }
}
