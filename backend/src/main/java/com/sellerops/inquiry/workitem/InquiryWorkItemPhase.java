package com.sellerops.inquiry.workitem;

/**
 * The lifecycle phase of a seller inquiry work item — the exact set ported from the
 * merged collector TS contract ({@code WorkItemPhase} in {@code collector/src/work/
 * types.ts}): {@code REJECTED} and {@code FAILED} are terminal non-success, {@code
 * COMPLETED} is the only terminal success (verification passed), and execution
 * success alone is {@code EXECUTED} (not completion).
 *
 * <p>The connector ingest path only ever creates {@link #OPEN}. {@link #DISMISSED}
 * is a distinct terminal phase reached by an operator-approved bulk dismissal
 * (e.g. spam) — never by answering the inquiry, so it is deliberately <b>not</b>
 * {@link #COMPLETED} (which means verification of a real reply). The remaining
 * phases exist so the type is faithful to the lifecycle and the queue's phase
 * filter is a real predicate; no transition into them is implemented yet (proposal
 * / approval / action / execution / verification are deferred).
 */
public enum InquiryWorkItemPhase {
    OPEN,
    PROPOSED,
    APPROVED,
    REJECTED,
    ACTION_PENDING,
    EXECUTED,
    COMPLETED,
    /**
     * Terminal: the work item was set aside without being answered (e.g. dismissed
     * as spam via an audited operator decision). It leaves the {@code OPEN}
     * operational queue naturally while the inquiry, work item, and audit trail are
     * all preserved. Its {@link InquiryWorkItem#getDisposition() disposition} records
     * why.
     */
    DISMISSED,
    FAILED;

    /**
     * The phases where the work is still waiting for the SELLER to decide something.
     *
     * <p>Everything else is either terminal or already inside the execution lane, where offering the
     * item again as "오늘 확인할 일" would be asking the seller to redo a decision they made. Declared
     * once and read by every recommendation surface, so a phase added later has to be classified here
     * rather than silently landing on one side.
     */
    public static final java.util.Set<InquiryWorkItemPhase> AWAITING_SELLER =
            java.util.Collections.unmodifiableSet(java.util.EnumSet.of(OPEN, PROPOSED));
}
