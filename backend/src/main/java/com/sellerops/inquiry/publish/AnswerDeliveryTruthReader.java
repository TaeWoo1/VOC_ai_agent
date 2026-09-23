package com.sellerops.inquiry.publish;

import java.util.Optional;
import java.util.UUID;
import com.sellerops.inquiry.publish.dto.AnswerDeliveryView;
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

        /**
         * Whether anything was ever handed to a transport for this approval.
         *
         * <p>Asked here rather than by the caller because the answer is a statement about THIS
         * package's vocabulary: {@link InquiryExecutionStatus#ACTION_PENDING} is what the binding
         * writes before a transport is even looked for, and it is also where a dispatch that sent
         * nothing comes back to. A reader that compared the string itself would be keeping a second
         * copy of a word it was handed precisely so it would not have to.
         *
         * <p>False is therefore «approved, and still nothing has left» — not a failure, and not a
         * claim about the customer at all.
         */
        public boolean dispatchAttempted() {
            return status != null && !InquiryExecutionStatus.ACTION_PENDING.name().equals(status);
        }
    }

    private final InquiryExecutionRepository executions;
    private final InquiryVerificationRepository verifications;

    public AnswerDeliveryTruthReader(InquiryExecutionRepository executions,
                                     InquiryVerificationRepository verifications) {
        this.executions = executions;
        this.verifications = verifications;
    }

    /**
     * The same two rows, shaped for a seller-facing read.
     *
     * <p>A convenience over {@link #observe}, and deliberately the only mapping into the wire shape:
     * a screen that built {@code AnswerDeliveryView} itself would be a second place that decides what
     * «sent» looks like. Still four tokens this package already chose — nothing is derived here.
     */
    public Optional<AnswerDeliveryView> view(UUID orgId, UUID workItemId) {
        return observe(orgId, workItemId)
                .map(t -> new AnswerDeliveryView(t.status(), t.category(), t.verified(), t.observedSignal()));
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
