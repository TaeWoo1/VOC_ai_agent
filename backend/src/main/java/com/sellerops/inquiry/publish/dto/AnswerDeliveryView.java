package com.sellerops.inquiry.publish.dto;

/**
 * <b>What actually happened to the answer — on a read, not only in the reply to the press.</b>
 *
 * <p>Until this existed, the outcome of the one marketplace WRITE this product performs lived
 * exclusively in the body of the {@code confirm-publish} response. A reload lost it: the detail read
 * carried the work item's phase and the inquiry's status and nothing about the send, so a seller who
 * closed the tab could not learn from any screen whether their answer had reached the customer.
 * Meanwhile the local inquiry row stays {@code UNANSWERED} until a verified read-back or the next
 * collection, which is exactly the window in which they would want to look.
 *
 * <p>Every field is quoted from {@code AnswerDeliveryTruthReader} — the execution row and its latest
 * verification, which are the rows the publish package already writes. <b>No new store, no second
 * vocabulary, and no derivation:</b> this record is a shape for tokens that already existed.
 *
 * <p>Absent (null on the parent) means the work item never reached an execution at all. That is the
 * honest answer for an inquiry the seller handled some other way, and it is not a delivery state.
 *
 * @param status         the execution lifecycle's own state ({@code InquiryExecutionStatus})
 * @param category       that same state as the seller-facing outcome family ({@code PublishOutcomeCategory})
 * @param verified       whether a re-query proved completion; null when none has run yet
 * @param observedSignal the adapter's own word for what it saw; null when nothing was verified
 */
public record AnswerDeliveryView(String status, String category, Boolean verified, String observedSignal) {
}
