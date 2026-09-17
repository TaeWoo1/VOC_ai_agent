package com.sellerops.responsibility.aside;

/** Where one unattended job stands. A job leaves {@code QUEUED} exactly once — that is what single-use means. */
public enum ScheduledAsideJobStatus {

    /** Handed out, not yet taken. Claimable until it expires. */
    QUEUED,

    /** A device holds it under a lease. A lease that runs out frees the job by time, never by asking. */
    CLAIMED,

    /** The device reported an outcome. Terminal. */
    SETTLED,

    /** Nobody claimed it in time. Terminal, and distinct from «reported nothing»: it never ran. */
    EXPIRED
}
