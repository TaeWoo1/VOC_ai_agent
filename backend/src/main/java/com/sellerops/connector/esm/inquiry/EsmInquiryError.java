package com.sellerops.connector.esm.inquiry;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Failure body shape of the ESM+ official INQUIRY API: {@code { resultCode, message }}.
 * Distinct from the success shape (a top-level array of {@link EsmInquiryItem}).
 *
 * <p>Only {@code resultCode} (a numeric code) is ever surfaced by callers; the
 * free-text {@code message} is never echoed into an exception, log, or diagnostic
 * to preserve the "status/code only, never the body" contract.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record EsmInquiryError(
        @JsonProperty("resultCode") Integer resultCode,
        @JsonProperty("message") String message) {
}
