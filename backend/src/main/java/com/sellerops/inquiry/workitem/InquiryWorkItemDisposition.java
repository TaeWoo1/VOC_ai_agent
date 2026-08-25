package com.sellerops.inquiry.workitem;

/**
 * The structured reason a work item was moved to {@link
 * InquiryWorkItemPhase#DISMISSED} — recorded on both the work item (current
 * disposition) and its append-only audit row (why the transition happened). Kept a
 * closed, structured enum so a dismissal is never justified by inferred or free-text
 * criteria; new dispositions are added here explicitly, never derived at runtime.
 *
 * <p><b>Two kinds of reason, and the audit has to tell them apart.</b> {@link #SPAM} is a
 * <em>seller's judgement</em> about a customer's question, and it arrives only through an approved
 * dismissal manifest. {@link #SOURCE_THREAD_REPLY} is a <em>data correction</em>: the
 * source was re-read and said the row was never a customer's question at all. Recording the second one
 * as the first would put a decision in the ledger that nobody made, which is why it is its own value
 * rather than a reuse.
 */
public enum InquiryWorkItemDisposition {
    /** The inquiry is promotional / spam and was set aside without being answered. */
    SPAM,

    /**
     * The source says this row is a thread REPLY, not an independent customer inquiry, so the work
     * item had no subject. Written only by the bounded thread repair, from the exact ids a live READ
     * returned — never inferred, never from article-number adjacency.
     *
     * <p><b>It is not seller-selectable.</b> {@link #sellerDecision()} is false, and the dismissal
     * manifest refuses any disposition that is not a seller decision, so this value can never arrive
     * through the operator dismissal route wearing an approval envelope.
     *
     * <p><b>It says nothing about who wrote the reply.</b> That remains unproven.
     *
     * <p>Named for what the source said rather than for the repair that recorded it, and kept short
     * because the stored column is {@code varchar(32)} — the name is the fact, not the procedure.
     */
    SOURCE_THREAD_REPLY;

    /**
     * True when this disposition records a decision a human made about an inquiry — the only kind an
     * approved dismissal manifest may carry. A data correction is not a decision, and must not be
     * signed off as one.
     */
    public boolean sellerDecision() {
        return this == SPAM;
    }
}
