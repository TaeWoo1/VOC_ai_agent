package com.sellerops.connector.cafe24;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * Reads one page of the Cafe24 Admin orders list
 * ({@code GET https://{mall_id}.cafe24api.com/api/v2/admin/orders}) with the
 * Bearer access token. Mirrors {@link Cafe24TokenClient}'s discipline: the
 * {@link Cafe24HttpClient} is the only network boundary, a 429 becomes a
 * {@link Cafe24RateLimitedException} (carrying the official resumption hint),
 * and no token or response material appears in messages.
 *
 * <p>The window is bounded by {@code start_date}/{@code end_date} with
 * {@code date_type=order_date}; the caller advances {@code offset} until a short
 * page signals the end. Only order-level fields are requested (no item embed).
 * Endpoint shape, field names, and the max range span are doc-asserted and a
 * live-verification item.
 */
public class Cafe24OrdersClient {

    static final String ORDERS_PATH = "/api/v2/admin/orders";
    static final String DATE_TYPE = "order_date";

    /** mall_id becomes a hostname label — reject anything else before any HTTP. */
    private static final Pattern MALL_ID_SHAPE = Pattern.compile("[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?");

    private final Cafe24HttpClient http;
    private final ObjectMapper mapper = new ObjectMapper();

    public Cafe24OrdersClient(Cafe24HttpClient http) {
        this.http = http;
    }

    /**
     * Fetch one page of orders in {@code [startDate, endDate]}.
     *
     * @throws Cafe24RateLimitedException on HTTP 429 from the orders endpoint
     */
    public List<Cafe24OrderRow> fetchPage(String accessToken, String mallId,
                                          LocalDate startDate, LocalDate endDate, int limit, int offset) {
        URI uri = ordersUri(mallId, startDate, endDate, limit, offset);
        Map<String, String> headers = Map.of("Authorization", "Bearer " + accessToken);

        Cafe24HttpClient.Response response = http.get(uri, headers);
        if (response.statusCode() == 429) {
            throw Cafe24RateLimitedException.fromResponse(response);
        }
        if (response.statusCode() != 200) {
            throw new IllegalStateException(
                    "카페24 주문 조회에 실패했습니다 (HTTP " + response.statusCode() + ").");
        }
        return parse(response.body());
    }

    static URI ordersUri(String mallId, LocalDate startDate, LocalDate endDate, int limit, int offset) {
        if (mallId == null || !MALL_ID_SHAPE.matcher(mallId).matches()) {
            throw new IllegalStateException("카페24 mall_id 형식이 올바르지 않습니다.");
        }
        Map<String, String> params = new LinkedHashMap<>();
        params.put("start_date", startDate.toString());
        params.put("end_date", endDate.toString());
        params.put("date_type", DATE_TYPE);
        params.put("limit", Integer.toString(limit));
        params.put("offset", Integer.toString(offset));
        String query = params.entrySet().stream()
                .map(e -> URLEncoder.encode(e.getKey(), StandardCharsets.UTF_8)
                        + "=" + URLEncoder.encode(e.getValue(), StandardCharsets.UTF_8))
                .collect(Collectors.joining("&"));
        return URI.create("https://" + mallId + ".cafe24api.com" + ORDERS_PATH + "?" + query);
    }

    private List<Cafe24OrderRow> parse(String body) {
        try {
            OrdersResponse parsed = mapper.readValue(body, OrdersResponse.class);
            return parsed.orders() != null ? parsed.orders() : List.of();
        } catch (Exception e) {
            // The body stays out of the message — an order row may carry buyer data.
            throw new IllegalStateException("카페24 주문 응답을 해석할 수 없습니다.");
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record OrdersResponse(@JsonProperty("orders") List<Cafe24OrderRow> orders) {
    }
}
