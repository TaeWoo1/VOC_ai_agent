package com.sellerops.attention.reply;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.data.domain.PageRequest;
import org.springframework.test.context.ActiveProfiles;

/**
 * <b>「승인했지만 아직 안 보낸 것」 — and the 「아직 안 보낸」 half was never actually checked.</b>
 *
 * <p>{@code PreparedWork.reviewRepliesApproved} has always documented itself as «reviews whose reply the seller
 * approved and has not yet reported as sent», but the predicate behind it read the approval state alone. Approving
 * freezes the text; reporting a submission writes a {@link ReviewReplyOutcome} and does not move the approval. So
 * «APPROVED» stayed true forever, and a seller who posted every reply they approved would have kept being told the
 * work was waiting — the Home's one section of finishable work turning into a list that never empties.
 *
 * <p>The distinction these tests hold is between the two outcomes, which are not two degrees of the same thing:
 * {@link OperatorOutcome#OPERATOR_REPORTED_SUBMITTED} is the seller saying they posted it, and
 * {@link OperatorOutcome#SUBMISSION_ABORTED} is one guided run ending at the submit barrier — the enum's own words
 * are «a normal end, not a failure». Aborting posts nothing and withdraws nothing, so the reply is still approved
 * and still unposted, which is exactly the population this list exists to name.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class StandingApprovalExcludesReportedTest {

    @Autowired ReviewReplyApprovalRepository approvals;
    @Autowired ReviewReplyOutcomeRepository outcomes;

    private final UUID org = UUID.randomUUID();
    private static final Instant WHEN = Instant.parse("2026-09-05T00:00:00Z");

    private UUID approve(int version) {
        UUID reviewId = UUID.randomUUID();
        ReviewReplyApproval a = new ReviewReplyApproval();
        a.setOrgId(org);
        a.setReviewId(reviewId);
        a.setState(ReviewReplyApprovalState.APPROVED);
        a.setApprovedVersion(version);
        a.setApprovedFingerprint("fp-" + version);
        a.setDecidedBy("operator@example.com");
        a.setDecidedAt(WHEN);
        approvals.save(a);
        return reviewId;
    }

    private void report(UUID reviewId, int version, OperatorOutcome outcome) {
        ReviewReplyOutcome o = new ReviewReplyOutcome();
        o.setOrgId(org);
        o.setReviewId(reviewId);
        o.setSubmissionRef("ref" + UUID.randomUUID().toString().substring(0, 8));
        o.setRecordedVersion(version);
        o.setRecordedFingerprint("fp-" + version);
        o.setFingerprintAlgorithm("review-reply-v1");
        o.setOperatorOutcome(outcome);
        o.setVerification(VerificationState.UNVERIFIED);
        o.setAwRunRef("run_abc123");
        o.setCommandId(UUID.randomUUID().toString());
        o.setRecordedBy("SELLER:op");
        outcomes.save(o);
    }

    private List<UUID> standing() {
        return approvals.findStandingByOrgId(org, PageRequest.of(0, 20)).stream()
                .map(ReviewReplyApproval::getReviewId).toList();
    }

    @Test
    @DisplayName("reported as sent leaves the list; nothing else does")
    void reportedSubmittedIsTheOnlyExclusion() {
        UUID untouched = approve(1);
        UUID aborted = approve(1);
        UUID posted = approve(1);

        // Four aborted runs on one approval — the shape the live org actually had.
        for (int i = 0; i < 4; i++) {
            report(aborted, 1, OperatorOutcome.SUBMISSION_ABORTED);
        }
        report(posted, 1, OperatorOutcome.OPERATOR_REPORTED_SUBMITTED);

        assertThat(standing())
                .as("aborting is a run that ended, not a reply that went out — the text is still approved and "
                        + "still unposted")
                .containsExactlyInAnyOrder(untouched, aborted)
                .doesNotContain(posted);
        assertThat(approvals.countStandingByOrgId(org))
                .as("the count and the list are one predicate, or the Home's number describes a different set "
                        + "than its rows")
                .isEqualTo(2);
    }

    @Test
    @DisplayName("a reply posted, then revised and approved again, is waiting again")
    void aNewlyApprovedRevisionComesBack() {
        UUID reviewId = approve(1);
        report(reviewId, 1, OperatorOutcome.OPERATOR_REPORTED_SUBMITTED);
        assertThat(standing()).isEmpty();

        // The seller edits and approves v2. The v1 outcome says nothing about this text.
        ReviewReplyApproval a = approvals.findAll().stream()
                .filter(x -> x.getReviewId().equals(reviewId)).findFirst().orElseThrow();
        a.setApprovedVersion(2);
        a.setApprovedFingerprint("fp-2");
        approvals.saveAndFlush(a);

        assertThat(standing())
                .as("excluding by review id alone would have retired this reply for good")
                .containsExactly(reviewId);
    }

    @Test
    @DisplayName("a withdrawn approval is still not waiting to be sent")
    void withdrawnStaysOut() {
        UUID reviewId = approve(1);
        ReviewReplyApproval a = approvals.findAll().stream()
                .filter(x -> x.getReviewId().equals(reviewId)).findFirst().orElseThrow();
        // `chk_review_reply_approval_binding` requires a withdrawn row to be unbound — which is the enum's own
        // sentence («the draft is editable again and nothing is bound») enforced by the database.
        a.setState(ReviewReplyApprovalState.WITHDRAWN);
        a.setApprovedVersion(null);
        a.setApprovedFingerprint(null);
        approvals.saveAndFlush(a);

        assertThat(standing()).isEmpty();
        assertThat(approvals.countStandingByOrgId(org)).isZero();
    }

    @Test
    @DisplayName("another organisation's outcome cannot retire this one's approval")
    void scopedToTheOrganisation() {
        UUID reviewId = approve(1);

        ReviewReplyOutcome o = new ReviewReplyOutcome();
        o.setOrgId(UUID.randomUUID());
        o.setReviewId(reviewId);
        o.setSubmissionRef("refother");
        o.setRecordedVersion(1);
        o.setRecordedFingerprint("fp-1");
        o.setFingerprintAlgorithm("review-reply-v1");
        o.setOperatorOutcome(OperatorOutcome.OPERATOR_REPORTED_SUBMITTED);
        o.setVerification(VerificationState.UNVERIFIED);
        o.setCommandId(UUID.randomUUID().toString());
        o.setRecordedBy("SELLER:other");
        outcomes.save(o);

        assertThat(standing()).containsExactly(reviewId);
    }
}
