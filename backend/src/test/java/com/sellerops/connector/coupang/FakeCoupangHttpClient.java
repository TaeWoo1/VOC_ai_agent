package com.sellerops.connector.coupang;

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
 * happened (in Phase 3D-2 nothing should ever be enqueued).
 */
final class FakeCoupangHttpClient implements CoupangHttpClient {

    record Sent(String method, URI uri, Map<String, String> headers) {

        /** Failed-assertion output must not echo the CEA signature. */
        @Override
        public String toString() {
            Map<String, String> masked = null;
            if (headers != null) {
                masked = new LinkedHashMap<>();
                for (Map.Entry<String, String> entry : headers.entrySet()) {
                    // Header names are case-insensitive — mask every casing.
                    masked.put(entry.getKey(),
                            "Authorization".equalsIgnoreCase(entry.getKey()) ? "<masked>" : entry.getValue());
                }
            }
            return "Sent[method=" + method + ", uri=" + uri + ", headers=" + masked + "]";
        }
    }

    final List<Sent> sent = new ArrayList<>();
    // Each queued item is either a Response or a RuntimeException to throw (a transport failure).
    private final Deque<Object> responses = new ArrayDeque<>();

    void enqueue(Response response) {
        responses.add(response);
    }

    /**
     * Enqueue a transport failure — the real HTTP client surfaces a connect/timeout/TLS error as an
     * {@link IllegalStateException}, which the probes catch and classify as a transport (no-status) outcome.
     */
    void enqueueTransportFailure() {
        responses.add(new IllegalStateException("simulated transport failure"));
    }

    @Override
    public Response get(URI uri, Map<String, String> headers) {
        sent.add(new Sent("GET", uri, headers));
        if (responses.isEmpty()) {
            throw new AssertionError("Unexpected HTTP call: GET " + uri);
        }
        Object next = responses.pop();
        if (next instanceof RuntimeException failure) {
            throw failure;
        }
        return (Response) next;
    }
}
