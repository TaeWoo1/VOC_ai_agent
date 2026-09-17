package com.sellerops.inquiry.publish;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Component;

/**
 * <b>The explicit reply decisions a seller has already made on a product — as facts, not as a rule.</b>
 *
 * <p>When this company approved a reply, it stated something about how it answers. A later investigation may be
 * shown that as evidence («지난 비슷한 건에서 판매자는 …») so it stops proposing what this seller has repeatedly
 * declined to say. That is the whole permitted use: <em>context for the next investigation</em>. Nothing here
 * learns a threshold, builds a preference model, edits a policy, or promotes one judgement into a general rule —
 * a decision read from here changes what the investigator is told, never what the product believes.
 *
 * <p><b>What deliberately does not leave.</b> Only the approved draft version and when the decision was made. Not
 * the approver ({@code SELLER:<uuid>} — an identifier, and the investigation payload floor admits none), not the
 * approved fingerprint, not the target's external id, and never the approved text: what the seller said to one
 * customer is that customer's row, and a second copy of it inside an unrelated case's evidence is how a private
 * answer reaches a vendor request it was never part of.
 *
 * <p>Read-only by construction: two indexed reads of rows other code wrote, scoped to the caller's organisation.
 */
@Component
public class ReplyDecisionHistoryReader {

    /** The most recent decisions first. A bounded list: evidence, not a corpus. */
    public record ReplyDecision(int approvedDraftVersion, Instant decidedAt) {
    }

    private final InquiryApprovalRepository approvals;

    public ReplyDecisionHistoryReader(InquiryApprovalRepository approvals) {
        this.approvals = approvals;
    }

    /** Empty when this seller has approved no reply on this product — which is itself not evidence of anything. */
    public List<ReplyDecision> onProduct(UUID orgId, UUID productId, int limit) {
        if (productId == null || limit <= 0) {
            return List.of();
        }
        return approvals.approvedOnProduct(orgId, productId, PageRequest.of(0, limit)).stream()
                .map(approval -> new ReplyDecision(approval.getApprovedDraftVersion(), approval.getCreatedAt()))
                .toList();
    }
}
