package com.sellerops.connector.cafe24.spike;

/**
 * The capability judgment the spike exists to produce (§4 of the spike brief).
 * A verdict is only meaningful once the spike either reached a real POST result or
 * proved it cannot post; operational refusals and dry-runs carry {@link #NONE}.
 */
public enum SpikeVerdict {

    /**
     * A — comment created AND the article's reply_status became {@code C}. The
     * official comments API is a candidate primary path for inquiry reply.
     */
    API_REPLY_PRIMARY_CANDIDATE,

    /**
     * B — comment created BUT reply_status stayed {@code N}/{@code P}/blank. Do NOT
     * auto-PUT the article; HALT and report only that a separate official
     * status-update step would be required.
     */
    COMMENT_OK_STATUS_UNCHANGED_HALT,

    /**
     * C — comment create was rejected / field-mismatched, or write scope was never
     * granted. The Guided Handoff path remains the primary route.
     */
    GUIDED_HANDOFF_REMAINS,

    /** No capability conclusion (operational refusal, dry-run, or transport halt). */
    NONE
}
