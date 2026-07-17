package com.sellerops.attention.reply;

import java.time.Instant;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Writes one approval transition as an atomic unit: upsert the {@link ReviewReplyApproval}
 * current state and append its {@link ReviewReplyApprovalAudit} row, in a single transaction.
 * If either fails the whole unit rolls back, so an approval can never exist without its
 * evidence, nor evidence without the approval it describes.
 *
 * <p>This class is a deliberate mirror of {@code ReviewTriageWriter}. Its notes are not
 * repeated here in full, but the two constraints below are restated because getting either
 * wrong is silent — the tests stay green and the endpoint starts answering 500 under
 * concurrency:
 *
 * <ul>
 *   <li><b>An explicit {@link TransactionTemplate}, never {@code @Transactional} on the
 *       service.</b> {@code tx.execute} commits before it returns, so a UNIQUE violation
 *       surfaces at a boundary whose failed transaction has already ended and
 *       {@code ReviewReplyApprovalService.resolveRace} can re-read cleanly. Under a
 *       {@code @Transactional} service method the commit happens in the proxy AFTER the method
 *       returns, and that catch becomes dead code.
 *   <li><b>{@code REQUIRES_NEW} and {@code READ_COMMITTED}, pinned.</b> Under the default
 *       {@code REQUIRED} this template would join a caller's transaction instead of owning
 *       one, moving the commit back out to their boundary and making the recovery dead code
 *       again — one {@code @Transactional} on a caller away, with nothing failing to warn you.
 *       Under REPEATABLE READ or SERIALIZABLE the locking read raises a serialization failure
 *       ({@code 40001}) instead of blocking, which Spring maps to
 *       {@code CannotSerializeTransactionException} — NOT a
 *       {@code DataIntegrityViolationException} — so it would sail past the catch as a 500.
 * </ul>
 *
 * <p>The same costs {@code ReviewTriageWriter} enumerates apply here (two connections under an
 * enclosing transaction, an undetectable self-deadlock, invisibility of the caller's
 * uncommitted rows) and for the same reason are theoretical today: no caller has an enclosing
 * transaction. The tradeoff is the same and is right for the same reason — an approval is its
 * own unit of work, recorded because a human made it.
 */
@Component
public class ReviewReplyApprovalWriter {

    private final ReviewReplyApprovalRepository approvals;
    private final ReviewReplyApprovalAuditRepository audits;
    private final TransactionTemplate tx;

    public ReviewReplyApprovalWriter(ReviewReplyApprovalRepository approvals,
                                     ReviewReplyApprovalAuditRepository audits,
                                     PlatformTransactionManager transactionManager) {
        this.approvals = approvals;
        this.audits = audits;
        this.tx = new TransactionTemplate(transactionManager);
        // Both settings are the contract, not tuning — see the class note.
        this.tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.tx.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
    }

    /**
     * Atomically set {@code target} as the review's current approval state and append the
     * audit row recording the transition into it.
     *
     * <p>{@code approvedVersion}/{@code approvedFingerprint} must be non-null for
     * {@link ReviewReplyApprovalState#APPROVED} and null for
     * {@link ReviewReplyApprovalState#WITHDRAWN} — V19's {@code chk_review_reply_approval_binding}
     * enforces it, and the caller is responsible for not asking for the impossible.
     *
     * <p><b>The row lock is what makes the trail truthful.</b> The read below takes
     * {@code PESSIMISTIC_WRITE}, so a concurrent decision on the same review blocks here rather
     * than reading a value that is about to be stale. Without it two callers both read
     * {@code from = X} and both append "from X" — two rows claiming one predecessor, which no
     * unique constraint can catch because their command ids differ.
     *
     * <p>The lock only serializes callers once the row EXISTS — there is nothing to lock on a
     * first approval, so two concurrent first approvals instead collide on
     * {@code uq_review_reply_approval_review} and the caller resolves that as a retry. The two
     * mechanisms cover the two cases between them.
     *
     * @throws org.springframework.dao.DataIntegrityViolationException when a concurrent caller
     *         won a UNIQUE race — on {@code (org_id, command_id)} (this exact command already
     *         landed) or on {@code review_id} (a different command created the row first). The
     *         caller distinguishes them by re-reading; see
     *         {@code ReviewReplyApprovalService.resolveRace}.
     */
    public void applyApproval(UUID orgId, UUID reviewId, ReviewReplyApprovalState target,
                              Integer approvedVersion, String approvedFingerprint,
                              String commandId, String actor) {
        tx.executeWithoutResult(status -> {
            ReviewReplyApproval approval = approvals.lockByOrgIdAndReviewId(orgId, reviewId)
                    .orElse(null);
            // Read under the lock, so it is the real predecessor and not a stale one.
            ReviewReplyApprovalState from = approval == null ? null : approval.getState();
            if (approval == null) {
                approval = new ReviewReplyApproval();
                approval.setOrgId(orgId);
                approval.setReviewId(reviewId);
            }
            approval.setState(target);
            approval.setApprovedVersion(approvedVersion);
            approval.setApprovedFingerprint(approvedFingerprint);
            approval.setDecidedBy(actor);
            approval.setDecidedAt(Instant.now());
            ReviewReplyApproval saved = approvals.save(approval);

            ReviewReplyApprovalAudit audit = new ReviewReplyApprovalAudit();
            audit.setOrgId(orgId);
            audit.setReviewReplyApprovalId(saved.getId());
            audit.setCommandId(commandId);
            audit.setStateFrom(from);
            audit.setStateTo(target);
            audit.setApprovedVersion(approvedVersion);
            audit.setApprovedFingerprint(approvedFingerprint);
            audit.setActor(actor);
            audits.save(audit);
        });
    }
}
