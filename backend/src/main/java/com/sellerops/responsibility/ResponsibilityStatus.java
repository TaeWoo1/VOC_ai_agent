package com.sellerops.responsibility;

/** Whether Reviewnary currently holds the job. Only {@link #ACTIVE} creates runs. */
public enum ResponsibilityStatus {
    ACTIVE,
    /** Handed back for now. No run is created; queued runs are cancelled; resume picks up the current window. */
    PAUSED,
    /** Handed back. No run is created until the seller activates it again. */
    STOPPED
}
