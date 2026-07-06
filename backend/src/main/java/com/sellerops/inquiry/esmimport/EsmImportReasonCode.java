package com.sellerops.inquiry.esmimport;

/**
 * Sanitized, content-free reason codes for a rejected (invalid) ESM inquiry row.
 * These are the ONLY per-row detail surfaced to the operator or logs — never the
 * inquiry body, product name, buyer id, seller id, answer text, or any timestamp
 * value. Each code names a structural defect, not the offending data.
 */
public enum EsmImportReasonCode {

    /** 문의내용 (inquiry body) is blank. */
    MISSING_BODY,
    /** 접수일시 (received timestamp) is blank. */
    MISSING_RECEIVED_AT,
    /** 접수일시 or 처리일시 is present but not a valid {@code yyyy-MM-dd HH:mm:ss}. */
    BAD_TIMESTAMP,
    /** 미처리/처리중 but answer content or a processed time is present (contradictory). */
    CONTRADICTORY_STATUS,
    /** Blank/unknown status with answer content or a processed time (ambiguous). */
    AMBIGUOUS_STATUS
}
