package com.sellerops.review.triage.llm;

import java.net.URI;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;

/**
 * Production {@link LlmHttpClient} over the JDK HTTP client, in the shape
 * {@code JdkCoupangHttpClient} already established here.
 *
 * <p>A failure becomes {@code status 0} and a message rather than an exception, because the caller's
 * job is to turn it into {@code CLASSIFICATION_FAILED} (RUBRIC v2 §8.5) and an exception escaping
 * this class would have to be caught somewhere less obvious to do the same thing.
 *
 * <p>The message carries the exception's <b>type</b> and not its text: a timeout message can contain
 * the URI, and some clients put request material in it.
 */
public class JdkLlmHttpClient implements LlmHttpClient {

    private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(10);
    private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(60);

    private final java.net.http.HttpClient client = java.net.http.HttpClient.newBuilder()
            .connectTimeout(CONNECT_TIMEOUT)
            .build();

    @Override
    public Response post(URI uri, Map<String, String> headers, String jsonBody) {
        HttpRequest.Builder builder = HttpRequest.newBuilder(uri)
                .timeout(REQUEST_TIMEOUT)
                .header("Accept", "application/json")
                .header("Content-Type", "application/json;charset=UTF-8")
                .POST(HttpRequest.BodyPublishers.ofString(jsonBody, StandardCharsets.UTF_8));
        headers.forEach(builder::header);
        try {
            HttpResponse<String> response =
                    client.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            return new Response(response.statusCode(), response.body());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return new Response(0, "interrupted");
        } catch (Exception e) {
            return new Response(0, e.getClass().getSimpleName());
        }
    }
}
