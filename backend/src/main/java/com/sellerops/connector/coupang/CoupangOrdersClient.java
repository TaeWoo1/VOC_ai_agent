package com.sellerops.connector.coupang;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.connector.DataType;
import com.sellerops.connector.FetchPage;
import com.sellerops.ingest.canonical.CanonicalOrder;
import com.sellerops.ingest.canonical.CanonicalOrderSummary;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;
import java.util.stream.Collectors;

/**
 * The officially documented Coupang WING Open API order collection flow
 * (developers.coupang.com, "PO list query, paging by day", v5):
 *
 * <pre>GET /v2/providers/openapi/apis/api/v5/vendors/{vendorId}/ordersheets
 *     ?createdAtFrom={yyyy-MM-dd}&amp;createdAtTo={yyyy-MM-dd}&amp;status={STATUS}&amp;maxPerPage=50[&amp;nextToken=...]</pre>
 *
 * <p><b>Why a full-window sweep.</b> The endpoint's {@code status} parameter is
 * <b>required</b> (one of {@link #STATUSES}), and its {@code createdAt} range is a KST
 * <b>date</b> span capped at 31 days. A single {@link #fetchOrderSummaryPage} therefore
 * sweeps the whole rolling window in full — every required status, following
 * {@code nextToken} to the end of each — so each swept day's summary is complete and the
 * shared aggregate upsert (overwrite by channel+date) converges without carrying running
 * totals in the cursor. A shipment box has exactly one status at query time, so it appears
 * under one status query; a {@code shipmentBoxId} de-dup across the sweep is defensive.
 *
 * <p><b>Amount basis.</b> {@code orderItems[].orderPrice} — officially "the price to be
 * paid" ({@code salesPrice} per-unit × {@code shippingCount}); summed across a shipment
 * box's items. {@code discountPrice} (a further net refinement) and Coupang's separate
 * cancel/return flow are deliberate later work, not read here.
 *
 * <p><b>Identity.</b> {@code shipmentBoxId} (the stable per-bundle line) is the dedup
 * identity ({@code externalOrderId}); {@code orderId} (the order-number grouping) is
 * {@code parentOrderId} — mirroring NAVER's productOrderId/orderId split. No buyer PII
 * ({@code orderer}/{@code receiver}) is ever read.
 *
 * <p><b>Auth.</b> Every request is HMAC-signed per call ({@link CoupangSigner}); the
 * required {@code X-Requested-By: {vendorId}} and {@code X-MARKET: KR} headers ride along.
 * A 429 throws {@link CoupangRateLimitedException} (cursor unchanged on retry).
 */
public class CoupangOrdersClient {

    static final String ORDERSHEETS_PATH_FMT =
            "/v2/providers/openapi/apis/api/v5/vendors/%s/ordersheets";
    /** A low-privilege authenticated GET used only for the credential/environment check. */
    static final String RETURN_CENTERS_PATH_FMT =
            "/v2/providers/openapi/apis/api/v4/vendors/%s/returnShippingCenters";

    /** The endpoint's required, officially documented order statuses — swept in full each run. */
    static final List<String> STATUSES = List.of(
            "ACCEPT", "INSTRUCT", "DEPARTURE", "DELIVERING", "FINAL_DELIVERY", "NONE_TRACKING");

    /** Official page size ceiling. */
    static final int MAX_PER_PAGE = 50;
    /**
     * A defensive per-(status, window) pagination bound. 200 × 50 = 10,000 shipment boxes
     * per status per window is far beyond an SME window; exceeding it fails the page closed
     * (an honest error the operator can narrow) rather than looping unbounded or silently
     * truncating.
     */
    static final int MAX_PAGES_PER_STATUS = 200;

    static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final String MARKET = "KR";
    /**
     * The exact, fixed system string in Coupang's 403 IP body ("[FORBIDDEN] Not allowed IP.
     * …", official article). Matched case-insensitively to split an IP denial from other
     * 403s; the body is read ONLY for this marker and never surfaced.
     */
    private static final String IP_DENIED_MARKER = "not allowed ip";

    private static final List<String> SAFE_ERROR_FIELDS =
            List.of("code", "message", "errorCode", "error", "errorMessage");
    private static final int MAX_ERROR_DETAIL = 200;

    private final CoupangHttpClient http;
    private final CoupangSigner signer;
    private final Clock clock;
    private final String baseUrl;
    private final ObjectMapper mapper = new ObjectMapper();

    public CoupangOrdersClient(CoupangHttpClient http, CoupangSigner signer, Clock clock, String baseUrl) {
        this.http = http;
        this.signer = signer;
        this.clock = clock;
        this.baseUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
    }

    // --- order collection -------------------------------------------------

    /**
     * Fetch one ORDER_SUMMARY page — a full sweep of the rolling KST date window for this
     * cursor. {@code cursorValue} is the serialized {@link CoupangOrdersCursor} (null/blank =
     * first collection). Because the whole window is swept, the returned page is terminal
     * ({@code hasMore=false}); the scheduler re-runs it and the next window rolls forward.
     *
     * @throws CoupangRateLimitedException on HTTP 429 from any ordersheets call
     */
    public FetchPage fetchOrderSummaryPage(String accessKey, String secretKey, String vendorId,
                                           String cursorValue) {
        LocalDate today = LocalDate.ofInstant(clock.instant(), KST);
        CoupangOrdersCursor cursor = parseCursor(cursorValue);
        CoupangOrdersCursor.DateWindow window = cursor.windowFor(today);
        String path = String.format(ORDERSHEETS_PATH_FMT, vendorId);

        // shipmentBoxId -> row; de-dup across the six status queries (defensive) and pages.
        Map<String, OrderRow> collected = new LinkedHashMap<>();
        for (String status : STATUSES) {
            String nextToken = null;
            int pages = 0;
            do {
                Map<String, String> params = new LinkedHashMap<>();
                params.put("createdAtFrom", window.fromParam());
                params.put("createdAtTo", window.toParam());
                params.put("status", status);
                params.put("maxPerPage", Integer.toString(MAX_PER_PAGE));
                if (nextToken != null && !nextToken.isBlank()) {
                    params.put("nextToken", nextToken);
                }
                OrdersheetEnvelope envelope = getOrdersheets(accessKey, secretKey, vendorId, path, params);
                for (Ordersheet item : envelope.dataOrEmpty()) {
                    OrderRow row = toRow(item);
                    collected.putIfAbsent(row.externalOrderId(), row);
                }
                nextToken = envelope.nextToken();
                if (++pages > MAX_PAGES_PER_STATUS) {
                    throw new IllegalStateException(
                            "쿠팡 주문 목록 페이지 상한을 초과했습니다. 수집 기간을 좁혀 주세요.");
                }
            } while (nextToken != null && !nextToken.isBlank());
        }

        List<OrderRow> rows = new ArrayList<>(collected.values());
        CoupangOrdersCursor next = cursor.sweptThrough(today);
        return FetchPage.ofWithOrders(DataType.ORDER_SUMMARY,
                dailySummaries(rows), perOrderRecords(rows),
                serialize(next), false, CoupangApiConnector.KIND);
    }

    private OrdersheetEnvelope getOrdersheets(String accessKey, String secretKey, String vendorId,
                                              String path, Map<String, String> params) {
        CoupangHttpClient.Response response = signedGet(path, params, accessKey, secretKey, vendorId);
        if (response.statusCode() == 429) {
            throw CoupangRateLimitedException.fromResponse(response);
        }
        if (response.statusCode() != 200) {
            throw new IllegalStateException(
                    "쿠팡 주문 목록 조회에 실패했습니다 (HTTP " + response.statusCode() + ")"
                            + httpErrorDetail(response.body()) + ".");
        }
        return read(response.body(), OrdersheetEnvelope.class, "쿠팡 주문 목록 응답을 해석할 수 없습니다.");
    }

    // --- connect-test probes ----------------------------------------------

    /**
     * Result of the credential/environment check — a low-privilege authenticated GET
     * ({@code returnShippingCenters}) whose only purpose is to prove the HMAC credential is
     * accepted by the gateway and the caller IP is allowed, WITHOUT asserting order access.
     */
    public enum CredentialProbe {
        /** HTTP 200 — signature accepted and IP allowed. */
        OK,
        /** HTTP 401 — invalid HMAC signature / credential. */
        INVALID,
        /** HTTP 403 with the official "Not allowed IP" body — caller IP not registered. */
        IP_DENIED,
        /** HTTP 429 — throttled; inconclusive. */
        RATE_LIMITED,
        /** 5xx / network / other we-side error — inconclusive. */
        UNAVAILABLE,
        /**
         * HTTP 403 that is NOT the IP marker — the signature was accepted (else 401), so the
         * credential is valid but this resource is forbidden. Inconclusive for CREDENTIAL
         * validity: the order-access probe answers authoritatively.
         */
        INCONCLUSIVE_FORBIDDEN
    }

    /**
     * Credential + call-environment check: one signed {@code returnShippingCenters} GET,
     * classified by HTTP status (and, for 403, the fixed IP marker). Reads nothing into the
     * product, persists nothing. Never throws for an HTTP outcome; a transport failure is
     * {@link CredentialProbe#UNAVAILABLE}.
     */
    public CredentialProbe credentialProbe(String accessKey, String secretKey, String vendorId) {
        String path = String.format(RETURN_CENTERS_PATH_FMT, vendorId);
        Map<String, String> params = new LinkedHashMap<>();
        params.put("pageNum", "1");
        params.put("pageSize", "1");

        CoupangHttpClient.Response response;
        try {
            response = signedGet(path, params, accessKey, secretKey, vendorId);
        } catch (IllegalStateException e) {
            return CredentialProbe.UNAVAILABLE;
        }
        int status = response.statusCode();
        if (status == 200) {
            return CredentialProbe.OK;
        }
        if (status == 401) {
            return CredentialProbe.INVALID;
        }
        if (status == 429) {
            return CredentialProbe.RATE_LIMITED;
        }
        if (status >= 500) {
            return CredentialProbe.UNAVAILABLE;
        }
        if (status == 403) {
            return isIpDenied(response.body()) ? CredentialProbe.IP_DENIED : CredentialProbe.INCONCLUSIVE_FORBIDDEN;
        }
        return CredentialProbe.UNAVAILABLE;
    }

    /**
     * Result of the order-access probe — the separate question the credential check can never
     * answer: does this vendor actually have order-API access, or will the first sync hit a
     * permission / call-IP wall?
     */
    public enum OrderAccessProbe {
        /** HTTP 200 — the order endpoint granted access (any data is discarded). */
        CONFIRMED,
        /** HTTP 429 — throttled; inconclusive. */
        RATE_LIMITED,
        /** 5xx / network / a we-side 4xx (400/401/…) — inconclusive, never blocks a valid credential. */
        UNAVAILABLE,
        /** HTTP 403 with the official "Not allowed IP" body — the caller IP is not registered. */
        CALL_IP_DENIED,
        /** HTTP 403 without the IP marker — order access denied, cause not distinguishable (hedged). */
        ACCESS_DENIED
    }

    /**
     * Read-only order-access probe: one signed {@code ordersheets} GET over a deliberately
     * narrow recent window ({@code status=ACCEPT}, {@code maxPerPage=1}), classified by HTTP
     * status (and, for 403, the fixed IP marker). Persists nothing, ingests nothing; the body
     * is read only for its status/marker then discarded. Never throws for an HTTP outcome.
     *
     * <p><b>Honesty boundary.</b> A 403 is order-access-denied by the HTTP-standard meaning of
     * the status. Coupang's IP denial carries a fixed body marker, so an IP cause IS
     * distinguishable; any OTHER 403 (e.g. an ungranted order API scope) stays the hedged
     * {@link OrderAccessProbe#ACCESS_DENIED} — never guessed into a specific code. A 401 here
     * (the credential was already checked separately) or any other 4xx is a we-side/transient
     * condition that must not block a proven credential — {@link OrderAccessProbe#UNAVAILABLE}.
     */
    public OrderAccessProbe probeOrderAccess(String accessKey, String secretKey, String vendorId) {
        LocalDate today = LocalDate.ofInstant(clock.instant(), KST);
        String path = String.format(ORDERSHEETS_PATH_FMT, vendorId);
        Map<String, String> params = new LinkedHashMap<>();
        params.put("createdAtFrom", today.minusDays(1).toString());
        params.put("createdAtTo", today.toString());
        params.put("status", "ACCEPT");
        params.put("maxPerPage", "1");

        CoupangHttpClient.Response response;
        try {
            response = signedGet(path, params, accessKey, secretKey, vendorId);
        } catch (IllegalStateException e) {
            return OrderAccessProbe.UNAVAILABLE;
        }
        int status = response.statusCode();
        if (status == 200) {
            return OrderAccessProbe.CONFIRMED;
        }
        if (status == 429) {
            return OrderAccessProbe.RATE_LIMITED;
        }
        if (status >= 500) {
            return OrderAccessProbe.UNAVAILABLE;
        }
        if (status == 403) {
            return isIpDenied(response.body()) ? OrderAccessProbe.CALL_IP_DENIED : OrderAccessProbe.ACCESS_DENIED;
        }
        return OrderAccessProbe.UNAVAILABLE;
    }

    // --- mapping ----------------------------------------------------------

    private OrderRow toRow(Ordersheet item) {
        String shipmentBoxId = item.shipmentBoxId() == null ? null : item.shipmentBoxId().toString();
        if (shipmentBoxId == null || shipmentBoxId.isBlank()) {
            throw new IllegalStateException("쿠팡 주문 응답에 배송번호(shipmentBoxId)가 없습니다.");
        }
        if (item.status() == null || item.status().isBlank()) {
            throw new IllegalStateException("쿠팡 주문 응답에 주문 상태(status)가 없습니다.");
        }
        Instant paidAt = parseInstantOrNull(item.paidAt());
        Instant orderedAt = parseInstantOrNull(item.orderedAt());
        Instant basis = paidAt != null ? paidAt : orderedAt;
        if (basis == null) {
            throw new IllegalStateException("쿠팡 주문 응답에 결제/주문 시각이 없습니다.");
        }
        return new OrderRow(
                shipmentBoxId,
                item.orderId() == null ? null : item.orderId().toString(),
                item.status(),
                orderAmount(item),
                LocalDate.ofInstant(basis, KST),
                paidAt);
    }

    /** Σ orderItems[].orderPrice — the official "price to be paid". Fails closed on a missing amount. */
    private static long orderAmount(Ordersheet item) {
        List<OrderItem> items = item.orderItems();
        if (items == null || items.isEmpty()) {
            throw new IllegalStateException("쿠팡 주문 응답에 주문 상품(orderItems)이 없습니다.");
        }
        long total = 0;
        for (OrderItem line : items) {
            if (line.orderPrice() == null) {
                // A truthful salesAmount is impossible without the amount — fail the page rather
                // than emit a wrong daily total (symmetric with the status/id checks).
                throw new IllegalStateException("쿠팡 주문 응답에 주문 금액(orderPrice)이 없습니다.");
            }
            total += line.orderPrice();
        }
        return total;
    }

    /** One complete daily summary per KST summary date the swept window touched. */
    private static List<CanonicalOrderSummary> dailySummaries(List<OrderRow> rows) {
        Map<LocalDate, long[]> byDate = new TreeMap<>(); // date -> [orderCount, salesAmount]
        for (OrderRow row : rows) {
            long[] cell = byDate.computeIfAbsent(row.summaryDate(), d -> new long[2]);
            cell[0] += 1;
            cell[1] += row.paymentAmount();
        }
        List<CanonicalOrderSummary> out = new ArrayList<>();
        int sourceRow = 1;
        for (Map.Entry<LocalDate, long[]> entry : byDate.entrySet()) {
            out.add(new CanonicalOrderSummary(
                    entry.getKey(), (int) entry.getValue()[0], entry.getValue()[1], sourceRow++));
        }
        return out;
    }

    /** Per-shipment-box canonical rows — the same set the daily total is built from. */
    private static List<CanonicalOrder> perOrderRecords(List<OrderRow> rows) {
        List<CanonicalOrder> out = new ArrayList<>();
        int sourceRow = 1;
        for (OrderRow row : rows) {
            out.add(new CanonicalOrder(
                    row.externalOrderId(),
                    row.parentOrderId(),
                    row.rawStatusCode(),
                    row.paymentAmount(),
                    row.summaryDate(),
                    row.paidAt(),
                    // Coupang's basic ordersheet carries no status-change timestamp; left null
                    // rather than mislabeling paidAt as a status change.
                    null,
                    sourceRow++));
        }
        return out;
    }

    /** Internal projection of one shipment box, PII-free. */
    private record OrderRow(
            String externalOrderId, String parentOrderId, String rawStatusCode,
            long paymentAmount, LocalDate summaryDate, Instant paidAt) {
    }

    // --- signed transport -------------------------------------------------

    private CoupangHttpClient.Response signedGet(String path, Map<String, String> params,
                                                 String accessKey, String secretKey, String vendorId) {
        String query = buildQuery(params);
        // The signer stamps a single signed-date and signs signedDate+method+path+query; the
        // SAME encoded query string is what we send, so the signature always matches the request.
        String authorization = signer.authorization(accessKey, secretKey, "GET", path, query);
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Authorization", authorization);
        headers.put("X-Requested-By", vendorId);
        headers.put("X-MARKET", MARKET);
        URI uri = URI.create(baseUrl + path + (query.isEmpty() ? "" : "?" + query));
        return http.get(uri, headers);
    }

    private static String buildQuery(Map<String, String> params) {
        StringBuilder query = new StringBuilder();
        for (Map.Entry<String, String> entry : params.entrySet()) {
            if (query.length() > 0) {
                query.append('&');
            }
            query.append(URLEncoder.encode(entry.getKey(), StandardCharsets.UTF_8))
                    .append('=')
                    .append(URLEncoder.encode(entry.getValue(), StandardCharsets.UTF_8));
        }
        return query.toString();
    }

    private static boolean isIpDenied(String body) {
        return body != null && body.toLowerCase(Locale.ROOT).contains(IP_DENIED_MARKER);
    }

    private static Instant parseInstantOrNull(String timestamp) {
        if (timestamp == null || timestamp.isBlank()) {
            return null;
        }
        try {
            return OffsetDateTime.parse(timestamp).toInstant();
        } catch (Exception e) {
            return null;
        }
    }

    private CoupangOrdersCursor parseCursor(String cursorValue) {
        if (cursorValue == null || cursorValue.isBlank()) {
            return CoupangOrdersCursor.initial();
        }
        return read(cursorValue, CoupangOrdersCursor.class, "쿠팡 주문 커서를 해석할 수 없습니다.");
    }

    private String serialize(CoupangOrdersCursor cursor) {
        try {
            return mapper.writeValueAsString(cursor);
        } catch (Exception e) {
            throw new IllegalStateException("쿠팡 주문 커서 직렬화에 실패했습니다.");
        }
    }

    private <T> T read(String json, Class<T> type, String failureMessage) {
        try {
            return mapper.readValue(json, type);
        } catch (Exception e) {
            // Response bodies stay out of messages (order endpoints can carry PII).
            throw new IllegalStateException(failureMessage);
        }
    }

    /**
     * A sanitized, length-capped diagnostic for a non-2xx Coupang response — surfaces only the
     * known scalar error fields ({@link #SAFE_ERROR_FIELDS}); nested objects/arrays, headers,
     * and the raw body are never included. Returns {@code ""} when nothing safe is parseable.
     */
    private String httpErrorDetail(String body) {
        if (body == null || body.isBlank()) {
            return "";
        }
        try {
            JsonNode root = mapper.readTree(body);
            if (root == null || !root.isObject()) {
                return "";
            }
            LinkedHashMap<String, String> picked = new LinkedHashMap<>();
            for (String field : SAFE_ERROR_FIELDS) {
                JsonNode value = root.get(field);
                if (value != null && value.isValueNode() && !value.asText().isBlank()) {
                    picked.put(field, value.asText());
                }
            }
            if (picked.isEmpty()) {
                return "";
            }
            String detail = picked.entrySet().stream()
                    .map(e -> e.getKey() + "=" + e.getValue())
                    .collect(Collectors.joining(", "));
            if (detail.length() > MAX_ERROR_DETAIL) {
                detail = detail.substring(0, MAX_ERROR_DETAIL) + "…";
            }
            return " [" + detail + "]";
        } catch (Exception e) {
            return "";
        }
    }

    // --- response DTOs (officially confirmed field names only) ------------

    @JsonIgnoreProperties(ignoreUnknown = true)
    record OrdersheetEnvelope(Integer code, String message, List<Ordersheet> data, String nextToken) {
        List<Ordersheet> dataOrEmpty() {
            return data != null ? data : List.of();
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record Ordersheet(
            Long shipmentBoxId,
            Long orderId,
            String status,
            String orderedAt,
            String paidAt,
            List<OrderItem> orderItems) {
    }

    /** Amount basis: orderPrice (= salesPrice × shippingCount, "price to be paid"). */
    @JsonIgnoreProperties(ignoreUnknown = true)
    record OrderItem(Long orderPrice) {
    }
}
