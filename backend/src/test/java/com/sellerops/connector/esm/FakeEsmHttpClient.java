package com.sellerops.connector.esm;

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
 * which is how the skeleton's fail-closed tests prove "zero HTTP requests"
 * happened (in Phase 3D-4 nothing should ever be enqueued).
 */
final class FakeEsmHttpClient implements EsmHttpClient {

    record Sent(String method, URI uri, Map<String, String> headers, String jsonBody) {

        /** Failed-assertion output must not echo the signed JWT. */
        @Override
        public String toString() {
            Map<String, String> masked = null;
            if (headers != null) {
                masked = new LinkedHashMap<>();
                for (Map.Entry<String, String> entry : headers.entrySet()) {
                    masked.put(entry.getKey(),
                            "Authorization".equalsIgnoreCase(entry.getKey()) ? "<masked>" : entry.getValue());
                }
            }
            return "Sent[method=" + method + ", uri=" + uri
                    + ", headers=" + masked + ", jsonBody=" + jsonBody + "]";
        }
    }

    final List<Sent> sent = new ArrayList<>();
    private final Deque<Response> responses = new ArrayDeque<>();

    void enqueue(Response response) {
        responses.add(response);
    }

    @Override
    public Response postJson(URI uri, Map<String, String> headers, String jsonBody) {
        sent.add(new Sent("POST_JSON", uri, headers, jsonBody));
        if (responses.isEmpty()) {
            throw new AssertionError("Unexpected HTTP call: POST " + uri);
        }
        return responses.pop();
    }
}
