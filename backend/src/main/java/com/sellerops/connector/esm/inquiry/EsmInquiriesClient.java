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
 * ({@link EsmInquiryDateWindow}), fire <b>one</b> request per window, parse the
 * top-level array with {@link EsmInquiryParser}, and accumulate {@link
 * CanonicalInquiry} results. There is no pagination: the success response carries
 * no page envelope, so one call returns the window's rows.
 *
 * <p><b>Isolation.</b> Every outbound call goes through the injected
 * {@link EsmHttpClient}, so tests substitute a recording fake and no test can
 * reach the network by construction.
 *
 * <p><b>NOT WIRED — live inquiry ingestion is not enabled.</b> {@code
 * EsmApiConnector} does <b>not</b> call this client: INQUIRY is not exposed as a
 * connector capability and no scheduler/manual-sync path reaches it. This is the
 * read-side orchestration skeleton only; wiring it into the connector (and thus
 * live ESM inquiry collection) is deferred to a later slice.
 *
 * <p><b>Verification: official-doc confirmed, live-response unverified.</b> The
 * request/response shape here follows the official ESM Trading CS API
 * documentation, but has <b>not</b> been checked against a captured live response
 * — {@link #INQUIRY_PATH} and the exact request-body field names in particular are
 * still doc-level and must be re-verified against a real response before any live
 * wiring. All tests run against <b>synthetic</b> fixtures.
 *
 * <p><b>Safety.</b> No credentials are derived here — the caller supplies the
 * assembled {@code Authorization} header value. Response bodies never appear in
 * error messages: an HTTP failure surfaces the status plus (when the body is the
 * {@link EsmInquiryError} shape) only the numeric {@code resultCode}, never the
 * free-text message; parse failures defer to {@link EsmInquiryParser}, which masks
 * the body. A {@code 429} surfaces as a typed {@link EsmInquiryRateLimitedException}
 * carrying the standard {@code Retry-After} hint. No clock is read (callers pass an
 * explicit range), keeping the recency rules intact.
 */
public class EsmInquiriesClient {

    /** Endpoint path from the official doc; live-response unverified. */
    public static final String INQUIRY_PATH = "/item/v1/communications/customer/bulletin-board";

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
     * 7-day windows and firing one request per window. {@code qnaType}, {@code
     * status}, and {@code type} are optional numeric filters (null = unfiltered);
     * {@code authorization} is the caller-assembled {@code Authorization} header.
     */
    public List<CanonicalInquiry> fetchRange(LocalDate from, LocalDate to, Integer qnaType,
                                             Integer status, Integer type, String authorization) {
        List<CanonicalInquiry> all = new ArrayList<>();
        for (EsmInquiryDateWindow window : EsmInquiryDateWindow.chunkWeekly(from, to)) {
            EsmInquiryQuery query = new EsmInquiryQuery(
                    window.startInclusive(), window.endInclusive(), qnaType, status, type);
            all.addAll(parser.toCanonical(parser.parseItems(requestWindow(query, authorization))));
        }
        return all;
    }

    /**
     * Fire <b>exactly one</b> INQUIRY request for a single day and return the raw
     * HTTP response for sanitization — the read-only live-probe primitive. It does
     * <b>not</b> paginate (there is no pagination), walk date windows, retry, or
     * throw on non-200/429 (the caller sanitizes the status). The single-day window
     * ({@code [day, day]}) is enforced by construction. The raw {@link
     * EsmHttpClient.Response} is intended to be consumed only by {@link
     * EsmInquiryProbeReporter}, which never lets the body escape; {@code
     * authorization} is the caller-assembled header. INQUIRY is official-doc
     * confirmed but live-response unverified.
     */
    public EsmHttpClient.Response probeSinglePage(LocalDate day, Integer qnaType, Integer status,
                                                  Integer type, String authorization) {
        EsmInquiryQuery query = new EsmInquiryQuery(day, day, qnaType, status, type);
        return http.postJson(uri(INQUIRY_PATH), headers(authorization), requestBody(query));
    }

    /** Fire one request for a window; translate non-success into typed failures. */
    private String requestWindow(EsmInquiryQuery query, String authorization) {
        EsmHttpClient.Response response =
                http.postJson(uri(INQUIRY_PATH), headers(authorization), requestBody(query));
        // HTTP-standard 429 handling: surface a typed rate-limit signal carrying the
        // standard Retry-After hint (no body classification — unverified taxonomy).
        if (response.statusCode() == 429) {
            throw EsmInquiryRateLimitedException.fromResponse(response);
        }
        if (response.statusCode() != 200) {
            throw failure(response);
        }
        return response.body();
    }

    /**
     * Build a status-only failure. If the body is the {@code { resultCode, message }}
     * shape, the numeric {@code resultCode} is appended — the free-text message is
     * never included, so no response payload can leak.
     */
    private IllegalStateException failure(EsmHttpClient.Response response) {
        EsmInquiryError error = parser.parseError(response.body());
        String suffix = error != null && error.resultCode() != null
                ? " (resultCode " + error.resultCode() + ")" : "";
        return new IllegalStateException(
                "ESM 문의 조회에 실패했습니다 (HTTP " + response.statusCode() + ")" + suffix + ".");
    }

    private Map<String, String> headers(String authorization) {
        Map<String, String> headers = new LinkedHashMap<>();
        if (authorization != null && !authorization.isBlank()) {
            headers.put("Authorization", authorization);
        }
        headers.put("Content-Type", "application/json");
        return headers;
    }

    /** Serialize the query to a JSON request body (numeric filters when present). */
    private String requestBody(EsmInquiryQuery query) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("fromDate", query.fromInclusive().toString());
        body.put("toDate", query.toInclusive().toString());
        if (query.qnaType() != null) {
            body.put("qnaType", query.qnaType());
        }
        if (query.status() != null) {
            body.put("status", query.status());
        }
        if (query.type() != null) {
            body.put("type", query.type());
        }
        try {
            return mapper.writeValueAsString(body);
        } catch (Exception e) {
            // Body holds no PII (dates/numeric filters only); message stays generic.
            throw new IllegalStateException("ESM 문의 요청 본문을 생성할 수 없습니다.");
        }
    }

    private URI uri(String path) {
        return URI.create(baseUrl + path);
    }
}
