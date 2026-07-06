package com.sellerops.inquiry.workitem.dismissal.dto;

import com.sellerops.inquiry.workitem.dismissal.InquiryWorkItemDismissalService.DismissalCounts;
import java.util.UUID;

/**
 * Aggregate result of a preview or execute. Carries only counts and non-PII metadata
 * — never inquiry titles, bodies, authors, or buyer data.
 *
 * <p>{@code batchId} is the durable dismissal-batch ledger row id (null for preview);
 * {@code idempotentReplay} is true when an execute matched an existing batch and did
 * nothing new. {@code executedBy} is the audit/batch executor <b>derived from
 * authentication</b>. {@code approvedBy} / {@code approvedAt} are the manifest's
 * approval metadata, echoed distinctly to make clear they are documentation of
 * sign-off — not the authenticated identity and not authorization.
 */
public record AdminDismissalResponse(
        DismissalCounts result,
        UUID batchId,
        boolean idempotentReplay,
        String executedBy,
        String approvedBy,
        String approvedAt) {
}
