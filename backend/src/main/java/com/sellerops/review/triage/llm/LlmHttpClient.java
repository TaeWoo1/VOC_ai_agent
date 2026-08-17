package com.sellerops.review.triage.llm;

import java.net.URI;
import java.util.Map;

/**
 * The one call a triage classifier makes, behind a port so the payload can be asserted.
 *
 * <p>RUBRIC v2 §8.4 requires the payload floor be checked on <b>the whole outgoing body</b> rather
 * than on the builder's intent. That is only possible if a test can stand exactly where the bytes
 * leave, which is what this seam is for — the same reason
 * {@code build-annotator-package.mjs} re-reads the file it just wrote instead of trusting the
 * variables it wrote it from.
 */
public interface LlmHttpClient {

    Response post(URI uri, Map<String, String> headers, String jsonBody);

    /**
     * @param status  the HTTP status, or 0 when the request never completed
     * @param body    the response body, or a transport-level message when {@code status} is 0
     */
    record Response(int status, String body) {

        public boolean ok() {
            return status >= 200 && status < 300;
        }
    }
}
