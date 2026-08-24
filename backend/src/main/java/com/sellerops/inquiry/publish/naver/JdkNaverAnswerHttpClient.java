package com.sellerops.inquiry.publish.naver;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.HashMap;
import java.util.Map;

/**
 * The real JDK transport for the NAVER answer path.
 *
 * <p>A read timeout that expires after the request has left is NOT a failure to send — the answer may
 * already be registered on the seller's store. It surfaces as {@link NaverAnswerTransportAmbiguity}
 * so the publish core verifies instead of posting a second answer to a real customer.
 */
public class JdkNaverAnswerHttpClient implements NaverAnswerHttpClient {

    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    @Override
    public Response putJson(URI uri, String bearerToken, String jsonBody) {
        return send(request(uri, bearerToken, jsonBody).PUT(body(jsonBody)).build());
    }

    @Override
    public Response postJson(URI uri, String bearerToken, String jsonBody) {
        return send(request(uri, bearerToken, jsonBody).POST(body(jsonBody)).build());
    }

    private static HttpRequest.BodyPublisher body(String jsonBody) {
        return HttpRequest.BodyPublishers.ofString(jsonBody == null ? "{}" : jsonBody,
                StandardCharsets.UTF_8);
    }

    private static HttpRequest.Builder request(URI uri, String bearerToken, String jsonBody) {
        return HttpRequest.newBuilder(uri)
                .timeout(Duration.ofSeconds(30))
                .header("Authorization", "Bearer " + bearerToken)
                .header("Content-Type", "application/json;charset=UTF-8")
                .header("Accept", "application/json");
    }

    private Response send(HttpRequest request) {
        try {
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
            Map<String, String> headers = new HashMap<>();
            response.headers().map().forEach((k, v) -> headers.put(k, v.isEmpty() ? "" : v.get(0)));
            return new Response(response.statusCode(), response.body(), headers);
        } catch (IOException ambiguous) {
            // The request left this process and no answer came back. Whether NAVER registered it is
            // unknown, and "unknown" is never treated as "not sent".
            throw new NaverAnswerTransportAmbiguity();
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new NaverAnswerTransportAmbiguity();
        }
    }
}
