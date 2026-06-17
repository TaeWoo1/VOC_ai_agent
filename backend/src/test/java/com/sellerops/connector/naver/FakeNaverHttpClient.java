package com.sellerops.connector.naver;

import java.net.URI;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Recording fake for the connector's single HTTP boundary. Tests enqueue
 * responses and assert on {@link #sent}; an un-enqueued call fails the test —
 * which is also how the fail-closed tests prove "zero HTTP requests" happened.
 */
final class FakeNaverHttpClient implements NaverHttpClient {

    record Sent(String method, URI uri, Map<String, String> form, String bearer, String jsonBody) {

        /** Failed-assertion output must not echo signature or token material. */
        @Override
        public String toString() {
            Map<String, String> maskedForm = form == null ? null : new LinkedHashMap<>(form);
            if (maskedForm != null) {
                maskedForm.computeIfPresent("client_secret_sign", (k, v) -> "<masked>");
            }
            return "Sent[method=" + method + ", uri=" + uri + ", form=" + maskedForm
                    + ", bearer=" + (bearer != null ? "<masked>" : "null")
                    + ", jsonBody=" + jsonBody + "]";
        }
    }

    final List<Sent> sent = new ArrayList<>();
    private final Deque<Response> responses = new ArrayDeque<>();
    private final Deque<RuntimeException> failures = new ArrayDeque<>();

    void enqueue(Response response) {
        responses.add(response);
    }

    /**
     * Simulate the {@link JdkNaverHttpClient} network/interrupt wrap (an
     * {@link IllegalStateException}) on the next call — used to exercise the
     * provider-unavailable path without real I/O. Popped before any enqueued
     * response, so a test that queues only a failure makes the next call throw.
     */
    void enqueueNetworkFailure() {
        failures.add(new IllegalStateException("네이버 API 호출에 실패했습니다 (네트워크 오류)."));
    }

    static Response tokenOk(String accessToken, long expiresIn) {
        return new Response(200,
                "{\"access_token\":\"" + accessToken + "\",\"expires_in\":" + expiresIn
                        + ",\"token_type\":\"Bearer\"}",
                Map.of());
    }

    static Response ok(String body) {
        return new Response(200, body, Map.of());
    }

    /** The officially documented 429 body; no Retry-After header (the norm). */
    static Response rateLimited429() {
        return new Response(429,
                "{\"code\":\"GW.RATE_LIMIT\",\"message\":\"요청이 많아 서비스를 일시적으로 사용할 수 없습니다.\"}",
                Map.of("GNCP-GW-RateLimit-Remaining", "0"));
    }

    /** The per-period quota 429 (GW.QUOTA_LIMIT) with its quota headers. */
    static Response quotaLimited429() {
        return new Response(429,
                "{\"code\":\"GW.QUOTA_LIMIT\",\"message\":\"할당된 시간당 요청량을 초과하였습니다.\"}",
                Map.of("GNCP-GW-Quota-Period", "SECONDS",
                        "GNCP-GW-Quota-Limit", "1000",
                        "GNCP-GW-Quota-Remaining", "0"));
    }

    @Override
    public Response postForm(URI uri, Map<String, String> form) {
        return record(new Sent("POST_FORM", uri, form, null, null));
    }

    @Override
    public Response get(URI uri, String bearerToken) {
        return record(new Sent("GET", uri, null, bearerToken, null));
    }

    @Override
    public Response postJson(URI uri, String bearerToken, String jsonBody) {
        return record(new Sent("POST_JSON", uri, null, bearerToken, jsonBody));
    }

    private Response record(Sent request) {
        sent.add(request);
        if (!failures.isEmpty()) {
            throw failures.pop();
        }
        if (responses.isEmpty()) {
            throw new AssertionError("Unexpected HTTP call: " + request.method() + " " + request.uri());
        }
        return responses.pop();
    }
}
