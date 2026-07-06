package com.sellerops.inquiry.esmimport;

import java.util.UUID;

/**
 * One classified row's disposition against current DB state, with the existing inquiry
 * id when it matched an existing record. Produced by the (read-only) plan and consumed
 * by the (single-transaction) apply.
 */
public record PlannedRow(EsmClassifiedRow row, EsmRowDisposition disp, UUID existingInquiryId) {
}
