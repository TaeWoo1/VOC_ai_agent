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
    WORK_ITEM_DISMISSED,
    /**
     * A guided handoff was minted for a read-only channel (e.g. Cafe24) whose reply is
     * performed by the operator on the marketplace itself. Recorded with {@code
     * phase_from == phase_to == OPEN}: the guided handoff deliberately does <b>not</b>
     * advance the work-item phase, so the connector reconcile ({@link
     * InquiryWorkItemWriter#reconcileConnectorAnswered}) can still complete the OPEN item
     * when the answer is later re-collected as 처리완료.
     */
    GUIDED_HANDOFF_MINTED,
    /**
     * The operator reported the outcome of their own manual reply on the marketplace — a
     * LOCAL, explicitly UNVERIFIED fact, never a completion. Verified completion is the
     * separate connector reconcile on a later re-collect (reply_status C). Also written
     * with {@code phase_from == phase_to == OPEN}.
     */
    GUIDED_HANDOFF_REPORTED
}
