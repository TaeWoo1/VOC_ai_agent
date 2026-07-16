package com.sellerops.attention.triage;

import java.time.Instant;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Writes one triage decision as an atomic unit: upsert the {@link ReviewTriage} current
 * state and append its {@link ReviewTriageAudit} row, in a single transaction. If either
 * fails the whole unit rolls back, so a decision can never exist without its evidence, nor
 * evidence without the decision it describes.
 *
 * <p><b>Why an explicit {@link TransactionTemplate} and not {@code @Transactional} on the
 * service.</b> This is not a style preference — it is the only arrangement in which the
 * caller can recover from a lost race, and getting it wrong is silent:
 *
 * <ul>
 *   <li>{@code BaseEntity} generates ids with {@code GenerationType.UUID}, an in-memory
 *       generator, so {@code save()} emits no SQL — it only queues the INSERT. Nothing
 *       flushes until commit.
 *   <li>Under a {@code @Transactional} service method, that commit happens in the
 *       transaction proxy, AFTER the method returns. A {@code try/catch} inside the method
 *       is therefore dead code: the {@code DataIntegrityViolationException} is thrown past
 *       it, and the caller sees a 500.
 *   <li>Forcing the issue with {@code saveAndFlush} does not help either. A failed flush
 *       marks the transaction rollback-only and leaves the Hibernate session in an
 *       indeterminate state, so a re-read inside the catch runs on a poisoned context and
 *       the proxy's commit then throws {@code UnexpectedRollbackException} — still a 500.
 * </ul>
 *
 * <p>{@code tx.execute(...)} commits before it returns, so the violation surfaces HERE, at
 * a boundary whose failed transaction has already ended. {@code ReviewTriageService} can
 * then re-read cleanly and resolve the race. Same arrangement as
 * {@code InquiryProposalWriter} / {@code InquiryPublishBindingWriter}, and the same reason
 * {@code InquiryReplyDraftService} carries no {@code @Transactional} at all. It also keeps
 * the atomic guarantee whether the bean is Spring-wired or hand-constructed in a test.
 *
 * <p><b>{@code REQUIRES_NEW}, so that is unconditional.</b> The sibling writers leave
 * propagation at {@code REQUIRED}, which is correct for them and would be a trap here: under
 * {@code REQUIRED} this template joins any caller's transaction instead of owning one, the
 * commit moves back out to that caller's boundary, and the catch in
 * {@code ReviewTriageService.resolveRace} silently becomes dead code again — the endpoint
 * reverts to answering a concurrent replay with a 500, with every test still green. That is
 * one {@code @Transactional} on {@code decide} or on the controller away, and nothing would
 * fail to warn you. {@code REQUIRES_NEW} makes the boundary this class's own property rather
 * than a fact about its callers, so the recovery contract cannot be broken from a distance.
 *
 * <p><b>What that costs, stated accurately.</b> Under an enclosing transaction this suspends
 * it and holds a SECOND connection — and not briefly. The first statement below is a
 * {@code SELECT … FOR UPDATE}: it is I/O, and it is designed to BLOCK, for as long as another
 * caller holds the row (Postgres {@code lock_timeout} defaults to 0 — forever). Today no
 * caller has an enclosing transaction ({@code decide} and
 * {@code OperatorReviewTriageController} both carry none), so each request holds one
 * connection and the cost is theoretical. It stops being theoretical the moment anyone wraps
 * a caller, so the consequences are named here rather than left to be discovered:
 *
 * <ul>
 *   <li><b>Two connections per call.</b> Against the default pool of 10, ten concurrent
 *       wrapped callers each holding an outer connection while waiting for a writer
 *       connection is a pool deadlock, broken only by Hikari's 30s timeout.
 *   <li><b>A self-deadlock the database cannot detect.</b> If the enclosing transaction has
 *       already locked this review's row, the read below waits on a lock held by a
 *       transaction that cannot commit until this method returns. Postgres's deadlock
 *       detector will not see it: the outer transaction is not waiting on a lock, it is
 *       waiting on a Java stack frame.
 *   <li><b>The caller's uncommitted rows are invisible here.</b> A separate transaction
 *       cannot read them. An ingest-then-triage flow inside one transaction would hit V18's
 *       {@code review_triage.review_id} FK, match neither constraint in
 *       {@code ReviewTriageService.resolveRace}, and surface as a 500 rather than as
 *       anything diagnosable.
 * </ul>
 *
 * <p>The tradeoff it accepts, deliberately: a decision committed here is NOT rolled back if
 * an enclosing transaction later fails. That is the right semantic — a triage decision is
 * its own unit of work, recorded because a human made it, not a step in someone else's
 * transaction.
 *
 * <p><b>{@code READ_COMMITTED}, pinned.</b> The recovery depends on it. Under REPEATABLE
 * READ or SERIALIZABLE the locking read below raises a serialization failure
 * ({@code 40001}) instead of blocking, which Spring maps to
 * {@code CannotSerializeTransactionException} — a {@code ConcurrencyFailureException}, NOT a
 * {@code DataIntegrityViolationException} — so it would sail straight past
 * {@code resolveRace}'s catch and out as a 500. Postgres defaults to READ_COMMITTED today;
 * this makes the code say so rather than depend on it.
 */
@Component
public class ReviewTriageWriter {

    private final ReviewTriageRepository triages;
    private final ReviewTriageAuditRepository audits;
    private final TransactionTemplate tx;

    public ReviewTriageWriter(ReviewTriageRepository triages, ReviewTriageAuditRepository audits,
                              PlatformTransactionManager transactionManager) {
        this.triages = triages;
        this.audits = audits;
        this.tx = new TransactionTemplate(transactionManager);
        // Both settings are the contract, not tuning — see the class note. Stated
        // explicitly rather than inherited: PROPAGATION_REQUIRED (the default) would make
        // "commits before it returns" true only while no caller happens to hold a
        // transaction, and ISOLATION_DEFAULT would make the recovery correct only while the
        // database happens to default to READ_COMMITTED. Neither is a property this class
        // can assert about its callers or its deployment, so neither is left to them.
        this.tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.tx.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
    }

    /**
     * Atomically set {@code target} as the review's current decision and append the audit
     * row recording the transition into it.
     *
     * <p><b>The row lock is what makes the trail truthful.</b> The read below takes
     * {@code PESSIMISTIC_WRITE}, so a concurrent decision on the same review blocks here
     * rather than reading a value that is about to be stale. Without it, two callers both
     * read {@code from = X} and both append "from X" — producing two rows claiming the same
     * predecessor, which is an impossible history for a single-valued column, and losing the
     * intermediate state entirely. No unique constraint can catch that (the command ids
     * differ, so nothing collides), which is why this needs a lock rather than a
     * catch-and-retry.
     *
     * <p>The lock only serializes callers once the row EXISTS — there is nothing to lock on
     * a first decision, so two concurrent first decisions instead collide on
     * {@code uq_review_triage_review} and the caller resolves that as a retry. The two
     * mechanisms cover the two cases between them.
     *
     * @throws org.springframework.dao.DataIntegrityViolationException when a concurrent
     *         caller won a UNIQUE race — on {@code (org_id, command_id)} (this exact command
     *         already landed) or on {@code review_id} (a different command created the row
     *         first). The caller distinguishes them by re-reading; see
     *         {@code ReviewTriageService.resolveRace}.
     */
    public void applyDecision(UUID orgId, UUID reviewId, UUID channelId, TriageDisposition target,
                              String commandId, String actor) {
        tx.executeWithoutResult(status -> {
            ReviewTriage triage = triages.lockByOrgIdAndReviewId(orgId, reviewId).orElse(null);
            // Read under the lock, so it is the real predecessor and not a stale one.
            TriageDisposition from = triage == null ? null : triage.getDisposition();
            if (triage == null) {
                triage = new ReviewTriage();
                triage.setOrgId(orgId);
                triage.setReviewId(reviewId);
                triage.setChannelId(channelId);
            }
            triage.setDisposition(target);
            triage.setDecidedBy(actor);
            triage.setDecidedAt(Instant.now());
            ReviewTriage saved = triages.save(triage);

            ReviewTriageAudit audit = new ReviewTriageAudit();
            audit.setOrgId(orgId);
            audit.setReviewTriageId(saved.getId());
            audit.setCommandId(commandId);
            audit.setDispositionFrom(from);
            audit.setDispositionTo(target);
            audit.setActor(actor);
            audits.save(audit);
        });
    }
}
