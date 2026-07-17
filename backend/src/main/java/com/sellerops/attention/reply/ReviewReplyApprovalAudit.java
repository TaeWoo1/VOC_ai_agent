package com.sellerops.attention.reply;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * One appended record of an approval transition — written once, never updated, so "this was
 * approved at v2, withdrawn, then re-approved at v5" stays answerable after the current row
 * has moved on.
 *
 * <p>{@link #stateFrom} is null on a review's first approval decision (cf.
 * {@code ReviewTriageAudit.dispositionFrom}, {@code inquiry_work_item_audit.phase_from}).
 *
 * <p><b>Append-only is necessary but not sufficient for a truthful trail</b>, and the gap is
 * worth naming because nothing here closes it: the chain only composes if {@link #stateFrom}
 * is the REAL predecessor. Two concurrent decisions would otherwise both read the current
 * state and both record leaving it — two rows, one predecessor, an impossible history — and no
 * constraint on this table can catch it, because their command ids differ and nothing
 * collides. {@link ReviewReplyApprovalWriter} takes a {@code PESSIMISTIC_WRITE} lock on the
 * approval row so the chain composes. The schema cannot express that rule; the writer owns it.
 *
 * <p><b>{@code (org_id, command_id)} is UNIQUE</b> — org-scoped, following
 * {@code review_triage_audit} and {@code inquiry_work_item_dismissal_batch}, NOT V9's narrower
 * {@code (work_item_id, command_id)}. The command id is client-generated and arrives alongside
 * the ref, so the row it targets is part of what a replay must match: under the narrower key a
 * client reusing one id across two reviews would have both writes accepted as unrelated, each
 * unique within its own approval row, and the reuse would be invisible. It is also where
 * concurrent idempotency actually comes from — the service's replay lookup is only a fast path,
 * and two simultaneous identical calls can both pass it — with the loser re-reading and
 * resolving to the winner's outcome rather than failing.
 *
 * <p>{@link #approvedVersion} / {@link #approvedFingerprint} record what THIS transition bound
 * (both null for a withdrawal, which binds nothing). Unlike the current row's copies these are
 * never cleared: the point of a trail is that it still says what was true at the time.
 */
@Getter
@Setter
@Entity
@Table(name = "review_reply_approval_audit",
        uniqueConstraints = @UniqueConstraint(
                name = "uq_review_reply_approval_audit_org_command",
                columnNames = {"org_id", "command_id"}))
public class ReviewReplyApprovalAudit extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "review_reply_approval_id", nullable = false)
    private UUID reviewReplyApprovalId;

    /**
     * The client's idempotency key. {@code length} is pinned because tests generate the schema
     * from these annotations while production runs V19 — an unpinned column would build a
     * {@code varchar(255)} under test and a {@code varchar(120)} in production, and an
     * over-long id would pass every test and fail in production as a 500.
     */
    @Column(name = "command_id", nullable = false, length = 120)
    private String commandId;

    /** Null on the review's first approval decision. */
    @Enumerated(EnumType.STRING)
    @Column(name = "state_from", length = 32)
    private ReviewReplyApprovalState stateFrom;

    @Enumerated(EnumType.STRING)
    @Column(name = "state_to", nullable = false, length = 32)
    private ReviewReplyApprovalState stateTo;

    /** What this transition bound; null for a withdrawal. Never cleared afterwards. */
    @Column(name = "approved_version")
    private Integer approvedVersion;

    @Column(name = "approved_fingerprint", length = 64)
    private String approvedFingerprint;

    /** Actor tag (e.g. {@code SELLER:<userId>}) — no PII. */
    @Column(name = "actor", nullable = false, length = 120)
    private String actor;
}
