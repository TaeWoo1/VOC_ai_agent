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
 * One appended record of the operator setting a review ASIDE from their 내 답변 작업 to-do list —
 * "작업에서 제외". Written once, never updated.
 *
 * <p><b>It claims nothing about the reply.</b> A dismissal is the operator's own decision to stop
 * treating this review as active reply work; it is NOT a reported outcome, carries no verification,
 * and implies no completion. It deletes and mutates no draft — the draft and its version history
 * survive untouched, so the work can be resumed.
 *
 * <p><b>Removes it from the to-do ONLY, and only until superseded.</b> The reply-work read includes an
 * otherwise-eligible review again once (a) an explicit {@link ReviewReplyWorkRestore} outranks this
 * by {@link #seq}, or (b) its latest {@code RESPONSE_NEEDED} triage decision OR latest saved draft
 * version is newer than its latest dismissal. Re-entry through (b) stays automatic and read-time; (a)
 * is the explicit 복원 path added alongside the restore log.
 *
 * <p><b>{@code seq} is the shared reply-work event position.</b> Dismissal and restore both draw from
 * one globally-monotonic sequence, so "which explicit action is latest" is a total order rather than a
 * wall-clock comparison — two events in the same clock tick still order deterministically.
 *
 * <p><b>Append-only IS the history</b> — like {@link ReviewReplyOutcome} / {@link ReviewReplyDraft},
 * so it does NOT extend {@code BaseEntity} (no {@code updated_at}) and needs no separate audit table.
 * {@code (org_id, command_id)} is UNIQUE (V25) — org-scoped idempotency, so a repeated dismissal is a
 * no-op rather than a second row. {@code length} on every string column is pinned because tests
 * generate the schema from these annotations while production runs V25.
 *
 * <p>Carries no reply body, no customer identity, no order/product/channel-side id — only SellerOps'
 * own {@code review_id} and the operator's opaque actor label.
 */
@Getter
@Setter
@Entity
@Table(name = "review_reply_work_dismissal",
        uniqueConstraints = @UniqueConstraint(name = "uq_review_reply_work_dismissal_org_command",
                columnNames = {"org_id", "command_id"}))
public class ReviewReplyWorkDismissal {

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

    @Column(name = "dismissed_by", nullable = false, length = 120)
    private String dismissedBy;

    @Column(name = "dismissed_at", nullable = false)
    private Instant dismissedAt;

    /**
     * Position in the shared reply-work event sequence — assigned by the service from
     * {@code reply_work_event_seq}, never here, so it is globally monotonic across dismissal AND
     * restore. The read compares MAX(seq) across both tables to find the latest explicit action.
     */
    @Column(name = "seq", nullable = false)
    private Long seq;

    @PrePersist
    void onPersist() {
        if (dismissedAt == null) {
            dismissedAt = Instant.now();
        }
    }
}
