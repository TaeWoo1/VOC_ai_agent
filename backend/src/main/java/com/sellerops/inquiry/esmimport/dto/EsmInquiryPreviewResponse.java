package com.sellerops.inquiry.esmimport.dto;

import java.util.List;

/**
 * The result of a zero-write preview. Rows are bucketed by what confirm would do:
 * <ul>
 *   <li>{@code newUnanswered} — insert + open one OPEN work item</li>
 *   <li>{@code newAnswered} — insert as history (no work item)</li>
 *   <li>{@code statusUpdates} — an existing UNANSWERED inquiry this file now reports
 *       ANSWERED; confirm reconciles it (completes an OPEN work item)</li>
 *   <li>{@code unchangedDuplicates} — already present with no change to apply</li>
 *   <li>{@code invalid} — rejected rows (see {@code rowErrors})</li>
 * </ul>
 * {@code previewToken} is the signed, expiring handle required to confirm the identical
 * file against the identical existing DB state.
 */
public record EsmInquiryPreviewResponse(
        int newUnanswered,
        int newAnswered,
        int statusUpdates,
        int unchangedDuplicates,
        int invalid,
        List<EsmInquiryRowErrorDto> rowErrors,
        String previewToken) {
}
