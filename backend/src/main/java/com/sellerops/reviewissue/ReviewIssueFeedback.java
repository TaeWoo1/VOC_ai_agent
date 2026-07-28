package com.sellerops.reviewissue;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * One appended record of the operator's judgement about a repeated-issue CANDIDATE — 유용함 /
 * 관련 없음 / 나중에 보기. Written once, never updated.
 *
 * <p><b>Offline evaluation data only.</b> It changes no lifecycle state, no queue membership, and no
 * judgement; it asserts nothing about the customer. It exists so a later eval session can find out
 * whether the DRAFT/UNMEASURED detector surfaces the right issues — the issue-side analogue of the
 * {@code review-eval} label seed.
 *
 * <p><b>Append-only IS the history</b> — like {@link ReviewIssueStateEvent} and
 * {@code ReviewReplyOutcome} — so it does NOT extend {@code BaseEntity} (no {@code updated_at}) and
 * needs no separate audit table. {@code (org_id, command_id)} is UNIQUE (V32) — org-scoped
 * idempotency, so a repeated feedback is a no-op replay rather than a second row. {@code length} on
 * every string column is pinned because tests generate the schema from these annotations while
 * production runs V32.
 *
 * <p>Carries no review id, no customer text, no body — only which issue, which feedback, the
 * operator's opaque actor label, and the client's idempotency key.
 */
@Getter
@Setter
@Entity
@Table(name = "review_issue_feedback",
        uniqueConstraints = @UniqueConstraint(name = "uq_review_issue_feedback_org_command",
                columnNames = {"org_id", "command_id"}))
public class ReviewIssueFeedback {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(updatable = false, nullable = false)
    private UUID id;

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "issue_id", nullable = false)
    private UUID issueId;

    @Enumerated(EnumType.STRING)
    @Column(name = "kind", nullable = false, length = 24)
    private ReviewIssueFeedbackKind kind;

    @Column(name = "command_id", nullable = false, length = 120)
    private String commandId;

    @Column(name = "created_by", nullable = false, length = 120)
    private String createdBy;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;
}
