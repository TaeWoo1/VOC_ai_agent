package com.sellerops.connector.naver;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.connector.DataType;
import com.sellerops.connector.FetchPage;
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
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

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
    /** Seller business timezone; Naver timestamps already carry +09:00. */
    static final ZoneId KST = ZoneId.of("Asia/Seoul");

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

        return FetchPage.of(DataType.ORDER_SUMMARY,
                summaries(merged, countable.touchedDates()), serialize(next), hasMore,
                NaverApiConnector.KIND);
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
                    "네이버 변경 주문 조회에 실패했습니다 (HTTP " + response.statusCode() + ").");
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
                        "네이버 주문 상세 조회에 실패했습니다 (HTTP " + response.statusCode() + ").");
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
