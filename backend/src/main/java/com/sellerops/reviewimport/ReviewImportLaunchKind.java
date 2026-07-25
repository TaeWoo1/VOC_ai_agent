package com.sellerops.reviewimport;

/**
 * What a {@link ReviewImportLaunch} authorizes one guided Action Window run to do.
 *
 * <p>Two kinds rather than one because the FIRST run of an onboarding import has nothing to point at:
 * the plan is built FROM what discovery finds, so a discovery ticket cannot carry a segment.
 */
public enum ReviewImportLaunchKind {

    /**
     * Find the historical range the marketplace currently lets this seller reach. Issued with no plan and
     * no segment; recording its discovered range is what creates the plan.
     */
    DISCOVERY,

    /** Guide ONE already-planned segment to a downloaded, automatically ingested file. */
    SEGMENT
}
