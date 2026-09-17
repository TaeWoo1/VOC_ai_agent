package com.sellerops.inquiry.publish;

import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * <b>What the answer lifecycle observed — in its own words.</b>
 *
 * <p>A reader outside this package can watch a seller approve a prepared reply and still learn
 * nothing about whether anything reached the customer. That fact is owned here: the execution row
 * this package writes, and the verification row its adapters write after a re-query. This hands the
 * two out as a read-only statement so another package can <em>quote</em> them instead of minting a
 * second vocabulary for «sent» — the distinction that keeps a case able to say the seller acted
 * without ever claiming delivery it did not observe.
 *
 * <p>Every token that leaves is one this package already chose: {@link InquiryExecutionStatus},
 * {@link PublishOutcomeCategory}, and the adapter's own observed signal (Cafe24's {@code ANSWERED}
 * or {@code ANSWER_POSTED_STATUS_UNRESOLVED}). Nothing here approves, binds, dispatches, re-sends or
 * calls a channel: it is two indexed reads of rows other code wrote, scoped to the caller's
 * organisation, and it holds no setter for any of them.
 */
@Component
public class AnswerDeliveryTruthReader {

    /**
     * @param status         the execution lifecycle's own state
     * @param category       that same state as the seller-facing outcome family
     * @param verified       whether a re-query proved completion; {@code null} when none has run yet
     * @param observedSignal the adapter's own word for what it saw; {@code null} when nothing was verified
     */
    public record AnswerDeliveryTruth(String status, String category, Boolean verified, String observedSignal) {
    }

    private final InquiryExecutionRepository executions;
    private final InquiryVerificationRepository verifications;

    public AnswerDeliveryTruthReader(InquiryExecutionRepository executions,
                                     InquiryVerificationRepository verifications) {
        this.executions = executions;
        this.verifications = verifications;
    }

    /**
     * Empty when this work item never reached an execution at all — the seller moved it on some other way, and
     * «no row» is the honest answer rather than a delivery state nobody recorded.
     */
    public Optional<AnswerDeliveryTruth> observe(UUID orgId, UUID workItemId) {
        return executions.findByWorkItemId(workItemId)
                .filter(execution -> orgId.equals(execution.getOrgId()))
                .map(execution -> {
                    InquiryVerification latest = verifications
                            .findTopByExecutionIdOrderByCreatedAtDesc(execution.getId())
                            .orElse(null);
                    InquiryExecutionStatus status = execution.getStatus();
                    return new AnswerDeliveryTruth(
                            status == null ? null : status.name(),
                            status == null ? null : PublishOutcomeCategory.fromStatus(status).name(),
                            latest == null ? null : latest.isVerified(),
                            latest == null ? null : latest.getObservedStatus());
                });
    }
}
