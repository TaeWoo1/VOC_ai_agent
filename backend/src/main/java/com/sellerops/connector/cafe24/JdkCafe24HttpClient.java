package com.sellerops.connector.cafe24;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Production {@link Cafe24HttpClient} over the JDK HTTP client. Created only
 * by {@link Cafe24ConnectorConfiguration}, i.e. only when the Cafe24 feature
 * flag is on — tests and the default runtime never instantiate it. Failure
 * messages carry no request material (headers carry the Basic credential pair;
 * the form carries the refresh token).
 */
public class JdkCafe24HttpClient implements Cafe24HttpClient {

    private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(10);
    private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(20);

    /** The dated Admin-API version header Cafe24 requires on Admin (v2) data calls. */
    static final String API_VERSION_HEADER = "X-Cafe24-Api-Version";
    /** Admin data endpoints; OAuth (token/authorize) is NOT an admin call. */
    private static final String ADMIN_PATH_PREFIX = "/api/v2/admin/";

    private final java.net.http.HttpClient client = java.net.http.HttpClient.newBuilder()
            .connectTimeout(CONNECT_TIMEOUT)
            .build();

    /** Pinned Cafe24 Admin-API version, sent as {@code X-Cafe24-Api-Version} on admin calls. */
    private final String apiVersion;

    /**
     * @param apiVersion the pinned Admin-API version (e.g. {@code 2025-12-01}).
     *     Blank fails closed: the connector will not issue admin calls against an
     *     unspecified API version (Cafe24 would otherwise apply the app's default,
     *     which can shift behavior silently).
     */
    public JdkCafe24HttpClient(String apiVersion) {
        if (apiVersion == null || apiVersion.isBlank()) {
            throw new IllegalStateException(
                    "카페24 API 버전(sellerops.connector.cafe24.api-version)이 설정되지 않았습니다.");
        }
        this.apiVersion = apiVersion.trim();
    }

    /** Admin (v2) data calls carry the version header; the OAuth endpoints do not. */
    static boolean requiresApiVersion(URI uri) {
        String path = uri.getPath();
        return path != null && path.startsWith(ADMIN_PATH_PREFIX);
    }

    /** The version header to attach for this URI: present for admin calls, empty otherwise. */
    static Map<String, String> apiVersionHeader(URI uri, String apiVersion) {
        return requiresApiVersion(uri) ? Map.of(API_VERSION_HEADER, apiVersion) : Map.of();
    }

    @Override
    public Response postForm(URI uri, Map<String, String> headers, Map<String, String> form) {
        String body = form.entrySet().stream()
                .map(e -> URLEncoder.encode(e.getKey(), StandardCharsets.UTF_8)
                        + "=" + URLEncoder.encode(e.getValue(), StandardCharsets.UTF_8))
                .collect(Collectors.joining("&"));
        HttpRequest.Builder builder = HttpRequest.newBuilder(uri)
                .timeout(REQUEST_TIMEOUT)
                .header("Content-Type", "application/x-www-form-urlencoded")
                .header("Accept", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body));
        headers.forEach(builder::header);
        apiVersionHeader(uri, apiVersion).forEach(builder::header);
        return send(builder.build());
    }

    @Override
    public Response get(URI uri, Map<String, String> headers) {
        HttpRequest.Builder builder = HttpRequest.newBuilder(uri)
                .timeout(REQUEST_TIMEOUT)
                .header("Accept", "application/json")
                .GET();
        headers.forEach(builder::header);
        apiVersionHeader(uri, apiVersion).forEach(builder::header);
        return send(builder.build());
    }

    private Response send(HttpRequest request) {
        try {
            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
            return new Response(response.statusCode(), response.body(), firstValueHeaders(response));
        } catch (IOException e) {
            throw new IllegalStateException("카페24 API 호출에 실패했습니다 (네트워크 오류).");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("카페24 API 호출이 중단되었습니다.");
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
