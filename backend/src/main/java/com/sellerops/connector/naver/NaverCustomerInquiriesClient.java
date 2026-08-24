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
 * NAVER 고객 문의 (네이버페이) — <b>read only</b>.
 *
 * <pre>GET /external/v1/pay-user/inquiries?startSearchDate=..&amp;endSearchDate=..&amp;page=n&amp;size=m</pre>
 *
 * <p>Official contract: {@code docs/vendor/naver-commerce-api/get-v1-pay-user-inquiries.md};
 * audit: {@code docs/naver_inquiry_api_audit_v1.md} §2.
 *
 * <p><b>This is not the same thing as 상품 문의, and the two must not be merged.</b> A 고객 문의 hangs
 * off an ORDER ({@code orderId} is a required response field) and is categorised
 * (상품·배송·반품·교환·환불·기타); a 상품 문의 hangs off a listing and has no order at all. They page
 * differently (dates vs date-times, 10~200 vs ≤100 per page), fail separately, and carry different
 * identifier spaces. One operational inbox may show both; one number must never claim to count both
 * without saying so.
 *
 * <p><b>Buyer PII is returned by this resource and is dropped here.</b> {@code customerId} and
 * {@code customerName} are REQUIRED response fields — the first customer-name field any connector in
 * this repository has been offered. They are not mapped, not logged, and not part of any key. The
 * existing rule ({@code IngestionService}: "Buyer PII is intentionally NOT persisted") holds without
 * an exception for this channel.
 *
 * <p><b>Order identifiers are read and not stored.</b> {@code orderId} / {@code productOrderIdList}
 * have no column on {@code inquiries}, and adding a cross-domain link is not what this package does.
 * Nothing is fabricated in their place.
 *
 * <p><b>Product attribution by identifier or not at all</b> — {@code content.productNo}, exactly, the
 * same rule as 상품 문의. {@code productName} is not mapped for the same reason. {@code productNo} is
 * optional on this resource, so a row without one is simply unattributed, which is what
 * {@link ChannelProductRef#absent()} means.
 */
public class NaverCustomerInquiriesClient {

    private static final Logger log = LoggerFactory.getLogger(NaverCustomerInquiriesClient.class);

    static final String PATH = "/external/v1/pay-user/inquiries";

    public static final String SOURCE = "NAVER:CUSTOMER_INQUIRY_API:v1";

    /**
     * Never read live. The official description says this resource returns the inquiries accumulated
     * on "네이버페이 구매회원으로 등록된 본인 계정", which cannot be resolved from the document into
     * "the inquiries this SELLER received" — only a call answers it.
     */
    public static final String VERIFICATION_STATUS = "NEEDS_VERIFICATION";

    /** The resource's documented range is 10~200 per page; the ceiling keeps the call count down. */
    static final int PAGE_SIZE = 200;

    static final String EXTERNAL_ID_PREFIX = "naver-payinq:";

    private final NaverHttpClient http;
    private final String baseUrl;

    public NaverCustomerInquiriesClient(NaverHttpClient http, String baseUrl) {
        this.http = http;
        this.baseUrl = baseUrl;
    }

    /** One page of 고객 문의 over the lane's date window. */
    public NaverInquiryPage fetchPage(String accessToken, NaverInquiryCursor.Lane lane) {
        URI uri = URI.create(baseUrl + PATH
                + "?startSearchDate=" + enc(lane.from())
                + "&endSearchDate=" + enc(lane.to())
                + "&page=" + lane.page()
                + "&size=" + PAGE_SIZE);

        NaverHttpClient.Response response = http.get(uri, accessToken);
        if (response.statusCode() == 429) {
            throw NaverRateLimitedException.fromResponse(response);
        }
        if (response.statusCode() == 401 || response.statusCode() == 403) {
            throw new NaverProductPermissionException(
                    "네이버 커머스API 고객 문의 조회 권한이 없습니다. 판매자 애플리케이션에 문의 API 권한이 필요합니다.");
        }
        if (response.statusCode() != 200) {
            throw new IllegalStateException(
                    "네이버 고객 문의 조회에 실패했습니다 (HTTP " + response.statusCode() + ").");
        }

        InquiriesResponse parsed;
        try {
            parsed = new ObjectMapper().readValue(response.body(), InquiriesResponse.class);
        } catch (Exception e) {
            throw new IllegalStateException("네이버 고객 문의 응답을 해석할 수 없습니다.");
        }

        List<CustomerInquiry> content = parsed.content() == null ? List.of() : parsed.content();
        List<CanonicalInquiry> rows = new ArrayList<>();
        int sourceRow = 1;
        int withProductRef = 0;
        for (CustomerInquiry inquiry : content) {
            CanonicalInquiry row = toCanonical(inquiry, sourceRow++);
            if (row == null) {
                continue;
            }
            if (row.productRef() != null && row.productRef().hasIdentifier()) {
                withProductRef++;
            }
            rows.add(row);
        }
        boolean last = endOfSweep(parsed, lane.page(), content.size());
        log.info("네이버 고객 문의 수집: rows={} productRef={} page={}/{} total={} last={}",
                rows.size(), withProductRef, lane.page(),
                parsed.totalPages() == null ? "?" : parsed.totalPages(),
                parsed.totalElements() == null ? "?" : parsed.totalElements(), last);
        return new NaverInquiryPage(rows, last, parsed.totalElements(), parsed.totalPages());
    }

    /** The resource's own termination statement first ({@code last}, then {@code totalPages}). */
    private static boolean endOfSweep(InquiriesResponse parsed, int page, int received) {
        if (parsed.last() != null) {
            return parsed.last();
        }
        if (parsed.totalPages() != null) {
            return page >= parsed.totalPages();
        }
        return received < PAGE_SIZE;
    }

    /** One 고객 문의 → one canonical inquiry. */
    static CanonicalInquiry toCanonical(CustomerInquiry inquiry, int sourceRow) {
        if (inquiry.inquiryNo() == null) {
            return null;
        }
        Instant createdAt = parseInstant(inquiry.inquiryRegistrationDateTime());
        if (createdAt == null) {
            return null;
        }
        boolean answered = Boolean.TRUE.equals(inquiry.answered());
        return new CanonicalInquiry(
                null,
                null,
                // Buyer PII: customerId / customerName are required fields on this resource and are
                // deliberately not read.
                null,
                inquiry.inquiryContent() == null ? "" : inquiry.inquiryContent(),
                answered ? "ANSWERED" : "UNANSWERED",
                createdAt,
                EXTERNAL_ID_PREFIX + inquiry.inquiryNo(),
                sourceRow,
                inquiry.title(),
                // `category` is the KIND of inquiry (상품/배송/…), not a reply-status token. Putting it
                // in informStatus would make a type read as a status wherever that column is shown.
                null,
                // No secrecy field on this resource.
                null,
                InquirySourceSubtype.NAVER_CUSTOMER_INQUIRY,
                ChannelProductRef.of(inquiry.productNo()),
                answered ? inquiry.answerContent() : null,
                answered ? parseInstant(inquiry.answerRegistrationDateTime()) : null);
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
    record InquiriesResponse(@JsonProperty("content") List<CustomerInquiry> content,
                             @JsonProperty("totalElements") Long totalElements,
                             @JsonProperty("totalPages") Integer totalPages,
                             @JsonProperty("last") Boolean last) {
    }

    /**
     * The subset of the response this connector reads. {@code customerId}, {@code customerName},
     * {@code orderId} and {@code productOrderIdList} are absent from this record ON PURPOSE — a field
     * that is not projected cannot be persisted by accident later.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    record CustomerInquiry(@JsonProperty("inquiryNo") Long inquiryNo,
                           @JsonProperty("title") String title,
                           @JsonProperty("inquiryContent") String inquiryContent,
                           @JsonProperty("inquiryRegistrationDateTime") String inquiryRegistrationDateTime,
                           @JsonProperty("answerContent") String answerContent,
                           @JsonProperty("answerRegistrationDateTime") String answerRegistrationDateTime,
                           @JsonProperty("answered") Boolean answered,
                           @JsonProperty("productNo") String productNo) {
    }
}
