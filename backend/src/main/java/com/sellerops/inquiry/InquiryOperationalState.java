package com.sellerops.inquiry;

/**
 * Whether an inquiry is part of the seller's <b>current operational truth</b> — the corpus every
 * "what do I have to deal with right now" number is counted over (미답변 수, Today Inbox, 상품 신호,
 * 반복 문의, item analysis, Operator findings, the weekly report's live figures).
 *
 * <p><b>This is a projection, not a judgement.</b> Nothing in this enum decides anything. {@link
 * #EXCLUDED_SPAM} mirrors a decision the seller already made and that is already durably recorded
 * elsewhere — {@code inquiry_work_item.phase = DISMISSED} with {@code disposition = SPAM}, written
 * through an approved dismissal batch with a manifest hash. {@link
 * com.sellerops.inquiry.lifecycle.InquiryOperationalStateProjector} is the only writer, and it can
 * always rebuild this column from that ledger. If the two ever disagree, the work item is right.
 *
 * <p><b>Excluded is not deleted.</b> The row keeps its body, its status, its work item, its audit
 * trail and its customer-memory entry; only the <em>current</em> reads pass over it. Historical and
 * audit reads see it unchanged, and a reversal at the work item flows straight back through the
 * projector. That is the whole reason this is a state and not a delete.
 */
public enum InquiryOperationalState {

    /** Counted everywhere. The default for every row, and the only state ingestion ever writes. */
    ACTIVE,

    /**
     * The seller dismissed this inquiry as spam. Projected from the work item's {@code SPAM}
     * disposition; cleared back to {@link #ACTIVE} the moment that dismissal is reversed.
     */
    EXCLUDED_SPAM,

    /**
     * The source no longer shows this inquiry.
     *
     * <p><b>Spelled here, never produced.</b> There is no transition into this state anywhere in
     * {@code src/main}, and {@code InquiryOperationalStateFenceTest} fails the build if one appears.
     * The value exists so the lifecycle has somewhere honest to put a source deletion once absence
     * can be trusted — and it cannot be trusted yet. The Cafe24 board-article read is an offset sweep
     * with no documented ordering, over a {@code start_date}/{@code end_date} filter that has already
     * been observed returning rows outside its own window (the reason {@code
     * Cafe24ApiConnector.withinWindow} exists). Under that read, a row missing from a page is not
     * evidence that the seller deleted it. Turning absence into a tombstone needs a live proof that
     * one sweep is an authoritative snapshot; until that proof exists, this value stays unreachable.
     *
     * <p>Same technique, and the same reason, as the Operator's unreachable WRITE action class and the
     * unreachable "inferred" product-fact confidence: naming the thing the system must not do is what
     * lets a test assert it does not do it. (Spelled in prose here on purpose — those two values have
     * their own source-scanning fences, and a javadoc mention would register as a producer.)
     */
    SOURCE_REMOVED;

    /** True when this state keeps the inquiry inside current operational reads. */
    public boolean isActive() {
        return this == ACTIVE;
    }
}
