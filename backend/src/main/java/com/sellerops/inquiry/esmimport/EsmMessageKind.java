package com.sellerops.inquiry.esmimport;

/**
 * Semantic kind of an ESM export row, decided from structured columns <b>before</b>
 * answered/unanswered status classification. Only {@link #BUYER_INQUIRY} rows are real
 * customer inquiries that may become canonical Inquiry records + OPEN reply work items;
 * the other kinds are valid source rows that this importer intentionally excludes and
 * never persists.
 */
public enum EsmMessageKind {

    /** A genuine buyer inquiry requiring a seller reply — the only persisted kind. */
    BUYER_INQUIRY,

    /**
     * A platform-generated operational message (e.g. an ESM 긴급메시지 shipping-delay
     * emergency notice), not a buyer inquiry. Excluded from import: creates no Inquiry,
     * Product, WorkItem, provenance, or audit through this importer. A future SellerOps
     * workflow will route these (shipping-delay notice → shipment confirmation /
     * expected-date update / cancellation review).
     */
    PLATFORM_OPERATIONAL_NOTICE,

    /**
     * A row whose structured kind is not recognized. Fails closed — never treated as a
     * buyer inquiry, never persisted.
     */
    UNSUPPORTED_OR_UNKNOWN
}
