package com.sellerops.inquiry.esmimport;

/** Terminal status of a confirmed ESM inquiry import batch. */
public enum InquiryImportBatchStatus {
    /** The confirm ran to completion; per-row inserted/skipped/rejected are recorded. */
    COMPLETED
}
