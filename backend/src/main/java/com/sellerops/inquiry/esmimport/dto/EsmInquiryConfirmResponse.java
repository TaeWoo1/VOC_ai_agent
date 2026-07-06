package com.sellerops.inquiry.esmimport.dto;

import java.util.UUID;

/**
 * The result of a confirmed import. {@code inserted} new inquiries, {@code statusUpdated}
 * existing inquiries reconciled from UNANSWERED to ANSWERED (OPEN work items completed),
 * {@code skipped} unchanged duplicates, {@code rejected} invalid rows.
 * {@code idempotentReplay} is true when the identical file had already been imported —
 * the batch resolved to the existing one and no duplicate domain rows were created.
 */
public record EsmInquiryConfirmResponse(
        UUID batchId,
        int inserted,
        int statusUpdated,
        int skipped,
        int rejected,
        boolean idempotentReplay) {
}
