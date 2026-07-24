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

/**
 * One appended record of the operator bringing a review they had set aside BACK onto their
 * 내 답변 작업 to-do — "복원". Written once, never updated. The mirror of {@link ReviewReplyWorkDismissal}.
 *
 * <p><b>It claims nothing about the reply.</b> A restore reverses a set-aside and nothing else: it
 * deletes and mutates no draft, records no outcome, touches no triage disposition, and implies no
 * completion. It does not delete the dismissal it supersedes — the dismissal row stays as history;
 * this row simply outranks it.
 *
 * <p><b>Re-enters the to-do by {@link #seq}, not by timestamp.</b> Dismissal and restore share one
 * globally-monotonic sequence ({@code reply_work_event_seq}, assigned by the service). A review is
 * active when its newest explicit event — the greatest seq across the two tables — is a restore. That
 * total order decides same-clock-tick cases deterministically, which a wall-clock comparison cannot.
 * The AUTOMATIC re-entry triggers (a genuinely newer {@code RESPONSE_NEEDED} decision or draft
 * revision) are unchanged and independent of this row.
 *
 * <p><b>Append-only IS the history</b> — like {@link ReviewReplyWorkDismissal} / {@link
 * ReviewReplyOutcome}, so it does NOT extend {@code BaseEntity} (no {@code updated_at}) and needs no
 * audit table. {@code (org_id, command_id)} is UNIQUE (V26) — org-scoped idempotency, so a repeated
 * restore is a no-op rather than a second row. Every string column's {@code length} is pinned because
 * tests generate the schema from these annotations while production runs V26.
 *
 * <p>Carries no reply body, no customer identity, no order/product/channel-side id — only SellerOps'
 * own {@code review_id} and the operator's opaque actor label.
 */
@Getter
@Setter
@Entity
@Table(name = "review_reply_work_restore",
        uniqueConstraints = @UniqueConstraint(name = "uq_review_reply_work_restore_org_command",
                columnNames = {"org_id", "command_id"}))
public class ReviewReplyWorkRestore {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(updatable = false, nullable = false)
    private UUID id;

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "review_id", nullable = false)
    private UUID reviewId;

    @Column(name = "command_id", nullable = false, length = 120)
    private String commandId;

    @Column(name = "restored_by", nullable = false, length = 120)
    private String restoredBy;

    @Column(name = "restored_at", nullable = false)
    private Instant restoredAt;

    /**
     * Position in the shared reply-work event sequence — assigned by the service from
     * {@code reply_work_event_seq}, never here, so it is globally monotonic across restore AND
     * dismissal.
     */
    @Column(name = "seq", nullable = false)
    private Long seq;

    @PrePersist
    void onPersist() {
        if (restoredAt == null) {
            restoredAt = Instant.now();
        }
    }
}
