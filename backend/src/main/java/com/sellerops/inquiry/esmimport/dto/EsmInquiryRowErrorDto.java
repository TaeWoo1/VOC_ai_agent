package com.sellerops.inquiry.esmimport.dto;

/**
 * A sanitized per-row validation error: the row number and a structural reason code
 * only. Never carries any cell value, content, or PII.
 */
public record EsmInquiryRowErrorDto(int sourceRow, String reasonCode) {
}
