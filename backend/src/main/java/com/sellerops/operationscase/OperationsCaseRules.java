package com.sellerops.operationscase;

import com.sellerops.inquiry.InquiryOperationalState;
import com.sellerops.review.ReviewReplyState;
import com.sellerops.review.triage.ReviewTriageRules;
import com.sellerops.review.triage.ReviewTriageTier;
import com.sellerops.reviewissue.IssueSignatureExtractor;
import com.sellerops.reviewissue.RuleBasedIssueSignatureExtractor;
import com.sellerops.reviewissue.UnknownReason;

/**
 * <b>What is obvious, settled without a model.</b> Pure functions of fields the canonical records already hold.
 *
 * <p>The review side is the existing Attention rule, unchanged — {@link ReviewTriageRules#tier} — so there is no
 * second definition of «needs attention» to drift from the first. The inquiry side is the existing thread, exclusion
 * and answered-state facts. Only what these cannot settle — an unanswered customer question, a low rating with
 * something written in it — is handed to the investigator, and the handoff is the absence of a disposition.
 *
 * <p><b>A rating alone never closes a review someone wrote words in</b> (Customer Ops Product Quality Closure v1).
 * Measured on the 218 labelled NAVER reviews: the 4–5★ FYI rule closed 114 reviews by itself, and 18 of them a person
 * had marked 확인 필요 — «별점은 5점인데 한쪽이 떨어졌어요». Every one of the 18 had text; none was textless. The
 * rating cannot see the words and the tier is deliberately forbidden to read them ({@code ReviewTriageRules}), so the
 * only thing a rating may still settle alone is a high rating with nothing to read. A high rating WITH text stays open:
 * the investigator reads it when the issue extractor finds a problem the customer asserts, and otherwise it is watched
 * for {@link OperationsCaseReconciler#MONITORING_WINDOW} rather than closed. The extractor only ever chooses between two
 * outcomes that keep the review open — it can add a look, never remove one — so the triage tier and its «text cannot
 * move a tier» contract are untouched. The same signal lifts a 3★ review that asserts a problem from watching to an
 * investigation; it does not demote anything.
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
        boolean text = !ReviewTriageRules.isTextless(body);
        return switch (tier) {
            case FYI -> !text ? Conclusion.noAction(CaseReason.REVIEW_ROUTINE)
                    : assertsProblem(body)
                            ? Conclusion.investigate(CaseReason.REVIEW_HIGH_RATING_PROBLEM, CasePriority.NORMAL)
                            : watch(CaseReason.REVIEW_HIGH_RATING_WITH_TEXT);
            case WATCH -> text && assertsProblem(body)
                    ? Conclusion.investigate(CaseReason.REVIEW_WATCH_PROBLEM, CasePriority.NORMAL)
                    : watch(CaseReason.REVIEW_WATCH);
            case NEEDS_ATTENTION -> Conclusion.investigate(CaseReason.REVIEW_NEEDS_ATTENTION,
                    rating != null && rating <= 1 ? CasePriority.HIGH : CasePriority.NORMAL);
        };
    }

    private static Conclusion watch(CaseReason reason) {
        return new Conclusion(reason, CasePriority.NORMAL, RequiredAuthority.AUTO, CaseDisposition.MONITORING, null);
    }

    /** The production issue extractor, with the default the application runs ({@code inherit-aspect: false}). */
    private static final IssueSignatureExtractor EXTRACTOR = new RuleBasedIssueSignatureExtractor(false);

    /**
     * Whether the customer asserts a problem anywhere in the body — a unit with a signature, or a problem the extractor
     * could not attribute to an aspect. A negated problem («파손없이») and a complaint about another product do not count.
     */
    static boolean assertsProblem(String body) {
        return EXTRACTOR.extract(body).stream().anyMatch(unit -> unit.signature() != null
                || unit.unknownReason() == UnknownReason.NO_ASPECT);
    }
}
