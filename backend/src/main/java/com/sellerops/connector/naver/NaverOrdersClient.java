package com.sellerops.connector.naver;

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
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.stream.Collectors;

/**
 * The officially recommended two-call order collection flow (commerce-api FAQ #9,
 * approved for Slice 1b):
 *
 * <ol>
 *   <li>{@code GET /external/v1/pay-order/seller/product-orders/last-changed-statuses}
 *       — changed product orders for a ≤24h {@code lastChangedDate} window,
 *       filtered to {@code lastChangedType=PAYED}; paginated via the
 *       {@code data.more} block ({@code moreFrom}/{@code moreSequence}).</li>
 *   <li>{@code POST /external/v1/pay-order/seller/product-orders/query}
 *       — detail lookup (batched {@code productOrderIds}) for the payment
 *       amounts, joined back by product order id.</li>
 * </ol>
 *
 * <p><b>Amount basis:</b> {@code productOrder.initialPaymentAmount} — the
 * post-discount payment at order time. {@code totalPaymentAmount} is deprecated
 * (removal announced for 2025) and must not be read.
 * {@code remainPaymentAmount} (claim-adjusted net) is a deliberate later
 * refinement, not used yet.
 *
 * <p><b>Mapping semantics:</b> one {@link CanonicalOrderSummary} per KST
 * calendar date of {@code paymentDate} ({@code lastChangedDate} fallback);
 * {@code orderCount} counts <b>paid product-order rows</b> (상품주문 단위) —
 * distinct-{@code orderId} counting would require carrying unbounded id sets in
 * the cursor; the upload parser's operator-supplied 주문수 column sets no
 * precedent either way. Emitted values are cumulative-so-far per date (see
 * {@link NaverOrdersCursor#dayTotals}) because ingestion upserts by (channel,
 * date) and overwrites.
 *
 * <p>Rate limiting (HTTP 429) on either call throws
 * {@link NaverRateLimitedException}; the connector maps it to a rate-limited
 * page with the cursor unchanged, so a retry re-requests the same position.
 */
public class NaverOrdersClient {

    static final String LAST_CHANGED_PATH = "/external/v1/pay-order/seller/product-orders/last-changed-statuses";
    static final String DETAIL_QUERY_PATH = "/external/v1/pay-order/seller/product-orders/query";
    /** Only payment-completed transitions feed the sales summary. */
    static final String LAST_CHANGED_TYPE = "PAYED";
    /**
     * The connect-test order-access probe reads one recent, deliberately narrow
     * window — enough to exercise the order endpoint's authorization without pulling
     * a meaningful volume of changed orders (which are discarded regardless).
     */
    static final Duration PROBE_WINDOW = Duration.ofMinutes(5);
    /**
     * Provider error codes that positively identify a MISSING-ORDER-PERMISSION cause.
     * Intentionally EMPTY: the exact NAVER {@code GW.*} string for this cause has not
     * been captured from a real gateway response, and it is never guessed. A 403 whose
     * code is unrecognized is reported as the hedged {@link OrderAccessProbe#ACCESS_DENIED},
     * not misattributed. Fill only from an approved live capture.
     */
    private static final Set<String> PERMISSION_DENIED_CODES = Set.of();
    /**
     * Provider error codes that positively identify an UNREGISTERED-CALL-IP cause.
     * Intentionally EMPTY for the same reason as {@link #PERMISSION_DENIED_CODES}
     * — the distinguishing {@code GW.*} string is unknown and never guessed.
     */
    private static final Set<String> CALL_IP_DENIED_CODES = Set.of();
    /** Seller business timezone; Naver timestamps already carry +09:00. */
    static final ZoneId KST = ZoneId.of("Asia/Seoul");
    /**
     * Scalar fields a Naver error envelope may carry — safe to surface for
     * diagnostics. Nested objects/arrays (which could hold order PII) are never
     * read; see {@link #httpErrorDetail}.
     */
    private static final List<String> SAFE_ERROR_FIELDS =
            List.of("code", "errorCode", "error", "message", "errorMessage");
    /** Hard cap on the sanitized diagnostic appended to an HTTP-error message. */
    private static final int MAX_ERROR_DETAIL = 200;

    private final NaverHttpClient http;
    private final Clock clock;
    private final String baseUrl;
    private final int detailBatchSize;
    private final ObjectMapper mapper = new ObjectMapper();

    public NaverOrdersClient(NaverHttpClient http, Clock clock, String baseUrl, int detailBatchSize) {
        this.http = http;
        this.clock = clock;
        this.baseUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
        this.detailBatchSize = detailBatchSize;
    }

    /**
     * Fetch one incremental ORDER_SUMMARY page. {@code cursorValue} is the
     * serialized {@link NaverOrdersCursor} (null/blank = first collection).
     *
     * @throws NaverRateLimitedException on HTTP 429 from either order call
     */
    public FetchPage fetchOrderSummaryPage(String accessToken, String cursorValue) {
        Instant now = clock.instant();
        NaverOrdersCursor cursor = parseCursor(cursorValue, now);
        if (cursor.isCaughtUp(now)) {
            // Caught up to "now": nothing to query until time passes.
            return FetchPage.of(DataType.ORDER_SUMMARY, List.of(), serialize(cursor), false,
                    NaverApiConnector.KIND);
        }
        // A settled window can sit at windowTo == windowFrom after catching up to a
        // past instant; widen its upper bound to "now" so we query (windowFrom, now]
        // instead of a zero-width range (lastChangedFrom == lastChangedTo), which Naver
        // rejects with HTTP 400. A continuation keeps its fixed window.
        if (!cursor.isContinuation()) {
            cursor = cursor.withWindowThrough(now, KST);
        }

        LastChangedData page = lastChangedStatuses(accessToken, cursor);
        CountablePage countable = selectCountable(cursor, page.items(), page.more());
        Map<String, Long> amounts = countable.items().isEmpty()
                ? Map.of()
                : detailAmounts(accessToken, countable.productOrderIds());

        Map<String, NaverOrdersCursor.DayTotal> merged =
                mergeTotals(cursor.dayTotals(), countable.items(), amounts);
        boolean windowContinues = page.more() != null && page.more().moreSequence() != null;
        NaverOrdersCursor next = windowContinues
                ? cursor.continued(page.more().moreFrom(), page.more().moreSequence(), merged,
                        countable.edgeIds(), nextDedupeIds(cursor, page.more(), countable.pageEdgeIds()))
                : cursor.advanced(now, KST, merged, countable.edgeIds());
        boolean hasMore = windowContinues || !next.isCaughtUp(now);

        return FetchPage.ofWithOrders(DataType.ORDER_SUMMARY,
                summaries(merged, countable.touchedDates()),
                perOrderRecords(countable.items(), amounts),
                serialize(next), hasMore, NaverApiConnector.KIND);
    }

    /**
     * Status-aware result of the connect-test order-access probe. The connect test
     * mints a token (credential proof) and then calls this to answer the SEPARATE
     * question the token can never answer: does this app actually have order-API
     * access, or will the first sync fail on a permission / call-IP wall?
     */
    public enum OrderAccessProbe {
        /** HTTP 200 — the order endpoint granted access (data, if any, is discarded). */
        CONFIRMED,
        /** HTTP 429 — throttled; inconclusive, never a credential verdict. */
        RATE_LIMITED,
        /** 5xx / network / a we-side 4xx (400/401/…) — inconclusive, never blocks a valid credential. */
        UNAVAILABLE,
        /** 403 with a live-captured permission code — the app lacks the order API group. */
        PERMISSION_DENIED,
        /** 403 with a live-captured call-IP code — the caller IP is not registered. */
        CALL_IP_DENIED,
        /** 403 whose code is unrecognized — access denied, cause not distinguishable (hedged). */
        ACCESS_DENIED
    }

    /**
     * Read-only connect-test probe: one {@code GET last-changed-statuses} over a
     * narrow recent window, classified by HTTP status (and, for 403 only, a
     * sanitized envelope {@code code}). Persists no cursor, ingests nothing, and
     * makes no detail call — the response body is read only for its status and, on
     * 403, its {@code code}, then discarded. Never throws for an HTTP outcome; a
     * transport failure is reported as {@link OrderAccessProbe#UNAVAILABLE}.
     *
     * <p><b>Honesty boundary.</b> A 403 is order-access-denied by the HTTP-standard
     * meaning of the status — that is not a guess. Splitting it into permission vs
     * call-IP requires a real {@code GW.*} code that has not been captured, so an
     * unrecognized 403 is the hedged {@link OrderAccessProbe#ACCESS_DENIED}. Any
     * other 4xx (a malformed-parameter 400, an at-resource 401) is a we-side or
     * transient condition that must never block a credential the token step already
     * accepted — it is {@link OrderAccessProbe#UNAVAILABLE} (inconclusive).
     */
    public OrderAccessProbe probeOrderAccess(String accessToken) {
        NaverOrdersCursor window = NaverOrdersCursor.probeWindow(clock.instant(), KST, PROBE_WINDOW);
        Map<String, String> params = new LinkedHashMap<>();
        params.put("lastChangedFrom", window.windowFrom());
        params.put("lastChangedTo", window.windowTo());
        params.put("lastChangedType", LAST_CHANGED_TYPE);

        NaverHttpClient.Response response;
        try {
            response = http.get(uri(LAST_CHANGED_PATH, params), accessToken);
        } catch (IllegalStateException e) {
            // JdkNaverHttpClient wraps network/interrupt failures — inconclusive, not a denial.
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
            String code = errorEnvelopeCode(response.body());
            if (code != null && PERMISSION_DENIED_CODES.contains(code)) {
                return OrderAccessProbe.PERMISSION_DENIED;
            }
            if (code != null && CALL_IP_DENIED_CODES.contains(code)) {
                return OrderAccessProbe.CALL_IP_DENIED;
            }
            return OrderAccessProbe.ACCESS_DENIED;
        }
        // Other 4xx (400 malformed param, 401 at resource, 404, …): the token step
        // already accepted the credential, so a we-side/transient request error here
        // must not be reported as a denial.
        return OrderAccessProbe.UNAVAILABLE;
    }

    /**
     * The sanitized envelope {@code code} scalar only (never the body, never PII),
     * or null when absent/unparseable — mirrors {@link NaverRateLimitedException#classify}.
     * Used solely to look up a 403 cause in the never-guessed code whitelists.
     */
    private String errorEnvelopeCode(String body) {
        if (body == null || body.isBlank()) {
            return null;
        }
        try {
            JsonNode root = mapper.readTree(body);
            JsonNode code = root == null ? null : root.get("code");
            if (code == null || !code.isValueNode()) {
                return null;
            }
            String value = code.asText();
            return value.isBlank() ? null : value;
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * One page's items reduced to what may be counted: page-local duplicates
     * collapse, ids re-delivered from the previous boundary ({@code dedupeIds})
     * are skipped, and items whose summary date falls before the emission
     * horizon are skipped entirely — their carried totals were pruned, so
     * emitting them would overwrite a final daily total with a partial recount.
     * Window-edge ids ({@code lastChangedDate == windowTo}) feed the next
     * window's skip set; page-edge ids ({@code == more.moreFrom}) feed the next
     * continuation page's. When {@code moreFrom} matches no delivered item's
     * timestamp, the continuation starts strictly after every delivered item —
     * an empty page-edge set is the correct no-overlap case, not a miss.
     */
    private CountablePage selectCountable(NaverOrdersCursor cursor, List<LastChangeStatus> items,
                                          More more) {
        Instant windowTo = cursor.windowToInstant();
        Instant nextPageFrom = more != null ? parseInstantOrNull(more.moreFrom()) : null;
        LocalDate horizon = cursor.emissionHorizon(KST);
        LinkedHashSet<String> skip = new LinkedHashSet<>(cursor.dedupeIds());
        LinkedHashSet<String> seen = new LinkedHashSet<>();
        List<LastChangeStatus> countable = new ArrayList<>();
        List<String> edgeIds = new ArrayList<>();
        List<String> pageEdgeIds = new ArrayList<>();
        LinkedHashSet<String> touchedDates = new LinkedHashSet<>();
        for (LastChangeStatus item : items) {
            String id = item.productOrderId();
            if (id == null || id.isBlank()) {
                continue;
            }
            Instant stamped = parseInstantOrNull(item.lastChangedDate());
            if (stamped != null && stamped.equals(windowTo)) {
                edgeIds.add(id);
            }
            if (stamped != null && stamped.equals(nextPageFrom)) {
                pageEdgeIds.add(id);
            }
            if (skip.contains(id) || !seen.add(id)) {
                continue;
            }
            String date = summaryDate(item);
            if (LocalDate.parse(date).isBefore(horizon)) {
                continue;
            }
            countable.add(item);
            touchedDates.add(date);
        }
        return new CountablePage(countable, edgeIds, pageEdgeIds, touchedDates);
    }

    /**
     * The next continuation page's skip set. Replace with this page's
     * boundary-stamped ids when {@code moreFrom} moved forward in time (earlier
     * boundaries can no longer be re-delivered, so the set stays bounded);
     * union with the previous skip set when it did not (a full page of
     * same-instant events — the previous boundary's ids remain re-deliverable).
     */
    private List<String> nextDedupeIds(NaverOrdersCursor cursor, More more, List<String> pageEdgeIds) {
        Instant nextFrom = parseInstantOrNull(more.moreFrom());
        Instant requestFrom = cursor.isContinuation() && cursor.moreFrom() != null
                ? parseInstantOrNull(cursor.moreFrom())
                : cursor.windowFromInstant();
        boolean movedForward = nextFrom != null && requestFrom != null && nextFrom.isAfter(requestFrom);
        if (movedForward) {
            return pageEdgeIds;
        }
        LinkedHashSet<String> union = new LinkedHashSet<>(cursor.dedupeIds());
        union.addAll(pageEdgeIds);
        return new ArrayList<>(union);
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

    private record CountablePage(
            List<LastChangeStatus> items, List<String> edgeIds, List<String> pageEdgeIds,
            LinkedHashSet<String> touchedDates) {

        List<String> productOrderIds() {
            return items.stream().map(LastChangeStatus::productOrderId).toList();
        }
    }

    // --- call 1: last-changed-statuses ---

    private LastChangedData lastChangedStatuses(String accessToken, NaverOrdersCursor cursor) {
        Map<String, String> params = new LinkedHashMap<>();
        params.put("lastChangedFrom",
                cursor.isContinuation() && cursor.moreFrom() != null ? cursor.moreFrom() : cursor.windowFrom());
        params.put("lastChangedTo", cursor.windowTo());
        params.put("lastChangedType", LAST_CHANGED_TYPE);
        if (cursor.isContinuation()) {
            params.put("moreSequence", cursor.moreSequence());
        }
        NaverHttpClient.Response response = http.get(uri(LAST_CHANGED_PATH, params), accessToken);
        if (response.statusCode() == 429) {
            throw NaverRateLimitedException.fromResponse(response);
        }
        if (response.statusCode() != 200) {
            throw new IllegalStateException(
                    "네이버 변경 주문 조회에 실패했습니다 (HTTP " + response.statusCode() + ")"
                            + httpErrorDetail(response.body()) + ".");
        }
        LastChangedEnvelope envelope = read(response.body(), LastChangedEnvelope.class,
                "네이버 변경 주문 응답을 해석할 수 없습니다.");
        if (envelope.data() == null) {
            return new LastChangedData(List.of(), null);
        }
        return new LastChangedData(
                envelope.data().lastChangeStatuses() != null ? envelope.data().lastChangeStatuses() : List.of(),
                envelope.data().more());
    }

    // --- call 2: product-orders/query (batched) ---

    private Map<String, Long> detailAmounts(String accessToken, List<String> productOrderIds) {
        Map<String, Long> amounts = new LinkedHashMap<>();
        for (int from = 0; from < productOrderIds.size(); from += detailBatchSize) {
            List<String> batch = productOrderIds.subList(from,
                    Math.min(from + detailBatchSize, productOrderIds.size()));
            NaverHttpClient.Response response = http.postJson(
                    uri(DETAIL_QUERY_PATH, Map.of()), accessToken, detailRequestBody(batch));
            if (response.statusCode() == 429) {
                throw NaverRateLimitedException.fromResponse(response);
            }
            if (response.statusCode() != 200) {
                throw new IllegalStateException(
                        "네이버 주문 상세 조회에 실패했습니다 (HTTP " + response.statusCode() + ")"
                                + httpErrorDetail(response.body()) + ".");
            }
            DetailEnvelope envelope = read(response.body(), DetailEnvelope.class,
                    "네이버 주문 상세 응답을 해석할 수 없습니다.");
            for (DetailItem item : envelope.data() != null ? envelope.data() : List.<DetailItem>of()) {
                DetailProductOrder po = item.productOrder();
                if (po == null || po.productOrderId() == null || po.initialPaymentAmount() == null) {
                    // Truthful salesAmount is impossible without the amount —
                    // fail the page rather than emit a wrong daily total.
                    throw new IllegalStateException(
                            "네이버 주문 상세 응답에 결제 금액(initialPaymentAmount)이 없습니다.");
                }
                amounts.put(po.productOrderId(), po.initialPaymentAmount());
            }
        }
        return amounts;
    }

    private String detailRequestBody(List<String> productOrderIds) {
        try {
            return mapper.writeValueAsString(Map.of("productOrderIds", productOrderIds));
        } catch (Exception e) {
            throw new IllegalStateException("네이버 주문 상세 요청 직렬화에 실패했습니다.");
        }
    }

    // --- mapping ---

    private Map<String, NaverOrdersCursor.DayTotal> mergeTotals(
            Map<String, NaverOrdersCursor.DayTotal> carried,
            List<LastChangeStatus> countableItems, Map<String, Long> amounts) {
        Map<String, NaverOrdersCursor.DayTotal> merged = new TreeMap<>(carried);
        for (LastChangeStatus item : countableItems) {
            Long amount = amounts.get(item.productOrderId());
            if (amount == null) {
                throw new IllegalStateException("네이버 주문 상세 응답에 누락된 상품주문이 있습니다.");
            }
            merged.merge(summaryDate(item), new NaverOrdersCursor.DayTotal(1, amount),
                    (total, one) -> total.plus(one.orders(), one.amount()));
        }
        return merged;
    }

    /** KST calendar date of paymentDate; lastChangedDate is the confirmed fallback. */
    private static String summaryDate(LastChangeStatus item) {
        String timestamp = item.paymentDate() != null && !item.paymentDate().isBlank()
                ? item.paymentDate()
                : item.lastChangedDate();
        if (timestamp == null || timestamp.isBlank()) {
            throw new IllegalStateException("네이버 변경 주문 응답에 결제/변경 시각이 없습니다.");
        }
        try {
            return OffsetDateTime.parse(timestamp).atZoneSameInstant(KST).toLocalDate().toString();
        } catch (Exception e) {
            throw new IllegalStateException("네이버 변경 주문 응답의 시각 형식을 해석할 수 없습니다.");
        }
    }

    /**
     * Emit cumulative-so-far summaries for the dates this page touched (only
     * those — untouched dates already have their latest value persisted).
     */
    private static List<CanonicalOrderSummary> summaries(
            Map<String, NaverOrdersCursor.DayTotal> merged, LinkedHashSet<String> touchedDates) {
        List<CanonicalOrderSummary> out = new ArrayList<>();
        int row = 1;
        for (String date : touchedDates) {
            NaverOrdersCursor.DayTotal total = merged.get(date);
            out.add(new CanonicalOrderSummary(LocalDate.parse(date), total.orders(), total.amount(), row++));
        }
        return out;
    }

    /**
     * The per-order projection of this page's countable items — the SAME deduped, in-horizon set the
     * daily total is built from, so the two aggregations stay consistent by construction. Each paid
     * product order carries only fields the API returns (id, parent id, raw status, amount, payment
     * and status-change times) keyed to the same KST summary date; buyer PII is never read here.
     */
    private static List<CanonicalOrder> perOrderRecords(List<LastChangeStatus> items, Map<String, Long> amounts) {
        List<CanonicalOrder> out = new ArrayList<>();
        int row = 1;
        for (LastChangeStatus item : items) {
            Long amount = amounts.get(item.productOrderId());
            if (amount == null) {
                // Same invariant the daily merge enforces: no truthful record without the amount.
                throw new IllegalStateException("네이버 주문 상세 응답에 누락된 상품주문이 있습니다.");
            }
            String rawStatus = item.productOrderStatus();
            if (rawStatus == null || rawStatus.isBlank()) {
                // Fail closed on the one required status field, symmetric with the amount check —
                // a per-order row must never carry a null/blank status into persistence.
                throw new IllegalStateException("네이버 변경 주문 응답에 주문 상태(productOrderStatus)가 없습니다.");
            }
            out.add(new CanonicalOrder(
                    item.productOrderId(),
                    item.orderId(),
                    rawStatus,
                    amount,
                    LocalDate.parse(summaryDate(item)),
                    parseInstantOrNull(item.paymentDate()),
                    parseInstantOrNull(item.lastChangedDate()),
                    row++));
        }
        return out;
    }

    // --- plumbing ---

    private NaverOrdersCursor parseCursor(String cursorValue, Instant now) {
        if (cursorValue == null || cursorValue.isBlank()) {
            return NaverOrdersCursor.initial(now, KST);
        }
        NaverOrdersCursor cursor = read(cursorValue, NaverOrdersCursor.class,
                "네이버 주문 커서를 해석할 수 없습니다.");
        // Semantic validation, not just JSON syntax: a corrupt window must fail
        // here as a cursor error, not later as a bad API request.
        try {
            if (cursor.windowToInstant().isBefore(cursor.windowFromInstant())) {
                throw new IllegalArgumentException("windowTo precedes windowFrom");
            }
        } catch (Exception e) {
            throw new IllegalStateException("네이버 주문 커서를 해석할 수 없습니다.");
        }
        return cursor;
    }

    private String serialize(NaverOrdersCursor cursor) {
        try {
            return mapper.writeValueAsString(cursor);
        } catch (Exception e) {
            throw new IllegalStateException("네이버 주문 커서 직렬화에 실패했습니다.");
        }
    }

    private <T> T read(String json, Class<T> type, String failureMessage) {
        try {
            return mapper.readValue(json, type);
        } catch (Exception e) {
            // Response bodies stay out of messages (could carry order PII).
            throw new IllegalStateException(failureMessage);
        }
    }

    /**
     * A sanitized, length-capped diagnostic for a non-2xx Naver order response —
     * used only on the error path, never on a 200 body. Surfaces only the known
     * scalar error fields (code/message and aliases, see {@link #SAFE_ERROR_FIELDS});
     * nested objects/arrays, headers, tokens, and the raw body (which can carry
     * order PII on these endpoints) are never included. Returns {@code ""} when no
     * safe field is parseable, so the caller keeps the bare {@code (HTTP {status})}.
     * Format when present: {@code " [code=..., message=...]"}.
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
                // Scalars only — never a nested object/array that might hold PII.
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
            // Unparseable body — keep the bare status, never echo raw bytes.
            return "";
        }
    }

    private URI uri(String path, Map<String, String> params) {
        if (params.isEmpty()) {
            return URI.create(baseUrl + path);
        }
        StringBuilder query = new StringBuilder();
        for (Map.Entry<String, String> e : params.entrySet()) {
            if (query.length() > 0) {
                query.append('&');
            }
            // Encode exactly once (official caveat: double-encoding breaks the call).
            query.append(URLEncoder.encode(e.getKey(), StandardCharsets.UTF_8))
                    .append('=')
                    .append(URLEncoder.encode(e.getValue(), StandardCharsets.UTF_8));
        }
        return URI.create(baseUrl + path + "?" + query);
    }

    // --- response DTOs (officially confirmed field names only) ---

    @JsonIgnoreProperties(ignoreUnknown = true)
    record LastChangedEnvelope(LastChangedBody data) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record LastChangedBody(List<LastChangeStatus> lastChangeStatuses, More more) {
    }

    /** One changed product order; fields per official FAQ #2437. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    record LastChangeStatus(
            String productOrderId,
            String orderId,
            String productOrderStatus,
            String lastChangedDate,
            String lastChangedType,
            String paymentDate) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record More(String moreFrom, String moreSequence) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record DetailEnvelope(List<DetailItem> data) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record DetailItem(DetailProductOrder productOrder) {
    }

    /** Amount basis: initialPaymentAmount (totalPaymentAmount is deprecated — do not add). */
    @JsonIgnoreProperties(ignoreUnknown = true)
    record DetailProductOrder(String productOrderId, Long initialPaymentAmount) {
    }

    /** Internal pair: one page of changed orders plus its continuation block. */
    record LastChangedData(List<LastChangeStatus> items, More more) {
    }
}
