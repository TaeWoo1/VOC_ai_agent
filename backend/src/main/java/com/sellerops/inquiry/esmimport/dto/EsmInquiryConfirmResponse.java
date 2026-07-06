package com.sellerops.inquiry.esmimport.dto;

import java.util.UUID;

/**
 * The result of a confirmed import. {@code inserted} new inquiries, {@code statusUpdated}
 * existing inquiries reconciled from UNANSWERED to ANSWERED (OPEN work items completed),
 * {@code skipped} unchanged duplicates, {@code rejected} malformed buyer rows.
 * {@code operationalNotices} and {@code unsupported} are excluded (non-buyer) rows that
 * were never persisted — reported so they are not silently counted as successful imports.
 * {@code batchId} is null when the file had no buyer rows at all (e.g. an all-operational
 * file): confirm then performs zero import-domain writes and creates no batch.
 * {@code idempotentReplay} is true when the identical file had already been imported —
 * the batch resolved to the existing one and no duplicate domain rows were created.
 */
public record EsmInquiryConfirmResponse(
        UUID batchId,
        int inserted,
        int statusUpdated,
        int skipped,
        int rejected,
        int operationalNotices,
        int unsupported,
        boolean idempotentReplay) {
}
