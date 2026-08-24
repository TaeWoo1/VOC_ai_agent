package com.sellerops.connector.naver;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.ingest.canonical.CanonicalInquiry;
import com.sellerops.ingest.canonical.ChannelOrderRef;
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
 * <p><b>Order identifiers ARE stored, as of 2026-08-25 — and only they.</b> {@code orderId} is a
 * REQUIRED response field on this resource and {@code productOrderIdList} an optional comma-separated
 * one, so this is the only inquiry surface in the repository where "which order is this about" is
 * answered by the channel rather than guessed. They travel as a {@link ChannelOrderRef} and land in
 * {@code inquiries.source_order_ref}. {@code customerId} and {@code customerName} remain unread: an
 * order reference is a handle on a transaction, and the whole point of taking one and not the other
 * is that they are different things.
 *
 * <p><b>The list is split, and a multi-line order binds only at the payment unit.</b>
 * {@code productOrderIdList} is one string with commas in it; a single element is the exact per-line
 * identity {@code channel_orders} keys on, and two or more mean the customer asked about several
 * lines at once — for which no single line is "이 주문", so the payment-unit {@code orderId} is what
 * is stored.
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
     * Live-proven on the canonical Demo Org, 2026-08-24: one bounded window (2026-06-01~08-24), one
     * page, 5 inquiries, 0 errors, and an immediate same-range re-read that stored nothing
     * ({@code 5 received / 0 inserted / 5 skipped}).
     *
     * <p><b>What the call settled that the document could not.</b> The official description says this
     * resource returns the inquiries accumulated on "네이버페이 구매회원으로 등록된 본인 계정", which does
     * not resolve on paper into "the inquiries this SELLER received". It does in practice: every row
     * came back carrying a {@code productNo} that resolved to one of THIS seller's own listings, and
     * every row carried this seller's own published answer. Read with a seller application's token,
     * this is the seller-side view.
     */
    public static final String VERIFICATION_STATUS = "CONFIRMED";

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
                answered ? parseInstant(inquiry.answerRegistrationDateTime()) : null,
                orderRef(inquiry));
    }

    /**
     * The order this 고객 문의 hangs off — the per-line identity when it is unambiguous, else the
     * payment unit.
     *
     * <p>Returns {@link ChannelOrderRef#absent()} rather than null when both are missing: this
     * resource HAS an order lane (the contract marks {@code orderId} 필수), so a row without one is a
     * positive "this article named no order", not "this source does not do orders".
     */
    static ChannelOrderRef orderRef(CustomerInquiry inquiry) {
        return orderRef(inquiry.orderId(), inquiry.productOrderIdList());
    }

    /** The same rule, over the two raw response values. Public so the rule itself is testable. */
    public static ChannelOrderRef orderRef(String orderId, String productOrderIdList) {
        return ChannelOrderRef.of(orderId, soleProductOrderId(productOrderIdList));
    }

    /** The one product-order id, or null when there are none or more than one. */
    private static String soleProductOrderId(String list) {
        if (list == null || list.isBlank()) {
            return null;
        }
        String[] parts = list.split(",");
        String only = null;
        for (String part : parts) {
            String trimmed = part.strip();
            if (trimmed.isEmpty()) {
                continue;
            }
            if (only != null) {
                return null;
            }
            only = trimmed;
        }
        return only;
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
     * The subset of the response this connector reads. {@code customerId} and {@code customerName}
     * are absent from this record ON PURPOSE — a field that is not projected cannot be persisted by
     * accident later. {@code orderId} / {@code productOrderIdList} ARE projected, and go nowhere
     * except {@code inquiries.source_order_ref}.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    record CustomerInquiry(@JsonProperty("inquiryNo") Long inquiryNo,
                           @JsonProperty("title") String title,
                           @JsonProperty("inquiryContent") String inquiryContent,
                           @JsonProperty("inquiryRegistrationDateTime") String inquiryRegistrationDateTime,
                           @JsonProperty("answerContent") String answerContent,
                           @JsonProperty("answerRegistrationDateTime") String answerRegistrationDateTime,
                           @JsonProperty("answered") Boolean answered,
                           @JsonProperty("productNo") String productNo,
                           @JsonProperty("orderId") String orderId,
                           @JsonProperty("productOrderIdList") String productOrderIdList) {

        /** Back-compat for fixtures written before the order lane existed. */
        CustomerInquiry(Long inquiryNo, String title, String inquiryContent,
                        String inquiryRegistrationDateTime, String answerContent,
                        String answerRegistrationDateTime, Boolean answered, String productNo) {
            this(inquiryNo, title, inquiryContent, inquiryRegistrationDateTime, answerContent,
                    answerRegistrationDateTime, answered, productNo, null, null);
        }
    }
}
