package com.sellerops.connector.naver;

import java.net.URI;
import java.util.Map;

/**
 * Pacing decorator over the real {@link NaverHttpClient}. Every call acquires a
 * slot from the shared {@link NaverRequestPacer} before delegating, so token
 * mint, last-changed-statuses, detail query, and pagination requests are all
 * spaced under Naver's per-second meter without any of the underlying clients
 * knowing pacing exists. Wired only behind the connector flag (see
 * {@link NaverConnectorConfiguration}); the default runtime never builds it.
 *
 * <p>The decorator does not interpret a response's <em>status</em> — a 429 still
 * surfaces exactly as the delegate returned it, so the existing rate-limit
 * handling and cursor preservation are unchanged. It only reads the safe
 * rate/quota <em>headers</em> ({@link NaverRateLimitSnapshot}) and feeds them
 * back so the pacer can back off before the next call when a meter is exhausted.
 */
class PacingNaverHttpClient implements NaverHttpClient {

    private final NaverHttpClient delegate;
    private final NaverRequestPacer pacer;

    PacingNaverHttpClient(NaverHttpClient delegate, NaverRequestPacer pacer) {
        this.delegate = delegate;
        this.pacer = pacer;
    }

    @Override
    public Response postForm(URI uri, Map<String, String> form) {
        pacer.acquire();
        return observed(delegate.postForm(uri, form));
    }

    @Override
    public Response get(URI uri, String bearerToken) {
        pacer.acquire();
        return observed(delegate.get(uri, bearerToken));
    }

    @Override
    public Response postJson(URI uri, String bearerToken, String jsonBody) {
        pacer.acquire();
        return observed(delegate.postJson(uri, bearerToken, jsonBody));
    }

    /** Learn the meter state from this response, then return it untouched. */
    private Response observed(Response response) {
        pacer.observe(NaverRateLimitSnapshot.from(response));
        return response;
    }
}
