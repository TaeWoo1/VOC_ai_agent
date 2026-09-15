package com.sellerops.operationscase;

import com.sellerops.inquiry.InquiryOperationalState;
import com.sellerops.review.ReviewReplyState;
import com.sellerops.review.triage.ReviewTriageRules;
import com.sellerops.review.triage.ReviewTriageTier;

/**
 * <b>What is obvious, settled without a model.</b> Pure functions of fields the canonical records already hold.
 *
 * <p>The review side is the existing Attention rule, unchanged — {@link ReviewTriageRules#tier} — so there is no
 * second definition of «needs attention» to drift from the first. The inquiry side is the existing thread, exclusion
 * and answered-state facts. Only what these cannot settle — an unanswered customer question, a low rating with
 * something written in it — is handed to the investigator, and the handoff is the absence of a disposition.
 */
public final class OperationsCaseRules {

    private static final String THREAD_REPLY = "REPLY";

    private OperationsCaseRules() {
    }

    /**
     * @param disposition null means «a rule cannot settle this — investigate»
     */
    public record Conclusion(CaseReason reason, CasePriority priority, RequiredAuthority authority,
                             CaseDisposition disposition, CaseResolution resolution) {

        public boolean needsInvestigation() {
            return disposition == null;
        }

        static Conclusion noAction(CaseReason reason) {
            return new Conclusion(reason, CasePriority.NORMAL, RequiredAuthority.AUTO,
                    CaseDisposition.AUTO_RESOLVED, CaseResolution.RULE_NO_ACTION);
        }

        static Conclusion investigate(CaseReason reason, CasePriority priority) {
            return new Conclusion(reason, priority, RequiredAuthority.HUMAN, null, null);
        }
    }

    public static Conclusion forInquiry(String status, InquiryOperationalState operationalState, String threadRole) {
        if (THREAD_REPLY.equals(threadRole)) {
            return Conclusion.noAction(CaseReason.INQUIRY_THREAD_REPLY);
        }
        if (operationalState != null && operationalState != InquiryOperationalState.ACTIVE) {
            return Conclusion.noAction(CaseReason.INQUIRY_NOT_OPERATIONAL);
        }
        if (!"UNANSWERED".equals(status)) {
            return Conclusion.noAction(CaseReason.INQUIRY_ALREADY_ANSWERED);
        }
        return Conclusion.investigate(CaseReason.UNANSWERED_INQUIRY, CasePriority.HIGH);
    }

    public static Conclusion forReview(Integer rating, String body, ReviewReplyState replyState) {
        if (replyState == ReviewReplyState.ANSWERED) {
            return Conclusion.noAction(CaseReason.REVIEW_ALREADY_ANSWERED);
        }
        ReviewTriageTier tier = ReviewTriageRules.tier(rating, body);
        return switch (tier) {
            case FYI -> Conclusion.noAction(CaseReason.REVIEW_ROUTINE);
            case WATCH -> new Conclusion(CaseReason.REVIEW_WATCH, CasePriority.NORMAL, RequiredAuthority.AUTO,
                    CaseDisposition.MONITORING, null);
            case NEEDS_ATTENTION -> Conclusion.investigate(CaseReason.REVIEW_NEEDS_ATTENTION,
                    rating != null && rating <= 1 ? CasePriority.HIGH : CasePriority.NORMAL);
        };
    }
}
