package com.sellerops.connector.coupang;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
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

    @Override
    public Response post(URI uri, Map<String, String> headers, String body) {
        HttpRequest.Builder builder = HttpRequest.newBuilder(uri)
                .timeout(REQUEST_TIMEOUT)
                .header("Accept", "application/json")
                .header("Content-Type", "application/json;charset=UTF-8")
                .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8));
        headers.forEach(builder::header);
        return send(builder.build(), true);
    }

    private Response send(HttpRequest request) {
        return send(request, false);
    }

    /**
     * @param write when true, a transport failure is AMBIGUOUS rather than a clean failure — the
     *              request may have been received and acted on before the connection broke. A read
     *              can say "it failed"; a write can only say "I do not know".
     */
    private Response send(HttpRequest request, boolean write) {
        try {
            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
            return new Response(response.statusCode(), response.body(), firstValueHeaders(response));
        } catch (IOException e) {
            if (write) {
                throw new CoupangTransportAmbiguityException(
                        "쿠팡 답변 등록 요청의 결과를 확인하지 못했습니다 (네트워크 오류). 재전송하지 않고 확인합니다.");
            }
            throw new IllegalStateException("쿠팡 API 호출에 실패했습니다 (네트워크 오류).");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            if (write) {
                throw new CoupangTransportAmbiguityException(
                        "쿠팡 답변 등록 요청이 중단되어 결과를 확인하지 못했습니다. 재전송하지 않고 확인합니다.");
            }
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
