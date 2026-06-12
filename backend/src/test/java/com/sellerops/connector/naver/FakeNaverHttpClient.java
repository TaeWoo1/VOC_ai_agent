package com.sellerops.connector.naver;

import java.net.URI;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Map;

/**
 * Recording fake for the connector's single HTTP boundary. Tests enqueue
 * responses and assert on {@link #sent}; an un-enqueued call fails the test —
 * which is also how the fail-closed tests prove "zero HTTP requests" happened.
 */
final class FakeNaverHttpClient implements NaverHttpClient {

    record Sent(URI uri, Map<String, String> form) {

        /** Failed-assertion output must not echo the signature value. */
        @Override
        public String toString() {
            Map<String, String> masked = new java.util.LinkedHashMap<>(form);
            masked.computeIfPresent("client_secret_sign", (k, v) -> "<masked>");
            return "Sent[uri=" + uri + ", form=" + masked + "]";
        }
    }

    final List<Sent> sent = new ArrayList<>();
    private final Deque<Response> responses = new ArrayDeque<>();

    void enqueue(Response response) {
        responses.add(response);
    }

    static Response tokenOk(String accessToken, long expiresIn) {
        return new Response(200,
                "{\"access_token\":\"" + accessToken + "\",\"expires_in\":" + expiresIn
                        + ",\"token_type\":\"Bearer\"}",
                Map.of());
    }

    /** The officially documented 429 body; no Retry-After header (the norm). */
    static Response rateLimited429() {
        return new Response(429,
                "{\"code\":\"GW.RATE_LIMIT\",\"message\":\"요청이 많아 서비스를 일시적으로 사용할 수 없습니다.\"}",
                Map.of("GNCP-GW-RateLimit-Remaining", "0"));
    }

    @Override
    public Response postForm(URI uri, Map<String, String> form) {
        sent.add(new Sent(uri, form));
        if (responses.isEmpty()) {
            throw new AssertionError("Unexpected HTTP call: " + uri);
        }
        return responses.pop();
    }
}
