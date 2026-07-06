package com.sellerops.inquiry.workitem;

/**
 * The structured reason a work item was moved to {@link
 * InquiryWorkItemPhase#DISMISSED} — recorded on both the work item (current
 * disposition) and its append-only audit row (why the transition happened). Kept a
 * closed, structured enum so a dismissal is never justified by inferred or free-text
 * criteria; new dispositions are added here explicitly, never derived at runtime.
 *
 * <p>{@link #SPAM} is the only value supported in this slice.
 */
public enum InquiryWorkItemDisposition {
    /** The inquiry is promotional / spam and was set aside without being answered. */
    SPAM
}
