package com.sellerops.attention.reply;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
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
 * An opaque, single-use token binding a guided Action Window run to one approved reply.
 *
 * <p><b>Why it exists.</b> The Action Window contract carries no review identity and no reply text —
 * both are prohibited on the wire. The backend mints this ref against the current approved head; the
 * FE passes only the ref into {@code START_RUN}, and resolves it to the approved body it already
 * holds. Nothing identifying and nothing readable crosses the boundary.
 *
 * <p><b>Bound, not authoritative.</b> The ref records which (version, fingerprint) was approved at
 * mint time. Recording an outcome re-checks that the approval still stands at that version before
 * spending the ref, so a withdrawal between mint and record is caught rather than posted against.
 *
 * <p><b>Single-use is enforced downstream, not here.</b> This row is minted freely (each is a fresh
 * potential run); {@code review_reply_outcome}'s UNIQUE on {@code submission_ref} is what makes
 * exactly one outcome per ref — a retry after a reported submission mints a new ref, never re-drives
 * an old one.
 *
 * <p><b>Append-only, so it does NOT extend {@code BaseEntity}</b> and carries no {@code updated_at}
 * — same shape and same reason as {@link ReviewReplyDraft}. {@code length} on the ref and fingerprint
 * is pinned because tests generate the schema from these annotations while production runs V20. No
 * {@code seller_account_id} / {@code channel_id}, per V19/V20 reasoning.
 */
@Getter
@Setter
@Entity
@Table(name = "review_reply_submission_ref",
        uniqueConstraints = @UniqueConstraint(
                name = "uq_review_reply_submission_ref_ref",
                columnNames = {"submission_ref"}))
@Check(name = "chk_review_reply_submission_ref_version", constraints = "bound_version > 0")
public class ReviewReplySubmissionRef {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(updatable = false, nullable = false)
    private UUID id;

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "review_id", nullable = false)
    private UUID reviewId;

    /** Opaque 16-hex token; UNIQUE. Never a review id or any reversible value. */
    @Column(name = "submission_ref", nullable = false, length = 16)
    private String submissionRef;

    /** The approved draft version this ref was minted against. */
    @Column(name = "bound_version", nullable = false)
    private Integer boundVersion;

    /** The approved version's content fingerprint at mint time. */
    @Column(name = "bound_fingerprint", nullable = false, length = 64)
    private String boundFingerprint;

    /** Actor tag of whoever minted it (e.g. {@code SELLER:<userId>}) — no PII. */
    @Column(name = "created_by", nullable = false, length = 120)
    private String createdBy;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @PrePersist
    void onCreate() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }
}
