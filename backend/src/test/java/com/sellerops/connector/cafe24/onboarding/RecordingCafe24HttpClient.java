package com.sellerops.connector.cafe24.onboarding;

import com.sellerops.connector.cafe24.Cafe24HttpClient;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Minimal recording fake of the Cafe24 HTTP boundary for onboarding tests (the
 * connector-package fake is package-private). Records each POST and returns a queued
 * response; no network. GET is unused here.
 */
class RecordingCafe24HttpClient implements Cafe24HttpClient {

    record Sent(URI uri, Map<String, String> headers, Map<String, String> form) {
    }

    final List<Sent> posts = new ArrayList<>();
    private Response nextResponse = new Response(200, "{}", Map.of());

    void respondWith(int status, String body) {
        this.nextResponse = new Response(status, body, Map.of());
    }

    static String tokenBody(String access, String refresh) {
        return "{\"access_token\":\"" + access + "\",\"expires_at\":\"2026-07-05T12:00:00\","
                + "\"refresh_token\":\"" + refresh + "\",\"refresh_token_expires_at\":\"2026-08-04T12:00:00\"}";
    }

    @Override
    public Response postForm(URI uri, Map<String, String> headers, Map<String, String> form) {
        posts.add(new Sent(uri, headers, form));
        return nextResponse;
    }

    @Override
    public Response get(URI uri, Map<String, String> headers) {
        throw new UnsupportedOperationException("onboarding tests do not GET");
    }
}
