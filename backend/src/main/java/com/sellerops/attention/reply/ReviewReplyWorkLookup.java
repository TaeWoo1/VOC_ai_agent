package com.sellerops.attention.reply;

import com.sellerops.attention.VocItemRef;
import com.sellerops.attention.triage.ReviewTriage;
import com.sellerops.attention.triage.ReviewTriageRepository;
import com.sellerops.review.publish.ReviewExecutionKind;
import com.sellerops.review.triage.ReviewTriageChannelCapability;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * Whether — and under which address — one review can carry reply work, for a surface that is not the
 * attention drill-down (product assembly A6: the 리뷰 screen's detail panel).
 *
 * <p>The reply flow ({@link ReviewReplyService}) is addressed by {@link VocItemRef}, which clients round-trip
 * and never mint. A surface that shows a review by its own id therefore needs the server to hand it the
 * ref, together with the two facts the panel mounts on: the operator's current decision and whether work
 * (a draft or an approval) already exists. Those are exactly the fields the drill-down row carries
 * ({@code OperatorVocItem.actionRef / triageDisposition / hasReplyPreparation}), computed here for one
 * review from the same repositories.
 *
 * <p><b>Capability-gated.</b> Empty for every channel whose {@link ReviewTriageChannelCapability} says
 * {@code replySupported = false} (Coupang, Cafe24) UNLESS the account's execution capability is
 * {@code API_EXECUTION} — a Cafe24 mall with the review lane on and the write grant recorded has a reply
 * flow, and it is this one. Otherwise the surface renders no reply control at all, and a client that
 * guessed the ref would still be refused by the reply endpoints' own checks.
 */
@Component
public class ReviewReplyWorkLookup {

    /** The address and state of one review's reply work. */
    public record ReplyWorkRef(String actionRef, String triageDisposition, boolean hasReplyPreparation) {
    }

    private final ReviewTriageRepository triages;
    private final ReviewReplyDraftRepository drafts;
    private final ReviewReplyApprovalRepository approvals;

    public ReviewReplyWorkLookup(ReviewTriageRepository triages, ReviewReplyDraftRepository drafts,
                                 ReviewReplyApprovalRepository approvals) {
        this.triages = triages;
        this.drafts = drafts;
        this.approvals = approvals;
    }

    /** The reply work one review can carry, or empty when its channel has no reply flow. */
    public Optional<ReplyWorkRef> forReview(UUID orgId, String channelCode, UUID reviewId) {
        return forReview(orgId, channelCode, reviewId, ReviewExecutionKind.NOT_SUPPORTED);
    }

    /** As above, with the account's execution capability opening the flow where the §1 table does not. */
    public Optional<ReplyWorkRef> forReview(UUID orgId, String channelCode, UUID reviewId,
                                            ReviewExecutionKind executionKind) {
        if (!ReviewTriageChannelCapability.of(channelCode).replySupported()
                && executionKind != ReviewExecutionKind.API_EXECUTION) {
            return Optional.empty();
        }
        String disposition = triages.findByOrgIdAndReviewId(orgId, reviewId)
                .map(ReviewTriage::getDisposition)
                .map(Enum::name)
                .orElse(null);
        List<UUID> one = List.of(reviewId);
        boolean prepared = !drafts.findReviewIdsWithDraft(orgId, one).isEmpty()
                || !approvals.findReviewIdsWithApproval(orgId, one).isEmpty();
        return Optional.of(new ReplyWorkRef(VocItemRef.forReview(reviewId), disposition, prepared));
    }
}
