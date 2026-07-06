package com.sellerops.inquiry.esmimport;

/**
 * What confirm will do with one classified ESM row, decided against current DB state.
 * Preview reports the buckets; confirm applies them.
 */
public enum EsmRowDisposition {
    /** Rejected (malformed buyer) row — never creates or changes any domain state. */
    INVALID,
    /** Platform operational notice — a valid source row, intentionally excluded (no writes). */
    OPERATIONAL_NOTICE,
    /** Unrecognized (fail-closed) row — intentionally excluded (no writes). */
    UNSUPPORTED,
    /** No existing inquiry; insert + open one OPEN work item. */
    NEW_UNANSWERED,
    /** No existing inquiry; insert as answered history (no work item). */
    NEW_ANSWERED,
    /** Existing UNANSWERED inquiry the file now reports ANSWERED; reconcile it. */
    STATUS_UPDATE,
    /** Already present with nothing to change (including in-file repeats and no-downgrade). */
    UNCHANGED_DUPLICATE
}
