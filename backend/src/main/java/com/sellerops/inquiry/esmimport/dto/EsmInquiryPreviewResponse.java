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
 *   <li>{@code operationalNotices} — platform operational messages (e.g. 긴급메시지
 *       shipping-delay notices); valid source rows intentionally excluded, never persisted</li>
 *   <li>{@code unsupported} — unrecognized (fail-closed) rows; never persisted</li>
 *   <li>{@code invalid} — malformed buyer rows (see {@code rowErrors})</li>
 * </ul>
 * Operational notices and unsupported rows are counted separately from {@code invalid} —
 * they are excluded on purpose, not malformed header/timestamp errors.
 * {@code previewToken} is the signed, expiring handle required to confirm the identical
 * file against the identical existing DB state.
 */
public record EsmInquiryPreviewResponse(
        int newUnanswered,
        int newAnswered,
        int statusUpdates,
        int unchangedDuplicates,
        int operationalNotices,
        int unsupported,
        int invalid,
        List<EsmInquiryRowErrorDto> rowErrors,
        String previewToken) {
}
