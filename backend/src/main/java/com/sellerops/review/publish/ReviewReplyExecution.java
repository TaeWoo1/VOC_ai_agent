package com.sellerops.review.publish;

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
 * One appended record of what reviewnary DID with an approved review reply, and what it could
 * CONFIRM — V84. Never updated; the latest row for a review's approved version is where things stand.
 *
 * <p>Two lanes share the table ({@link ReviewExecutionLane}). {@code review_reply_outcome} (V20) is
 * untouched beside it and keeps recording the OPERATOR's report, which can only ever be UNVERIFIED;
 * this table records reviewnary's own action or observation, with the closed vocabulary V84 checks.
 *
 * <p>Carries no reply body (the approved fingerprint identifies it), no customer, no page content.
 * {@code providerRef} is the channel's own handle for what was created — a comment number.
 */
@Getter
@Setter
@Entity
@Table(name = "review_reply_execution",
        uniqueConstraints = @UniqueConstraint(name = "uq_review_reply_execution_org_command",
                columnNames = {"org_id", "command_id"}))
@Check(name = "chk_review_reply_execution_version", constraints = "approved_version > 0")
public class ReviewReplyExecution {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(updatable = false, nullable = false)
    private UUID id;

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "review_id", nullable = false)
    private UUID reviewId;

    @Column(name = "seller_account_id", nullable = false)
    private UUID sellerAccountId;

    @Column(name = "channel_code", nullable = false, length = 32)
    private String channelCode;

    @Enumerated(EnumType.STRING)
    @Column(name = "lane", nullable = false, length = 16)
    private ReviewExecutionLane lane;

    @Column(name = "approved_version", nullable = false)
    private Integer approvedVersion;

    @Column(name = "approved_fingerprint", nullable = false, length = 64)
    private String approvedFingerprint;

    /** The client's idempotency key, unique per org. */
    @Column(name = "command_id", nullable = false, length = 120)
    private String commandId;

    /** Guided lane only: the single-use binding the Action Window run carried. */
    @Column(name = "submission_ref", length = 16)
    private String submissionRef;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 40)
    private ReviewExecutionStatus status;

    @Column(name = "provider_ref", length = 64)
    private String providerRef;

    @Enumerated(EnumType.STRING)
    @Column(name = "reason", length = 48)
    private ReviewExecutionReason reason;

    @Enumerated(EnumType.STRING)
    @Column(name = "verification", length = 48)
    private ReviewExecutionVerification verification;

    /** When the verification was observed (a read-back, a collector report), or null. */
    @Column(name = "observed_at")
    private Instant observedAt;

    /** Actor tag ({@code SELLER:<userId>} / {@code AGENT:<userId>} / {@code SYSTEM}) — no PII. */
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
