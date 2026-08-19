package com.sellerops.agent.llm;

import java.net.URI;
import java.util.Map;

/**
 * The one call the agent draft generator makes, behind a port so the payload can be asserted.
 *
 * <p><b>Why this is not {@code LlmHttpClient}.</b> The triage package's transport carries the review
 * triage payload floor (RUBRIC v2 §8.3/§8.4), and {@code ClassifierBoundaryTest} enforces that
 * exactly one class in {@code main} may hold it and call {@code .post(} — so that no future service
 * can reach the vendor around {@link com.sellerops.review.triage.llm.ReviewTriageChannelGate}. That
 * guard is doing its job here: this is a DIFFERENT capability with a DIFFERENT payload floor
 * (an inquiry's title and body, not a review's rating and body) and a DIFFERENT gate, and sharing
 * the transport would have meant one guard standing in front of two contracts. Two ports, two
 * floors, two payload tests, and neither guard weakened.
 *
 * <p>Shaped exactly like the triage port for the same reason it was: {@link AgentDraftPayloadFloorTest}
 * asserts the serialized BYTES that leave, which is only possible if a test can stand where they leave.
 */
public interface AgentLlmTransport {

    Response post(URI uri, Map<String, String> headers, String jsonBody);

    /**
     * @param status the HTTP status, or 0 when the request never completed
     * @param body   the response body, or a transport-level marker when {@code status} is 0
     */
    record Response(int status, String body) {

        public boolean ok() {
            return status >= 200 && status < 300;
        }
    }
}
