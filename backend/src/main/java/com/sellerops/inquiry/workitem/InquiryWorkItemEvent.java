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
    /**
     * A refused attempt re-armed after the REQUEST ITSELF was corrected — never an automatic retry.
     *
     * <p>{@code PERMANENT_FAILURE} means "resending THIS body would be refused again", and that stays
     * true. It does not mean the work item can never be attempted again: when the provider created
     * nothing and the request contract was actually fixed, a person may re-arm the projection. The
     * event carries the refused attempt's own result in its command id, because the execution row is
     * one per work item and re-arming it overwrites the fields that held it.
     */
    EXECUTION_REARMED,
    VERIFICATION_RECORDED,
    WORK_ITEM_DISMISSED
}
