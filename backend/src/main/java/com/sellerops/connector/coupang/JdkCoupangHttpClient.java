package com.sellerops.connector.coupang;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Production {@link CoupangHttpClient} over the JDK HTTP client. Created only
 * by {@link CoupangConnectorConfiguration}, i.e. only when the Coupang feature
 * flag is on — tests and the default runtime never instantiate it. Failure
 * messages carry no request material (the headers contain the CEA signature).
 */
public class JdkCoupangHttpClient implements CoupangHttpClient {

    private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(10);
    private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(20);

    private final java.net.http.HttpClient client = java.net.http.HttpClient.newBuilder()
            .connectTimeout(CONNECT_TIMEOUT)
            .build();

    @Override
    public Response get(URI uri, Map<String, String> headers) {
        HttpRequest.Builder builder = HttpRequest.newBuilder(uri)
                .timeout(REQUEST_TIMEOUT)
                .header("Accept", "application/json")
                .GET();
        headers.forEach(builder::header);
        return send(builder.build());
    }

    private Response send(HttpRequest request) {
        try {
            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
            return new Response(response.statusCode(), response.body(), firstValueHeaders(response));
        } catch (IOException e) {
            throw new IllegalStateException("쿠팡 API 호출에 실패했습니다 (네트워크 오류).");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("쿠팡 API 호출이 중단되었습니다.");
        }
    }

    private static Map<String, String> firstValueHeaders(HttpResponse<String> response) {
        Map<String, String> headers = new LinkedHashMap<>();
        response.headers().map().forEach((name, values) -> {
            if (!values.isEmpty()) {
                headers.put(name, values.get(0));
            }
        });
        return headers;
    }
}
