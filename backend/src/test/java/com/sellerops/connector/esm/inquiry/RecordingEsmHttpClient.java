package com.sellerops.connector.esm.inquiry;

import com.sellerops.connector.esm.EsmHttpClient;
import java.net.URI;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Recording fake for the {@link EsmHttpClient} boundary used by the INQUIRY
 * orchestration tests. Tests enqueue responses and assert on {@link #sent}; an
 * un-enqueued call fails the test, so "no live HTTP" holds by construction.
 * Mirrors the {@code FakeEsmHttpClient} pattern (package-private to the {@code
 * esm} package), re-declared here for the {@code inquiry} subpackage.
 */
final class RecordingEsmHttpClient implements EsmHttpClient {

    record Sent(URI uri, Map<String, String> headers, String jsonBody) {

        /** Never echo a (would-be) credential header. */
        @Override
        public String toString() {
            Map<String, String> masked = new LinkedHashMap<>();
            if (headers != null) {
                for (Map.Entry<String, String> entry : headers.entrySet()) {
                    masked.put(entry.getKey(),
                            "Authorization".equalsIgnoreCase(entry.getKey()) ? "<masked>" : entry.getValue());
                }
            }
            return "Sent[uri=" + uri + ", headers=" + masked + ", jsonBody=" + jsonBody + "]";
        }
    }

    final List<Sent> sent = new ArrayList<>();
    private final Deque<Response> responses = new ArrayDeque<>();

    void enqueue(Response response) {
        responses.add(response);
    }

    /** Convenience: enqueue a 200 OK JSON response. */
    void enqueueOk(String body) {
        responses.add(new Response(200, body, Map.of()));
    }

    @Override
    public Response postJson(URI uri, Map<String, String> headers, String jsonBody) {
        sent.add(new Sent(uri, headers, jsonBody));
        if (responses.isEmpty()) {
            throw new AssertionError("Unexpected HTTP call: POST " + uri);
        }
        return responses.pop();
    }
}
