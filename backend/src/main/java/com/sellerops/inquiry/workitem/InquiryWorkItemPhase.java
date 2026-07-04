package com.sellerops.inquiry.workitem;

/**
 * The lifecycle phase of a seller inquiry work item — the exact set ported from the
 * merged collector TS contract ({@code WorkItemPhase} in {@code collector/src/work/
 * types.ts}): {@code REJECTED} and {@code FAILED} are terminal non-success, {@code
 * COMPLETED} is the only terminal success (verification passed), and execution
 * success alone is {@code EXECUTED} (not completion).
 *
 * <p><b>This slice only ever creates {@link #OPEN}.</b> The remaining phases exist
 * so the type is faithful to the lifecycle and the queue's phase filter is a real
 * predicate; no transition into them is implemented yet (proposal / approval /
 * action / execution / verification are deferred).
 */
public enum InquiryWorkItemPhase {
    OPEN,
    PROPOSED,
    APPROVED,
    REJECTED,
    ACTION_PENDING,
    EXECUTED,
    COMPLETED,
    FAILED
}
