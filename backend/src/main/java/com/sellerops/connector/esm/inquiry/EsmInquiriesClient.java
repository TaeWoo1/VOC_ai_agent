package com.sellerops.connector.esm.inquiry;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.connector.esm.EsmHttpClient;
import com.sellerops.ingest.canonical.CanonicalInquiry;
import java.net.URI;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Orchestration for reading the ESM+ (G마켓/옥션) official INQUIRY (판매자 문의)
 * API over a date range: split the range into ≤7-day windows
 * ({@link EsmInquiryDateWindow}), page through each window, parse every page with
 * {@link EsmInquiryParser}, and accumulate {@link CanonicalInquiry} results.
 *
 * <p><b>Isolation.</b> Every outbound call goes through the injected
 * {@link EsmHttpClient}, so tests substitute a recording fake and no test can
 * reach the network by construction. This client is <b>not</b> referenced by
 * {@code EsmApiConnector}, exposes no capability, and participates in no
 * scheduler/manual-sync path — it is the read-side orchestration skeleton only,
 * with INQUIRY remaining NEEDS_VERIFICATION.
 *
 * <p><b>Status: NEEDS_VERIFICATION — provisional wire shape.</b> {@link
 * #INQUIRY_PATH}, the request-body field names, and the page-size are doc-level
 * guesses not yet confirmed against a live response; they exist to give the
 * orchestration a concrete, testable shape against <b>synthetic</b> fixtures and
 * must be re-verified before any live wiring.
 *
 * <p><b>Safety.</b> No credentials are derived here — the caller supplies the
 * assembled {@code Authorization} header value. Response bodies never appear in
 * error messages (HTTP failures carry the status only; parse failures defer to
 * {@link EsmInquiryParser}, which masks the body). A {@code 429} surfaces as a
 * typed {@link EsmInquiryRateLimitedException} carrying the standard
 * {@code Retry-After} hint (no body classification). Pagination is bounded by
 * {@link #MAX_PAGES_PER_WINDOW} so a misbehaving {@code hasMore} cannot loop
 * forever. No clock is read (callers pass an explicit range), keeping the
 * recency rules intact.
 */
public class EsmInquiriesClient {

    /** Provisional official endpoint path (NEEDS_VERIFICATION). */
    public static final String INQUIRY_PATH = "/item/v1/communications/customer/bulletin-board";

    /** Provisional default page size requested per call. */
    public static final int DEFAULT_PAGE_SIZE = 50;

    /** Page size used by {@link #probeSinglePage} — the smallest possible, to minimize returned rows. */
    public static final int PROBE_PAGE_SIZE = 1;

    /** Hard bound on pages walked per window — guards against a runaway hasMore. */
    public static final int MAX_PAGES_PER_WINDOW = 1000;

    private final EsmHttpClient http;
    private final String baseUrl;
    private final EsmInquiryParser parser = new EsmInquiryParser();
    private final ObjectMapper mapper = new ObjectMapper();

    public EsmInquiriesClient(EsmHttpClient http, String baseUrl) {
        this.http = http;
        this.baseUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
    }

    /**
     * Read every inquiry in {@code [from, to]} (inclusive), walking the range in
     * 7-day windows and paginating each window to exhaustion. {@code qnaType} and
     * {@code statusFilter} are optional (null = unfiltered); {@code authorization}
     * is the caller-assembled {@code Authorization} header value.
     */
    public List<CanonicalInquiry> fetchRange(LocalDate from, LocalDate to, String qnaType,
                                             String statusFilter, String authorization) {
        List<CanonicalInquiry> all = new ArrayList<>();
        for (EsmInquiryDateWindow window : EsmInquiryDateWindow.chunkWeekly(from, to)) {
            all.addAll(fetchWindow(window, qnaType, statusFilter, authorization));
        }
        return all;
    }

    /**
     * Fire <b>exactly one</b> INQUIRY request for a single day and return the raw
     * HTTP response for sanitization — the read-only live-probe primitive. It uses
     * {@code page=1} and {@link #PROBE_PAGE_SIZE} ({@code 1}); it does <b>not</b>
     * paginate, walk date windows, retry, or throw on non-200/429 (the caller
     * sanitizes the status). The single-day window ({@code [day, day]}) is enforced
     * by construction. The raw {@link EsmHttpClient.Response} is intended to be
     * consumed only by {@link EsmInquiryProbeReporter}, which never lets the body
     * escape; {@code authorization} is the caller-assembled header (no credential
     * logic here). INQUIRY remains NEEDS_VERIFICATION.
     */
    public EsmHttpClient.Response probeSinglePage(LocalDate day, String qnaType,
                                                  String statusFilter, String authorization) {
        EsmInquiryQuery query = new EsmInquiryQuery(day, day, qnaType, statusFilter, 1);
        return http.postJson(uri(INQUIRY_PATH), headers(authorization),
                requestBody(query, PROBE_PAGE_SIZE));
    }

    /** Page through a single ≤7-day window to exhaustion. */
    private List<CanonicalInquiry> fetchWindow(EsmInquiryDateWindow window, String qnaType,
                                               String statusFilter, String authorization) {
        List<CanonicalInquiry> collected = new ArrayList<>();
        EsmInquiryQuery query = new EsmInquiryQuery(
                window.startInclusive(), window.endInclusive(), qnaType, statusFilter, 1);
        int pages = 0;
        while (true) {
            EsmInquiryResponse response = requestPage(query, authorization);
            collected.addAll(parser.toCanonical(response));
            if (!response.hasMore()) {
                break;
            }
            if (++pages >= MAX_PAGES_PER_WINDOW) {
                throw new IllegalStateException(
                        "ESM 문의 페이지 수가 상한을 초과했습니다 (window paging guard).");
            }
            query = query.nextPage();
        }
        return collected;
    }

    /** Request and parse one page; never echoes the response body on failure. */
    private EsmInquiryResponse requestPage(EsmInquiryQuery query, String authorization) {
        EsmHttpClient.Response response =
                http.postJson(uri(INQUIRY_PATH), headers(authorization),
                        requestBody(query, DEFAULT_PAGE_SIZE));
        // HTTP-standard 429 handling: surface a typed rate-limit signal carrying the
        // standard Retry-After hint (no body classification — unverified taxonomy).
        if (response.statusCode() == 429) {
            throw EsmInquiryRateLimitedException.fromResponse(response);
        }
        if (response.statusCode() != 200) {
            // Body stays masked: status only, never the response payload.
            throw new IllegalStateException(
                    "ESM 문의 조회에 실패했습니다 (HTTP " + response.statusCode() + ").");
        }
        return parser.parse(response.body());
    }

    private Map<String, String> headers(String authorization) {
        Map<String, String> headers = new LinkedHashMap<>();
        if (authorization != null && !authorization.isBlank()) {
            headers.put("Authorization", authorization);
        }
        headers.put("Content-Type", "application/json");
        return headers;
    }

    /** Serialize the query to a JSON request body (provisional field names). */
    private String requestBody(EsmInquiryQuery query, int pageSize) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("fromDate", query.fromInclusive().toString());
        body.put("toDate", query.toInclusive().toString());
        if (query.qnaType() != null && !query.qnaType().isBlank()) {
            body.put("qnaType", query.qnaType());
        }
        if (query.statusFilter() != null && !query.statusFilter().isBlank()) {
            body.put("status", query.statusFilter());
        }
        body.put("page", query.page());
        body.put("pageSize", pageSize);
        try {
            return mapper.writeValueAsString(body);
        } catch (Exception e) {
            // Body holds no PII (dates/filters/page only); message stays generic.
            throw new IllegalStateException("ESM 문의 요청 본문을 생성할 수 없습니다.");
        }
    }

    private URI uri(String path) {
        return URI.create(baseUrl + path);
    }
}
