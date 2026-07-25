package com.sellerops.reviewimport;

/**
 * How we know the scope actually exported matched the segment being imported.
 *
 * <p>Kept separate from {@link RangeDiscoveryEvidence} — which answers a different question (what range
 * was reachable at all) — so neither column can hold a value that makes no sense for it.
 *
 * <p>Neither value claims that every review NAVER holds for the range was reconciled: the per-export row
 * cap is unknown, so a matched scope proves the right window was exported, not that the window was
 * complete. That distinction lives in {@code review_import_segment.rows_reconciled}.
 */
public enum ScopeEvidence {

    /**
     * SellerOps read the selected range back off the live controls and it matched the segment. A mismatch
     * is not recorded here — it fails the run closed before any file is accepted.
     */
    MACHINE_MATCHED,

    /**
     * SellerOps could not read the selected range, so the guided tutorial showed the required dates and
     * the seller confirmed the export matched them. A human assertion, never to be labelled verified.
     */
    OPERATOR_CONFIRMED
}
