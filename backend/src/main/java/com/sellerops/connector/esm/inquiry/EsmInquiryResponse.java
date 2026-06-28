package com.sellerops.connector.esm.inquiry;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;

/**
 * Response envelope for one page of the ESM+ official INQUIRY (판매자 문의) API,
 * modeled as Jackson records (the connector-package convention; cf.
 * {@code NaverOrdersClient}'s inner envelope records). Unknown fields are
 * ignored so additive provider changes never break parsing.
 *
 * <p><b>Status: NEEDS_VERIFICATION — provisional field bindings.</b> The
 * {@code @JsonProperty} names below mirror the doc-level field vocabulary but are
 * <b>not</b> yet confirmed against a captured live response. They exist to give
 * the parser/mapper skeleton a concrete shape to test against using
 * <b>synthetic</b> fixtures; they must be re-verified before any live wiring.
 * This type is not referenced by {@code EsmApiConnector} and participates in no
 * production fetch path. It carries no credentials; in production the buyer/text
 * fields would be PII and are kept synthetic in all tests.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record EsmInquiryResponse(
        @JsonProperty("items") List<Item> items,
        @JsonProperty("totalCount") Integer totalCount,
        @JsonProperty("page") Integer page,
        @JsonProperty("pageSize") Integer pageSize) {

    /** A single inquiry row. All fields provisional (see envelope Javadoc). */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Item(
            @JsonProperty("inquiryId") String inquiryId,
            @JsonProperty("qnaType") String qnaType,
            @JsonProperty("itemName") String itemName,
            @JsonProperty("itemNo") String itemNo,
            @JsonProperty("buyerId") String buyerId,
            @JsonProperty("contents") String contents,
            @JsonProperty("status") String status,
            @JsonProperty("regDate") String regDate) {
    }

    /** Whether more pages remain, derived from total/page/pageSize when present. */
    public boolean hasMore() {
        if (totalCount == null || page == null || pageSize == null || pageSize <= 0) {
            return false;
        }
        return (long) page * pageSize < totalCount;
    }
}
