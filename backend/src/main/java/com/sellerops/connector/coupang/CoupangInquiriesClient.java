package com.sellerops.connector.coupang;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.connector.DataType;
import com.sellerops.connector.FetchPage;
import com.sellerops.ingest.canonical.CanonicalInquiry;
import java.net.URI;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The officially documented Coupang WING Open API 상품별 고객문의 collection flow
 * (developers.coupang.com, "Customer Inquiry Query by Product"):
 *
 * <pre>GET /v2/providers/openapi/apis/api/v5/vendors/{vendorId}/onlineInquiries
 *     ?answeredType={ALL|ANSWERED|NOANSWER}&amp;inquiryStartAt={yyyy-MM-dd}&amp;inquiryEndAt={yyyy-MM-dd}
 *     &amp;pageNum={n}&amp;pageSize=50</pre>
 *
 * <p><b>Why THIS inquiry endpoint.</b> Coupang exposes two customer-inquiry APIs and they are not
 * interchangeable. This one — the product-page Q&amp;A a buyer posts on a listing — returns
 * <b>no buyer PII whatsoever</b>. The other ({@code callCenterInquiries}, 쿠팡 고객센터 문의)
 * returns {@code buyerEmail} and {@code buyerPhone} and carries transfer/confirm semantics that
 * imply seller obligations SellerOps does not model. It is deliberately NOT called here: a stream
 * that cannot leak buyer PII is better than one that must remember not to. Adding it is a separate
 * decision with its own PII handling, not a widening of this client.
 *
 * <p><b>Why a two-bucket sweep.</b> {@code answeredType} is required, and the platform's own
 * answered/unanswered classification is authoritative — far better than inferring it from
 * {@code commentDtoList}, whose entries carry no author field and so cannot distinguish a seller's
 * answer from a buyer's follow-up. Each window is therefore swept twice, once per bucket, and the
 * bucket the row arrived in <i>is</i> its status. {@link #ANSWERED_TYPES} is ordered
 * {@code NOANSWER} then {@code ANSWERED} so that an inquiry answered between the two calls is
 * recorded as ANSWERED (last write wins) rather than left falsely open.
 *
 * <p><b>Window.</b> The endpoint caps a query at 7 days, a quarter of the order endpoint's 31, so
 * the initial import is a backward walk of 7-day windows driven by {@link CoupangInquiryCursor}
 * rather than a single sweep.
 *
 * <p><b>A row that cannot be represented truthfully is skipped, not fabricated — and the page
 * still lands.</b> This deliberately differs from {@link CoupangOrdersClient}, which fails the
 * whole page on a missing amount. There, one unreadable line would make the day's <i>aggregate</i>
 * silently wrong, so the page must fail. Here every row is independent, and failing the page would
 * wedge the stream permanently: the same bad row is re-fetched on every retry, so the cursor could
 * never advance past it. So a row missing its identity ({@code inquiryId}), its text
 * ({@code content}), or a parseable {@code inquiryAt} is counted and dropped, with a log line
 * naming the missing FIELD and never its value. Silence would be worse than either.
 *
 * <p><b>Auth.</b> Identical to the order client: per-request CEA HMAC ({@link CoupangSigner}) with
 * {@code X-Requested-By} / {@code X-MARKET}, through the same {@link CoupangLiveCallGuard} choke
 * point. A 429 throws {@link CoupangRateLimitedException} with the cursor unchanged.
 */
public class CoupangInquiriesClient {

    private static final Logger log = LoggerFactory.getLogger(CoupangInquiriesClient.class);

    static final String ONLINE_INQUIRIES_PATH_FMT =
            "/v2/providers/openapi/apis/api/v5/vendors/%s/onlineInquiries";

    /**
     * The two answered buckets, swept in this order so ANSWERED wins a same-window collision.
     * {@code ALL} is deliberately unused: it would return the union with no way to tell which side
     * a row came from, which is the one thing the sweep exists to learn.
     */
    static final List<String> ANSWERED_TYPES = List.of("NOANSWER", "ANSWERED");

    /** Official page-size ceiling for this endpoint (default 10). */
    static final int MAX_PAGE_SIZE = 50;
    /**
     * A defensive per-(bucket, window) pagination bound. 200 × 50 = 10,000 inquiries in one 7-day
     * window is far beyond any SME seller; exceeding it fails the page closed (an honest error the
     * operator can narrow) rather than looping unbounded or silently truncating.
     */
    static final int MAX_PAGES_PER_TYPE = 200;

    /** Inquiry dates are KST, like every other Coupang date window. */
    static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final String MARKET = "KR";

    /** The external-id namespace. Prefixed so a future 고객센터 stream cannot collide with this
     *  one: both number their inquiries from their own sequence, and the dedup key is
     *  (org, channel, externalId) — an unprefixed id would silently merge two different inquiries. */
    static final String EXTERNAL_ID_PREFIX = "onlineInquiry:";

    /**
     * Minimum gap between two signed calls, in milliseconds — <b>measured against a real 429, not
     * chosen from the docs.</b>
     *
     * <p>Coupang documents 429 above 5 calls/s per vendorId. One backfill window sweep is
     * {@code windows × ANSWERED_TYPES} calls issued back to back: on the live proof (2026-08-14) the
     * first 30-day backfill pushed 10 calls through in 1.6s (~6/s) and got away with it, and the
     * re-sweep minutes later did not — it took a 429 partway and needed two retries to finish. Nothing
     * was lost or duplicated (the cursor holds on a throttled page, which that run proved), but a
     * seller's first import should not need three attempts and should not show them "속도 제한".
     *
     * <p>250ms is 4 calls/s — under the documented ceiling with margin, because the limit is per
     * vendorId and the order stream may be sweeping the same vendor concurrently. The cost is ~2.5s
     * added to a full backfill, on a run that is already asynchronous.
     */
    static final long MIN_CALL_INTERVAL_MS = 250;

    /** The pause between calls, injectable so tests pace deterministically instead of sleeping. */
    interface Pacer {
        void pauseMillis(long millis);
    }

    /** The real pacer. Interrupt is restored and the sweep continues — a lost pause is not a failure. */
    static final Pacer SLEEPING_PACER = millis -> {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    };

    private final CoupangHttpClient http;
    private final CoupangSigner signer;
    private final Clock clock;
    private final String baseUrl;
    /** The armed live-run approval id — see {@link CoupangOrdersClient}; blank ⇒ a real host is refused. */
    private final String liveApprovalId;
    private final Pacer pacer;
    private final ObjectMapper mapper = new ObjectMapper();
    /** Epoch millis of the last signed call, or 0 before the first. Per-client, like the sweep itself. */
    private long lastCallAtMillis;

    public CoupangInquiriesClient(CoupangHttpClient http, CoupangSigner signer, Clock clock,
                                  String baseUrl, String liveApprovalId) {
        this(http, signer, clock, baseUrl, liveApprovalId, SLEEPING_PACER);
    }

    CoupangInquiriesClient(CoupangHttpClient http, CoupangSigner signer, Clock clock,
                           String baseUrl, String liveApprovalId, Pacer pacer) {
        this.http = http;
        this.signer = signer;
        this.clock = clock;
        this.baseUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
        this.liveApprovalId = liveApprovalId;
        this.pacer = pacer;
    }

    /**
     * Fetch one INQUIRY page — one complete KST window, both answered buckets, all pages.
     * {@code cursorValue} is the serialized {@link CoupangInquiryCursor} (null/blank = first
     * collection). During the initial backfill the returned page reports {@code hasMore=true} and
     * the cursor names the next window back; once the backfill floor is reached every page is
     * terminal and the scheduler's next run sweeps the trailing routine window.
     *
     * @throws CoupangRateLimitedException on HTTP 429 from any onlineInquiries call
     */
    public FetchPage fetchInquiryPage(String accessKey, String secretKey, String vendorId,
                                      String cursorValue) {
        LocalDate today = LocalDate.ofInstant(clock.instant(), KST);
        CoupangInquiryCursor cursor = parseCursor(cursorValue);
        CoupangInquiryCursor.Sweep sweep = cursor.sweepFor(today);
        CoupangInquiryCursor.DateWindow window = sweep.window();
        String path = String.format(ONLINE_INQUIRIES_PATH_FMT, vendorId);

        // inquiryId -> row. NOANSWER is swept first and ANSWERED second, and this is a plain put,
        // so a row present in both buckets keeps its ANSWERED reading.
        Map<Long, InquiryRow> collected = new LinkedHashMap<>();
        int dropped = 0;
        for (String answeredType : ANSWERED_TYPES) {
            int pageNum = 1;
            while (true) {
                String query = inquiriesQuery(answeredType, window.fromParam(), window.toParam(),
                        pageNum, MAX_PAGE_SIZE);
                InquiryEnvelope envelope = getInquiries(accessKey, secretKey, vendorId, path, query);
                List<OnlineInquiry> content = envelope.contentOrEmpty();
                for (OnlineInquiry item : content) {
                    InquiryRow row = toRow(item, answeredType);
                    if (row == null) {
                        dropped++;
                        continue;
                    }
                    collected.put(row.inquiryId(), row);
                }
                if (content.isEmpty()) {
                    break;
                }
                if (!envelope.hasPagination()) {
                    // No pagination block: the only honest end-of-data signal left is a SHORT page.
                    // A FULL page with no total is ambiguous — stopping would silently truncate the
                    // window, and paging on would be guessing. Fail the page closed instead.
                    if (content.size() >= MAX_PAGE_SIZE) {
                        throw new IllegalStateException(
                                "쿠팡 고객문의 응답에 페이지 정보가 없어 다음 페이지 여부를 알 수 없습니다.");
                    }
                    break;
                }
                if (!envelope.hasPageAfter(pageNum)) {
                    break;
                }
                if (++pageNum > MAX_PAGES_PER_TYPE) {
                    throw new IllegalStateException(
                            "쿠팡 고객문의 목록 페이지 상한을 초과했습니다. 수집 기간을 좁혀 주세요.");
                }
            }
        }
        if (dropped > 0) {
            // Count only — the reason is logged per row (field name, never value) at the drop site.
            log.warn("Coupang onlineInquiries rows dropped as unrepresentable: window={}..{} count={}",
                    window.fromParam(), window.toParam(), dropped);
        }

        CoupangInquiryCursor next = cursor.swept(window, sweep.more());
        return FetchPage.of(DataType.INQUIRY, canonicalRows(collected.values()),
                serialize(next), sweep.more(), CoupangApiConnector.KIND);
    }

    private InquiryEnvelope getInquiries(String accessKey, String secretKey, String vendorId,
                                         String path, String query) {
        CoupangHttpClient.Response response = signedGet(path, query, accessKey, secretKey, vendorId);
        if (response.statusCode() == 429) {
            throw CoupangRateLimitedException.fromResponse(response);
        }
        if (response.statusCode() != 200) {
            throw new IllegalStateException(
                    "쿠팡 고객문의 목록 조회에 실패했습니다 (HTTP " + response.statusCode() + ")"
                            + CoupangResponseDiagnostics.errorDetail(mapper, response.body()) + ".");
        }
        String body = response.body();
        if (body == null || body.isBlank()) {
            // A 200 with no body can't bind (and would NPE inside readValue). Fail closed with a
            // value-free message — length only, never content.
            log.warn("Coupang onlineInquiries 200-body was empty: contentType={} length={}",
                    CoupangResponseDiagnostics.contentTypeFamily(response), body == null ? 0 : body.length());
            throw new IllegalStateException("쿠팡 고객문의 목록 응답이 비어 있습니다.");
        }
        try {
            return mapper.readValue(body, InquiryEnvelope.class);
        } catch (JsonProcessingException e) {
            // A 200 whose body doesn't fit the envelope. SHAPE-ONLY diagnostic — node types, object
            // KEY-NAME sets, array counts, the Jackson binding path. No inquiry text, buyer PII,
            // id, header, or raw body is recorded.
            log.warn("Coupang onlineInquiries 200-body did not fit the envelope: {}",
                    CoupangResponseDiagnostics.shapeDiagnostic(mapper, response, e, "data", "content"));
            throw new IllegalStateException(
                    "쿠팡 고객문의 목록 응답을 해석할 수 없습니다"
                            + CoupangResponseDiagnostics.mappingPathSuffix(e) + ".");
        }
    }

    // --- mapping ----------------------------------------------------------

    /**
     * Project one provider item onto the PII-free internal row, or {@code null} when the row cannot
     * be represented truthfully (see the class docstring). The reason names the missing FIELD only.
     */
    private InquiryRow toRow(OnlineInquiry item, String answeredType) {
        if (item.inquiryId() == null) {
            return dropped("inquiryId");
        }
        String body = item.content();
        if (body == null || body.isBlank()) {
            return dropped("content");
        }
        Instant receivedAt = parseKstInstant(item.inquiryAt());
        if (receivedAt == null) {
            // Never default to now(): a fabricated receipt time would put the inquiry in the wrong
            // window forever and mislead every recency judgement downstream.
            return dropped("inquiryAt");
        }
        return new InquiryRow(item.inquiryId(), item.sku(), body, receivedAt, answeredType);
    }

    private InquiryRow dropped(String field) {
        log.warn("Coupang onlineInquiries row dropped: missing/unreadable field={}", field);
        return null;
    }

    /** The canonical records the shared ingestion path consumes. */
    private static List<CanonicalInquiry> canonicalRows(Iterable<InquiryRow> rows) {
        List<CanonicalInquiry> out = new ArrayList<>();
        int sourceRow = 1;
        for (InquiryRow row : rows) {
            out.add(new CanonicalInquiry(
                    // The product is keyed by SKU; a name is display metadata the inquiry endpoint
                    // does not carry, and inventing one would be a fabrication. With no SKU either,
                    // the shared "(미지정 상품)" bucket is the honest placeholder (Cafe24 precedent).
                    row.sku() == null ? "(미지정 상품)" : null,
                    row.sku(),
                    // Buyer PII: this endpoint returns none, and none is read.
                    null,
                    row.body(),
                    row.status(),
                    row.receivedAt(),
                    EXTERNAL_ID_PREFIX + row.inquiryId(),
                    sourceRow++,
                    // 상품 Q&A carries no subject line — null rather than a synthesized title.
                    null,
                    row.answeredType(),
                    // Coupang does not classify 상품 Q&A secrecy; null = not classified.
                    null));
        }
        return out;
    }

    /**
     * Parse the provider's {@code inquiryAt}. An explicit offset wins; a bare local date-time or
     * date is read as KST, which is what the endpoint's own date window is expressed in. Anything
     * else is {@code null} — the caller drops the row rather than guessing a time.
     */
    static Instant parseKstInstant(String timestamp) {
        if (timestamp == null || timestamp.isBlank()) {
            return null;
        }
        String text = timestamp.trim();
        try {
            return OffsetDateTime.parse(text).toInstant();
        } catch (Exception notOffset) {
            // fall through
        }
        try {
            return LocalDateTime.parse(text).atZone(KST).toInstant();
        } catch (Exception notLocalDateTime) {
            // fall through
        }
        try {
            return LocalDate.parse(text).atStartOfDay(KST).toInstant();
        } catch (Exception notDate) {
            return null;
        }
    }

    /** Internal projection of one inquiry, PII-free by construction. */
    private record InquiryRow(Long inquiryId, String sku, String body, Instant receivedAt,
                              String answeredType) {

        /** The canonical binary status the bucket implies. */
        String status() {
            return "ANSWERED".equals(answeredType) ? "ANSWERED" : "UNANSWERED";
        }
    }

    // --- signed transport -------------------------------------------------

    private CoupangHttpClient.Response signedGet(String path, String query,
                                                 String accessKey, String secretKey, String vendorId) {
        // Live-run approval interlock — the same backend choke point every Coupang request passes.
        CoupangLiveCallGuard.ensureLiveCallAllowed(baseUrl, liveApprovalId);
        pace();
        String authorization = signer.authorization(accessKey, secretKey, "GET", path, query);
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Authorization", authorization);
        headers.put("X-Requested-By", vendorId);
        headers.put("X-MARKET", MARKET);
        URI uri = URI.create(baseUrl + path + (query.isEmpty() ? "" : "?" + query));
        return http.get(uri, headers);
    }

    /**
     * Hold the sweep under the documented per-vendor rate limit. The gap is measured from the last
     * call this client made, so a naturally slow call (a big page, a slow gateway) costs nothing
     * extra — only a burst pays. The signature is stamped AFTER the pause, never before: a
     * signed-date is only valid for a few minutes, and signing then sleeping would spend that budget
     * on our own throttle.
     *
     * <p><b>Synchronized, and the limiter is therefore global rather than per-vendor.</b> This client
     * is a Spring singleton shared by every account, so {@code lastCallAtMillis} is touched by every
     * sync thread; leaving it unguarded would be a data race whose failure mode is exactly the 429
     * this method exists to prevent — an unpublished write means the next thread sees no recent call
     * and skips its pause. Coupang's limit is per vendorId, so serializing across vendors is stricter
     * than required. That is the deliberate direction to err in: over-throttling costs a few seconds
     * on an asynchronous run, and under-throttling costs the seller a failed import.
     */
    private synchronized void pace() {
        long now = clock.millis();
        long since = now - lastCallAtMillis;
        if (lastCallAtMillis > 0 && since < MIN_CALL_INTERVAL_MS) {
            pacer.pauseMillis(MIN_CALL_INTERVAL_MS - since);
            now = clock.millis();
        }
        lastCallAtMillis = now;
    }

    /**
     * The official query string. Every value here is a URL-safe literal — an enum token, an
     * {@code yyyy-MM-dd} date, or an integer — so nothing needs percent-encoding, and the one
     * string is used for BOTH the signature and the sent URI so they can never diverge.
     *
     * <p>{@code vendorId} is NOT repeated as a query parameter: it is already the path segment the
     * signature covers, and the documented example passes it only there. Adding it would change the
     * signed message for no gain.
     */
    static String inquiriesQuery(String answeredType, String fromDate, String toDate,
                                 int pageNum, int pageSize) {
        return "answeredType=" + answeredType
                + "&inquiryStartAt=" + fromDate
                + "&inquiryEndAt=" + toDate
                + "&pageNum=" + pageNum
                + "&pageSize=" + pageSize;
    }

    private CoupangInquiryCursor parseCursor(String cursorValue) {
        if (cursorValue == null || cursorValue.isBlank()) {
            return CoupangInquiryCursor.initial();
        }
        try {
            return mapper.readValue(cursorValue, CoupangInquiryCursor.class);
        } catch (Exception e) {
            // Bodies/cursors stay out of messages.
            throw new IllegalStateException("쿠팡 고객문의 커서를 해석할 수 없습니다.");
        }
    }

    private String serialize(CoupangInquiryCursor cursor) {
        try {
            return mapper.writeValueAsString(cursor);
        } catch (Exception e) {
            throw new IllegalStateException("쿠팡 고객문의 커서 직렬화에 실패했습니다.");
        }
    }

    // --- response DTOs (officially confirmed field names only) ------------

    /**
     * {@code code}/{@code message} are documented but unused by collection; typed as
     * {@link JsonNode} so a scalar-vs-object variance on a field we never read can never break the
     * whole page's binding.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    record InquiryEnvelope(JsonNode code, JsonNode message, InquiryData data) {

        List<OnlineInquiry> contentOrEmpty() {
            return data == null || data.content() == null ? List.of() : data.content();
        }

        /** Whether the response carried a usable page total at all — see the caller's ambiguity rule. */
        boolean hasPagination() {
            return data != null && data.pagination() != null && data.pagination().totalPages() != null;
        }

        /**
         * Whether a page after {@code pageNum} exists, per the provider's own total. Only meaningful
         * when {@link #hasPagination()}; the bounded loop is the backstop for a provider that
         * reports a total it never reaches.
         */
        boolean hasPageAfter(int pageNum) {
            return hasPagination() && pageNum < data.pagination().totalPages();
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record InquiryData(List<OnlineInquiry> content, Pagination pagination) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record Pagination(Integer currentPage, Integer totalPages, Integer totalElements,
                      Integer countPerPage) {
    }

    /**
     * One 상품별 고객문의. The declared fields are exactly the officially documented ones this
     * client reads; {@code productId} / {@code sellerItemId} / {@code orderIds} /
     * {@code commentDtoList} are documented but deliberately NOT declared — an undeclared field is
     * one that cannot accidentally be logged, mapped, or persisted, and {@code @JsonIgnoreProperties}
     * makes their presence harmless.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    record OnlineInquiry(Long inquiryId, Long sellerProductId, Long vendorItemId,
                         String content, String inquiryAt) {

        /**
         * The product key. {@code sellerProductId} (등록상품ID) is the seller's own product grain and
         * is preferred; {@code vendorItemId} (옵션ID) is the fallback so an inquiry still attaches to
         * something stable. Rendered verbatim, matching the Cafe24 convention of storing the
         * channel's own numeric product id as the SKU.
         */
        String sku() {
            if (sellerProductId != null) {
                return Long.toString(sellerProductId);
            }
            return vendorItemId == null ? null : Long.toString(vendorItemId);
        }
    }
}
