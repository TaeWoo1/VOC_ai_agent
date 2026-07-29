package com.sellerops.connector.cafe24;

import java.net.URI;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Recording fake for the connector's single HTTP boundary. Tests enqueue
 * responses and assert on {@link #sent}; an un-enqueued call fails the test —
 * which is how the fail-closed tests prove "zero HTTP requests" happened.
 */
final class FakeCafe24HttpClient implements Cafe24HttpClient {

    record Sent(String method, URI uri, Map<String, String> headers, Map<String, String> form) {

        /** Failed-assertion output must not echo the Basic credential or tokens. */
        @Override
        public String toString() {
            Map<String, String> maskedHeaders = mask(headers, "Authorization");
            Map<String, String> maskedForm = mask(form, "refresh_token");
            return "Sent[method=" + method + ", uri=" + uri
                    + ", headers=" + maskedHeaders + ", form=" + maskedForm + "]";
        }

        private static Map<String, String> mask(Map<String, String> values, String secretKey) {
            if (values == null) {
                return null;
            }
            Map<String, String> masked = new LinkedHashMap<>();
            for (Map.Entry<String, String> entry : values.entrySet()) {
                masked.put(entry.getKey(),
                        secretKey.equalsIgnoreCase(entry.getKey()) ? "<masked>" : entry.getValue());
            }
            return masked;
        }
    }

    final List<Sent> sent = new ArrayList<>();
    private final Deque<Response> responses = new ArrayDeque<>();

    void enqueue(Response response) {
        responses.add(response);
    }

    static Response tokenOk(String accessToken, String refreshToken) {
        return new Response(200,
                "{\"access_token\":\"" + accessToken + "\","
                        + "\"expires_at\":\"2026-06-12T15:50:00.000\","
                        + "\"refresh_token\":\"" + refreshToken + "\","
                        + "\"refresh_token_expires_at\":\"2026-06-26T13:50:00.000\","
                        + "\"token_type\":\"Bearer\"}",
                Map.of());
    }

    /** The official 429 with the X-Cafe24-Call-Remain resumption hint. */
    static Response rateLimited429(String callRemainSeconds) {
        Map<String, String> headers = callRemainSeconds != null
                ? Map.of("X-Cafe24-Call-Remain", callRemainSeconds)
                : Map.of();
        return new Response(429, "{\"error\":{\"code\":429}}", headers);
    }

    /** A 200 orders page: {@code {"orders":[ ...order objects... ]}}. */
    static Response ordersOk(String... orderObjects) {
        return new Response(200, "{\"orders\":[" + String.join(",", orderObjects) + "]}", Map.of());
    }

    /** One order object literal with the three fields the connector reads. */
    static String order(String orderId, String orderDate, String paymentAmount) {
        return "{\"order_id\":\"" + orderId + "\","
                + "\"order_date\":\"" + orderDate + "\","
                + "\"payment_amount\":\"" + paymentAmount + "\"}";
    }

    /** A 200 boards page: {@code {"boards":[ ...board objects... ]}}. */
    static Response boardsOk(String... boardObjects) {
        return new Response(200, "{\"boards\":[" + String.join(",", boardObjects) + "]}", Map.of());
    }

    /** One board object literal with the metadata fields the discovery reads. */
    static String board(int boardNo, String boardName, String boardType) {
        return "{\"board_no\":" + boardNo + ","
                + "\"board_name\":\"" + boardName + "\","
                + "\"board_type\":\"" + boardType + "\"}";
    }

    /** A 200 articles page: {@code {"articles":[ ...article objects... ]}}. */
    static Response articlesOk(String... articleObjects) {
        return new Response(200, "{\"articles\":[" + String.join(",", articleObjects) + "]}", Map.of());
    }

    /**
     * One article object literal with the capture fields. {@code title}/{@code content}
     * are emitted as JSON null when null; {@code productNo}/{@code rating}/
     * {@code createdDate}/{@code replyStatus} are omitted when null (so a row can carry
     * only {@code article_no}). Defaults {@code secret} to {@code "F"} (public), the
     * common case, so existing review/inquiry fixtures model a public board article.
     */
    static String article(long articleNo, String title, String content, Long productNo,
                          Integer rating, String createdDate, String replyStatus) {
        return article(articleNo, title, content, productNo, rating, createdDate, replyStatus, "F");
    }

    /**
     * As {@link #article}, but with an explicit Cafe24 {@code secret} flag. A non-null
     * {@code secret} is emitted verbatim (e.g. {@code "T"} 비밀글, {@code "F"} 공개, or an
     * unexpected token); a {@code null} {@code secret} <b>omits the field entirely</b> —
     * modelling a response with no {@code secret} key (which the review path treats
     * fail-closed as not-public).
     */
    static String article(long articleNo, String title, String content, Long productNo,
                          Integer rating, String createdDate, String replyStatus, String secret) {
        StringBuilder sb = new StringBuilder("{\"article_no\":").append(articleNo);
        sb.append(",\"title\":").append(jsonStringOrNull(title));
        sb.append(",\"content\":").append(jsonStringOrNull(content));
        if (productNo != null) {
            sb.append(",\"product_no\":").append(productNo);
        }
        if (rating != null) {
            sb.append(",\"rating\":").append(rating);
        }
        if (createdDate != null) {
            sb.append(",\"created_date\":\"").append(createdDate).append('"');
        }
        if (replyStatus != null) {
            sb.append(",\"reply_status\":\"").append(replyStatus).append('"');
        }
        if (secret != null) {
            sb.append(",\"secret\":\"").append(secret).append('"');
        }
        return sb.append('}').toString();
    }

    private static String jsonStringOrNull(String value) {
        return value == null ? "null" : "\"" + value + "\"";
    }

    @Override
    public Response postForm(URI uri, Map<String, String> headers, Map<String, String> form) {
        sent.add(new Sent("POST_FORM", uri, headers, form));
        if (responses.isEmpty()) {
            throw new AssertionError("Unexpected HTTP call: POST " + uri);
        }
        return responses.pop();
    }

    @Override
    public Response get(URI uri, Map<String, String> headers) {
        sent.add(new Sent("GET", uri, headers, null));
        if (responses.isEmpty()) {
            throw new AssertionError("Unexpected HTTP call: GET " + uri);
        }
        return responses.pop();
    }
}
