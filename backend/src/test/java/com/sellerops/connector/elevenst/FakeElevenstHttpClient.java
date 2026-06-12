package com.sellerops.connector.elevenst;

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
 * happened (in Phase 3D-5 nothing should ever be enqueued).
 */
final class FakeElevenstHttpClient implements ElevenstHttpClient {

    record Sent(String method, URI uri, Map<String, String> headers) {

        /** Failed-assertion output must not echo the static openapikey. */
        @Override
        public String toString() {
            Map<String, String> masked = null;
            if (headers != null) {
                masked = new LinkedHashMap<>();
                for (Map.Entry<String, String> entry : headers.entrySet()) {
                    masked.put(entry.getKey(),
                            ElevenstApiConnector.AUTH_HEADER.equalsIgnoreCase(entry.getKey())
                                    ? "<masked>" : entry.getValue());
                }
            }
            return "Sent[method=" + method + ", uri=" + uri + ", headers=" + masked + "]";
        }
    }

    final List<Sent> sent = new ArrayList<>();
    private final Deque<Response> responses = new ArrayDeque<>();

    void enqueue(Response response) {
        responses.add(response);
    }

    @Override
    public Response get(URI uri, Map<String, String> headers) {
        sent.add(new Sent("GET", uri, headers));
        if (responses.isEmpty()) {
            throw new AssertionError("Unexpected HTTP call: GET " + uri);
        }
        return responses.pop();
    }
}
