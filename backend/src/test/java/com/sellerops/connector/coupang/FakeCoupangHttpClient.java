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

    /**
     * One recorded request. {@code body} is null for a GET and carries the POST payload otherwise —
     * tests assert on it to prove the reply body was assembled as the official field names require,
     * which is the one thing about the answer endpoint the repository cannot otherwise check.
     */
    record Sent(String method, URI uri, Map<String, String> headers, String body) {

        /**
         * Failed-assertion output must not echo the CEA signature — nor the body, which on a reply
         * POST is the seller's own answer text to a real customer.
         */
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
            return "Sent[method=" + method + ", uri=" + uri + ", headers=" + masked
                    + ", body=<masked:" + (body == null ? 0 : body.length()) + " chars>]";
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

    /**
     * Enqueue the WRITE-side transport ambiguity — the request left and no response was read. The
     * real client raises this only for a POST, because only a write is unanswerable that way.
     */
    void enqueueWriteAmbiguity() {
        responses.add(new CoupangTransportAmbiguityException("simulated write ambiguity"));
    }

    @Override
    public Response get(URI uri, Map<String, String> headers) {
        return next("GET", uri, headers, null);
    }

    @Override
    public Response post(URI uri, Map<String, String> headers, String body) {
        return next("POST", uri, headers, body);
    }

    private Response next(String method, URI uri, Map<String, String> headers, String body) {
        sent.add(new Sent(method, uri, headers, body));
        if (responses.isEmpty()) {
            throw new AssertionError("Unexpected HTTP call: " + method + " " + uri);
        }
        Object next = responses.pop();
        if (next instanceof RuntimeException failure) {
            throw failure;
        }
        return (Response) next;
    }
}
