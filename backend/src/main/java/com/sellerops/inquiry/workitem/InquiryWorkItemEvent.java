package com.sellerops.inquiry.workitem;

/**
 * Audit event type for a seller inquiry work item. Only {@link #WORK_ITEM_OPENED}
 * is emitted in this slice — recorded once, in the same transaction that creates
 * the {@link InquiryWorkItem}. Later lifecycle events (proposed/approved/executed/
 * verified) are deferred.
 */
public enum InquiryWorkItemEvent {
    WORK_ITEM_OPENED
}
