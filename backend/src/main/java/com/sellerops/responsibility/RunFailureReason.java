package com.sellerops.responsibility;

/**
 * Run-level reasons — things true of the whole window, not of a source. Source-level reasons live on
 * {@link SourceFailureReason}.
 */
public enum RunFailureReason {
    /**
     * The window ended before any work on it started (the scheduler was not running across it). Recorded as a
     * CANCELLED row so the gap is visible — never silently skipped, never back-filled as if it had been worked.
     */
    MISSED,
    /** The organisation has no account for any required source. */
    NO_REQUIRED_SOURCE,
    RESPONSIBILITY_PAUSED,
    RESPONSIBILITY_STOPPED
}
