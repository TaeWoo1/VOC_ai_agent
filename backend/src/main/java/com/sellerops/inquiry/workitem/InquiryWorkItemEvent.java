package com.sellerops.inquiry.workitem;

/**
 * Audit event type for a seller inquiry work item, named after the merged collector
 * TS {@code AuditEventType}. {@link #WORK_ITEM_OPENED} is recorded when the work
 * item is created (connector ingest); {@link #PROPOSAL_ADDED} is recorded on the
 * seller-initiated OPEN&nbsp;&rarr;&nbsp;PROPOSED transition, in the same transaction
 * that attaches the proposal; {@link #WORK_ITEM_DISMISSED} is recorded on the
 * operator-approved OPEN&nbsp;&rarr;&nbsp;DISMISSED transition (e.g. spam). Later
 * lifecycle events (approved/executed/verified) are deferred.
 */
public enum InquiryWorkItemEvent {
    WORK_ITEM_OPENED,
    PROPOSAL_ADDED,
    APPROVAL_GRANTED,
    ACTION_INTENT_CREATED,
    EXECUTION_RECORDED,
    VERIFICATION_RECORDED,
    WORK_ITEM_DISMISSED
}
