package com.sellerops.attention.reply;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.Check;

/**
 * One appended record of the operator's report about their own manual reply post — written once,
 * never updated. It is a fact about what the OPERATOR did, never a claim about NAVER.
 *
 * <p><b>Outcome and verification are two separate fields.</b> {@link #operatorOutcome} is what the
 * operator reported ({@code OPERATOR_REPORTED_SUBMITTED} or {@code SUBMISSION_ABORTED} — an abort is
 * a deliberate, benign end, not a fault). {@link #verification} is what SellerOps confirmed — only
 * {@link VerificationState#UNVERIFIED} is reachable, because a reply post has no read-back oracle.
 * There is deliberately no {@code COMPLETED} value in either enum; the surface always shows the pair,
 * never {@code UNVERIFIED} alone.
 *
 * <p><b>Append-only IS the history</b> — like {@link ReviewReplyDraft}, so it does NOT extend
 * {@code BaseEntity} (no {@code updated_at}) and needs no separate audit table.
 *
 * <p><b>Single-use binding.</b> {@link #submissionRef} is UNIQUE here (V20), so exactly one outcome
 * can be recorded per binding. A retry after a reported submission mints a FRESH ref (re-confirming
 * the approved head) rather than re-driving the old one — the anti-double-post control, since a reply
 * POST is not idempotent. Multiple outcomes per review head are legitimate across retries (abort →
 * re-mint → submit), each through its own ref, so there is no (review, version, fingerprint) unique.
 *
 * <p><b>{@code (org_id, command_id)} is UNIQUE</b> — org-scoped idempotency, following V18/V19: the
 * service's replay lookup is only a fast path, and this constraint is where concurrent idempotency
 * comes from. {@code length} on every string column is pinned because tests generate the schema from
 * these annotations while production runs V20.
 *
 * <p>Carries no reply body, no customer identity, no order/product/channel-side id. {@link #awRunRef}
 * is the opaque Action Window runId the guided post ran under — never an account id or page content.
 */
@Getter
@Setter
@Entity
@Table(name = "review_reply_outcome",
        uniqueConstraints = {
                @UniqueConstraint(name = "uq_review_reply_outcome_submission_ref",
                        columnNames = {"submission_ref"}),
                @UniqueConstraint(name = "uq_review_reply_outcome_org_command",
                        columnNames = {"org_id", "command_id"})})
@Check(name = "chk_review_reply_outcome_version", constraints = "recorded_version > 0")
// Mirror V20's value checks so the entity and the migration diff line-for-line, and so the two-value
// operator-outcome bound and the single-value verification bound are enforced under test (which builds
// the schema from these annotations) and not only in production (which runs V20).
@Check(name = "chk_review_reply_outcome_operator_outcome",
        constraints = "operator_outcome in ('OPERATOR_REPORTED_SUBMITTED', 'SUBMISSION_ABORTED')")
@Check(name = "chk_review_reply_outcome_verification",
        constraints = "verification in ('UNVERIFIED')")
public class ReviewReplyOutcome {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(updatable = false, nullable = false)
    private UUID id;

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "review_id", nullable = false)
    private UUID reviewId;

    /** The single-use binding this outcome consumes; UNIQUE. */
    @Column(name = "submission_ref", nullable = false, length = 16)
    private String submissionRef;

    /** The approved version the operator reported posting; server-sourced from the binding. */
    @Column(name = "recorded_version", nullable = false)
    private Integer recordedVersion;

    /** That version's fingerprint; server-sourced from the binding. */
    @Column(name = "recorded_fingerprint", nullable = false, length = 64)
    private String recordedFingerprint;

    @Column(name = "fingerprint_algorithm", nullable = false, length = 40)
    private String fingerprintAlgorithm;

    /** What the operator reported. Separate from {@link #verification}. */
    @Enumerated(EnumType.STRING)
    @Column(name = "operator_outcome", nullable = false, length = 40)
    private OperatorOutcome operatorOutcome;

    /** What SellerOps confirmed — always {@code UNVERIFIED}. Separate from {@link #operatorOutcome}. */
    @Enumerated(EnumType.STRING)
    @Column(name = "verification", nullable = false, length = 24)
    private VerificationState verification;

    /**
     * Opaque Action Window runId a guided post ran under, or {@code null} when the operator posted
     * MANUALLY with no guided run — no account id, no page content either way.
     *
     * <p>Nullable since V24, and the null is a FACT rather than a gap. Before it, the column was
     * {@code not null}, so a client with no runtime had to supply something; every shipped build used
     * the simulated runtime and stored a locally-minted {@code run_<hex>} for a run that never
     * happened. Production may not mint a run identity for a run that did not occur.
     */
    @Column(name = "aw_run_ref", length = 128)
    private String awRunRef;

    /** The client's idempotency key. */
    @Column(name = "command_id", nullable = false, length = 120)
    private String commandId;

    /** Actor tag (e.g. {@code SELLER:<userId>}) — no PII. */
    @Column(name = "recorded_by", nullable = false, length = 120)
    private String recordedBy;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @PrePersist
    void onCreate() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }
}
