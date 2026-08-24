package com.sellerops.connector.naver;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.ingest.canonical.CanonicalInquiry;
import com.sellerops.ingest.canonical.ChannelProductRef;
import com.sellerops.inquiry.InquirySourceSubtype;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * NAVER 상품 문의 (스마트스토어 Q&A) — <b>read only</b>.
 *
 * <pre>GET /external/v1/contents/qnas?fromDate=..&amp;toDate=..&amp;page=n&amp;size=m</pre>
 *
 * <p>The official contract this client is written against is vendored at
 * {@code docs/vendor/naver-commerce-api/get-v1-contents-qnas.md} and audited in
 * {@code docs/naver_inquiry_api_audit_v1.md} §1. Everything below is read from it; nothing is
 * inferred from a sibling endpoint.
 *
 * <p><b>What this resource does NOT publish, and is therefore not claimed:</b>
 * <ul>
 *   <li><b>No secret/private flag.</b> {@code isSecret} stays {@code null} — "the source does not
 *       classify secrecy", which is exactly the existing meaning of null. Copying Cafe24's 비밀글
 *       rule here would be a rule invented for a channel that publishes no such field.</li>
 *   <li><b>No raw status token.</b> The resource states {@code answered} as a boolean, so
 *       {@code informStatus} is null rather than a token this client made up.</li>
 *   <li><b>No order identifier.</b> 상품 문의 hangs off a listing, not an order.</li>
 * </ul>
 *
 * <p><b>Buyer PII.</b> {@code maskedWriterId} is read by nothing here. It is masked, but it is still
 * a writer identifier, and this repository does not persist writer identity on any channel — and a
 * masked id in a dedupe key would quietly make it load-bearing.
 *
 * <p><b>Product attribution is by identifier or not at all.</b> {@code contents.productId} is passed
 * through as a {@link ChannelProductRef}; ingest resolves it against
 * {@code channel_products (channel_id, external_product_id)} exactly, and leaves the inquiry
 * unattributed on a miss. {@code contents.productName} is deliberately NOT mapped to
 * {@code productName} — that field feeds a resolve-or-create by name, and the canonical Demo Org
 * contains products that share a name.
 *
 * <p><b>Which product number {@code contents.productId} is, is not settled.</b> The official document
 * does not say whether it is the 채널상품번호 or the 원상품번호, and this repository keys listings by
 * 채널상품번호 ({@code NaverProductsClient:182}). So the match is attempted exactly and the miss rate
 * is reported: a live read answers the question, and until then no attribution is asserted.
 */
public class NaverProductQnaClient {

    private static final Logger log = LoggerFactory.getLogger(NaverProductQnaClient.class);

    static final String PATH = "/external/v1/contents/qnas";

    /** The provenance stamp for rows this client produces. */
    public static final String SOURCE = "NAVER:PRODUCT_QNA_API:v1";

    /**
     * Live-proven on the canonical Demo Org, 2026-08-24: one bounded window (2026-06-01~08-24), one
     * page, 13 questions, 0 errors, and every row carried a product number that resolved.
     *
     * <p>The word is here, on the client, because it is a fact about THIS resource and not about the
     * data type. NAVER's other inquiry resource is a different endpoint with a different contract and
     * its own status; folding them into one type-level word would let one proof speak for two.
     */
    public static final String VERIFICATION_STATUS = "CONFIRMED";

    /** The resource's documented maximum: 페이지당 최대 100건. */
    static final int PAGE_SIZE = 100;

    /** External ids are namespaced by resource so two number spaces can never collide. */
    static final String EXTERNAL_ID_PREFIX = "naver-qna:";

    private final NaverHttpClient http;
    private final String baseUrl;

    public NaverProductQnaClient(NaverHttpClient http, String baseUrl) {
        this.http = http;
        this.baseUrl = baseUrl;
    }

    /** One page of 상품 문의 over the lane's window. */
    public NaverInquiryPage fetchPage(String accessToken, NaverInquiryCursor.Lane lane) {
        URI uri = URI.create(baseUrl + PATH
                + "?fromDate=" + enc(lane.from())
                + "&toDate=" + enc(lane.to())
                + "&page=" + lane.page()
                + "&size=" + PAGE_SIZE);

        NaverHttpClient.Response response = http.get(uri, accessToken);
        if (response.statusCode() == 429) {
            throw NaverRateLimitedException.fromResponse(response);
        }
        if (response.statusCode() == 401 || response.statusCode() == 403) {
            // The application does not hold the 문의 API group. A seller action, never worked around —
            // the same shape the missing product permission already has.
            throw new NaverProductPermissionException(
                    "네이버 커머스API 상품 문의 조회 권한이 없습니다. 판매자 애플리케이션에 문의 API 권한이 필요합니다.");
        }
        if (response.statusCode() != 200) {
            throw new IllegalStateException(
                    "네이버 상품 문의 조회에 실패했습니다 (HTTP " + response.statusCode() + ").");
        }

        QnaResponse parsed;
        try {
            parsed = new ObjectMapper().readValue(response.body(), QnaResponse.class);
        } catch (Exception e) {
            // The body stays out of the message — an inquiry dump in a log is still customer data.
            throw new IllegalStateException("네이버 상품 문의 응답을 해석할 수 없습니다.");
        }

        List<Qna> contents = parsed.contents() == null ? List.of() : parsed.contents();
        List<CanonicalInquiry> rows = new ArrayList<>();
        int sourceRow = 1;
        int withProductRef = 0;
        for (Qna qna : contents) {
            CanonicalInquiry row = toCanonical(qna, sourceRow++);
            if (row == null) {
                continue;
            }
            if (row.productRef() != null && row.productRef().hasIdentifier()) {
                withProductRef++;
            }
            rows.add(row);
        }
        boolean last = endOfSweep(parsed, lane.page(), contents.size());
        log.info("네이버 상품 문의 수집: rows={} productRef={} page={}/{} total={} last={}",
                rows.size(), withProductRef, lane.page(),
                parsed.totalPages() == null ? "?" : parsed.totalPages(),
                parsed.totalElements() == null ? "?" : parsed.totalElements(), last);
        return new NaverInquiryPage(rows, last, parsed.totalElements(), parsed.totalPages());
    }

    /**
     * The vendor's own termination condition, in the order it publishes them: {@code last}, then
     * {@code totalPages}, and only then the fallback that an empty/short page ends the sweep.
     *
     * <p>The document is explicit that {@code totalPages} is what a caller should use "무한 루프를
     * 방지"하기 위해. The short-page fallback exists for a response that omits both, and it is a
     * fallback rather than the rule because a full page is not evidence of another one.
     */
    private static boolean endOfSweep(QnaResponse parsed, int page, int received) {
        if (parsed.last() != null) {
            return parsed.last();
        }
        if (parsed.totalPages() != null) {
            return page >= parsed.totalPages();
        }
        return received < PAGE_SIZE;
    }

    /** One 상품 문의 → one canonical inquiry. A row with no identifier or no body is not a row. */
    static CanonicalInquiry toCanonical(Qna qna, int sourceRow) {
        if (qna.questionId() == null) {
            return null;
        }
        Instant createdAt = parseInstant(qna.createDate());
        if (createdAt == null) {
            return null;
        }
        boolean answered = Boolean.TRUE.equals(qna.answered());
        return new CanonicalInquiry(
                // NOT the product name: that field resolves-or-creates by name. See the class javadoc.
                null,
                null,
                // Buyer PII: maskedWriterId is not read.
                null,
                qna.question() == null ? "" : qna.question(),
                answered ? "ANSWERED" : "UNANSWERED",
                createdAt,
                EXTERNAL_ID_PREFIX + qna.questionId(),
                sourceRow,
                // 상품 문의 carries no subject.
                null,
                // The resource states a boolean, not a token; a token here would be invented.
                null,
                // No secrecy field on this resource — null means "not classified", which is true.
                null,
                InquirySourceSubtype.NAVER_PRODUCT_QNA,
                ChannelProductRef.of(qna.productId() == null ? null : Long.toString(qna.productId())),
                answered ? qna.answer() : null,
                // The resource publishes no answer timestamp. Null, not the collection time.
                null);
    }

    private static Instant parseInstant(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return OffsetDateTime.parse(value).toInstant();
        } catch (DateTimeParseException e) {
            return null;
        }
    }

    private static String enc(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record QnaResponse(@JsonProperty("contents") List<Qna> contents,
                       @JsonProperty("totalElements") Long totalElements,
                       @JsonProperty("totalPages") Integer totalPages,
                       @JsonProperty("last") Boolean last) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record Qna(@JsonProperty("questionId") Long questionId,
               @JsonProperty("createDate") String createDate,
               @JsonProperty("question") String question,
               @JsonProperty("answer") String answer,
               @JsonProperty("answered") Boolean answered,
               @JsonProperty("productId") Long productId) {
    }
}
