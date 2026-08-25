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
     * POST a JSON body — the Admin API's write shape, and the ONLY write this interface offers.
     *
     * <p>Defaulted to a refusal rather than declared abstract, on purpose. Every fake in this
     * repository was written for a read path; leaving them to inherit a throw means none of them can
     * be used to send a write by accident, and a test that needs to prove a write has to say so by
     * overriding this method. The real transport overrides it; the token endpoint's form POST stays
     * where it is because it is a different content type and a different kind of call.
     */
    default Response postJson(URI uri, Map<String, String> headers, String jsonBody) {
        throw new IllegalStateException("이 카페24 전송 구현은 쓰기를 지원하지 않습니다.");
    }

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
