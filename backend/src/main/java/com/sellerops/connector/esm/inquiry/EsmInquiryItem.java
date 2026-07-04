package com.sellerops.connector.esm.inquiry;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * One inquiry row from the ESM+ official INQUIRY (판매자 문의) API. The success
 * response is a <b>top-level JSON array</b> of these rows — there is no pagination
 * envelope (no {@code items}/{@code totalCount}/{@code page}/{@code pageSize}). A
 * failure body is the separate {@link EsmInquiryError} shape.
 *
 * <p><b>Wire types (official-doc confirmed):</b> {@code qnaType} is <b>numeric</b>
 * and {@code reAsking} is a <b>boolean</b>; the remaining fields are strings.
 * Unknown fields are ignored so additive provider changes never break parsing. The
 * shape follows the official schema but is <b>live-response unverified</b> (the
 * exact codes are not yet checked against a captured live response), so tests stay
 * <b>synthetic</b>; this type participates in no production fetch path.
 *
 * <p><b>PII / secrets:</b> the inquirer's name/phone are <b>not modeled</b>. {@code
 * token} is the reply-secret handle — captured so the row shape is complete, but it
 * is redacted from {@link #toString()} and is never mapped into {@link
 * com.sellerops.ingest.canonical.CanonicalInquiry}, any probe/diagnostic, or storage
 * (encrypted persistence / re-fetch is deferred; no reply execution here).
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record EsmInquiryItem(
        @JsonProperty("messageNo") String messageNo,
        @JsonProperty("qnaType") Integer qnaType,
        @JsonProperty("sellerId") String sellerId,
        @JsonProperty("goodsNo") String goodsNo,
        @JsonProperty("siteGoodsNo") String siteGoodsNo,
        @JsonProperty("orderNo") String orderNo,
        @JsonProperty("payNo") String payNo,
        @JsonProperty("informStatus") String informStatus,
        @JsonProperty("receiveDate") String receiveDate,
        @JsonProperty("answerDate") String answerDate,
        @JsonProperty("contractType") String contractType,
        @JsonProperty("title") String title,
        @JsonProperty("details") String details,
        @JsonProperty("token") String token,
        @JsonProperty("reAsking") Boolean reAsking) {

    /**
     * Redacts the reply {@code token} so it can never leak through a log line,
     * assertion message, or accidental diagnostic that stringifies a row. Every
     * other field is rendered for debuggability.
     */
    @Override
    public String toString() {
        return "EsmInquiryItem[messageNo=" + messageNo
                + ", qnaType=" + qnaType
                + ", sellerId=" + sellerId
                + ", goodsNo=" + goodsNo
                + ", siteGoodsNo=" + siteGoodsNo
                + ", orderNo=" + orderNo
                + ", payNo=" + payNo
                + ", informStatus=" + informStatus
                + ", receiveDate=" + receiveDate
                + ", answerDate=" + answerDate
                + ", contractType=" + contractType
                + ", title=" + title
                + ", details=" + details
                + ", token=" + (token == null ? "null" : "<redacted>")
                + ", reAsking=" + reAsking + "]";
    }
}
