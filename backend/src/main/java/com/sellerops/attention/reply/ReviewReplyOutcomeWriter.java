package com.sellerops.attention.reply;

import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Appends one operator-reported outcome as an atomic unit.
 *
 * <p>Deliberately simpler than {@link ReviewReplyApprovalWriter}: an outcome is an append, not a
 * current-row mutation, so there is <b>no pessimistic lock</b>. Nothing here reads-then-writes a
 * shared row whose predecessor must be pinned — the two UNIQUE constraints on
 * {@code review_reply_outcome} do all the serialization: a duplicate command collides on
 * {@code (org_id, command_id)}, and a second outcome for the same binding collides on
 * {@code submission_ref} (the single-use / anti-double-post guard). The caller distinguishes the two
 * by re-reading; see {@link ReviewReplyOutcomeService#resolveRace}.
 *
 * <p>The transaction contract is the SAME as the approval writer, and for the same reasons, which are
 * not repeated in full here:
 * <ul>
 *   <li><b>An explicit {@link TransactionTemplate}, never {@code @Transactional} on the service.</b>
 *       {@code tx.execute} commits before it returns, so a UNIQUE violation surfaces where
 *       {@link ReviewReplyOutcomeService} can catch it and re-read cleanly. Under a
 *       {@code @Transactional} service the commit would move out to the proxy boundary and the catch
 *       would be dead code.
 *   <li><b>{@code REQUIRES_NEW} and {@code READ_COMMITTED}, pinned.</b> {@code REQUIRED} would join a
 *       caller's transaction and move the commit out again; a higher isolation would raise a
 *       serialization failure that is not a {@code DataIntegrityViolationException} and would sail
 *       past the catch as a 500.
 * </ul>
 */
@Component
public class ReviewReplyOutcomeWriter {

    private final ReviewReplyOutcomeRepository outcomes;
    private final TransactionTemplate tx;

    public ReviewReplyOutcomeWriter(ReviewReplyOutcomeRepository outcomes,
                                    PlatformTransactionManager transactionManager) {
        this.outcomes = outcomes;
        this.tx = new TransactionTemplate(transactionManager);
        // Both settings are the contract, not tuning — see the class note.
        this.tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.tx.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
    }

    /**
     * Append one outcome row.
     *
     * @throws org.springframework.dao.DataIntegrityViolationException when a concurrent caller won a
     *         UNIQUE race — on {@code (org_id, command_id)} (this exact command already landed) or on
     *         {@code submission_ref} (this binding was already spent by a different command).
     */
    public void appendOutcome(UUID orgId, UUID reviewId, String submissionRef, Integer recordedVersion,
                              String recordedFingerprint, String fingerprintAlgorithm,
                              OperatorOutcome operatorOutcome, String awRunRef, String commandId,
                              String actor) {
        tx.executeWithoutResult(status -> {
            ReviewReplyOutcome outcome = new ReviewReplyOutcome();
            outcome.setOrgId(orgId);
            outcome.setReviewId(reviewId);
            outcome.setSubmissionRef(submissionRef);
            outcome.setRecordedVersion(recordedVersion);
            outcome.setRecordedFingerprint(recordedFingerprint);
            outcome.setFingerprintAlgorithm(fingerprintAlgorithm);
            outcome.setOperatorOutcome(operatorOutcome);
            // Always UNVERIFIED — SellerOps never verifies a reply post, and this is the write path
            // that makes that a stored fact rather than a convention.
            outcome.setVerification(VerificationState.UNVERIFIED);
            outcome.setAwRunRef(awRunRef);
            outcome.setCommandId(commandId);
            outcome.setRecordedBy(actor);
            outcomes.save(outcome);
        });
    }
}
