package com.sellerops.inquiry.publish.naver;

import java.net.URI;
import java.util.Map;
import java.util.Optional;

/**
 * The HTTP boundary of the NAVER ANSWER path — deliberately not the connector's.
 *
 * <p><b>Why a second seam exists at all.</b> {@code NaverReadOnlyFenceTest} asserts that the whole
 * {@code connector/naver} package can reach only six endpoints and that its HTTP interface carries no
 * verb able to replace a resource. That fence is not bureaucracy: routine collection runs on a
 * SCHEDULE, which is a standing grant to call NAVER with no human in the turn, and the guarantee that
 * such a lane cannot write is a property of where the code lives. Adding {@code put(...)} to
 * {@code NaverHttpClient} would delete that guarantee for the reading lane in order to serve the
 * writing one.
 *
 * <p>So the answer path lives here, in the publish package, where every call is downstream of a
 * seller's explicit confirmation bound to one draft version. The two lanes share NAVER's token mint —
 * a read, and already on the connector's allowlist — and nothing else.
 */
public interface NaverAnswerHttpClient {

    /** PUT a JSON body with a bearer access token. */
    Response putJson(URI uri, String bearerToken, String jsonBody);

    /** POST a JSON body with a bearer access token. */
    Response postJson(URI uri, String bearerToken, String jsonBody);

    /** One HTTP response. Masked in {@code toString} — an answer body is the seller's own text. */
    record Response(int statusCode, String body, Map<String, String> headers) {

        public Optional<String> header(String name) {
            return headers.entrySet().stream()
                    .filter(e -> e.getKey().equalsIgnoreCase(name))
                    .map(Map.Entry::getValue)
                    .findFirst();
        }

        @Override
        public String toString() {
            return "Response[statusCode=" + statusCode
                    + ", body=<masked:" + (body != null ? body.length() : 0) + " chars>"
                    + ", headers=<" + headers.size() + ">]";
        }
    }
}
