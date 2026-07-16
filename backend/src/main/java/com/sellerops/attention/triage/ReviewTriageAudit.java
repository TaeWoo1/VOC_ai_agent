package com.sellerops.attention.triage;

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
 * Append-only evidence of one triage decision. Rows are written once and never updated —
 * the immutable trail behind the mutable {@link ReviewTriage}. Changing a decision appends;
 * it never rewrites, so "this was RESPONSE_NEEDED for a week before someone closed it out"
 * stays answerable.
 *
 * <p>That answerability rests on {@code disposition_from} naming the row's REAL predecessor,
 * which append-only alone does not buy. Two concurrent decisions would otherwise both read
 * the same current value and both record having left it — two rows, one predecessor, an
 * impossible history for a single-valued column, with the intermediate state erased. No
 * constraint here can catch it: their command ids differ, so nothing collides.
 * {@link ReviewTriageWriter} takes a row lock to prevent it, and
 * {@code ReviewTriageConcurrencyTest} holds that to account.
 *
 * <p><b>Idempotency is org-scoped on {@code command_id}, not triage-scoped.</b>
 * {@code (org_id, command_id)} is UNIQUE, following
 * {@code inquiry_work_item_dismissal_batch}'s {@code uq_dismissal_batch_org_command} rather
 * than {@code inquiry_work_item_audit}'s {@code (work_item_id, command_id)}. Both
 * conventions exist in this codebase; the org-scoped one is correct here because the
 * command id is CLIENT-generated and arrives with the ref, so the row it targets is part of
 * what a replay must match. Under the narrower key, a client that reused one command id
 * across two different reviews would have both writes accepted as unrelated — each unique
 * within its own triage row — and the reuse would be invisible. Org-scoped catches it:
 * exactly one command id, one effect, per org.
 *
 * <p>Column lengths are pinned here rather than left to JPA's defaults, and that is not
 * decoration: the test schema is generated from these annotations (Flyway is disabled under
 * the {@code test} profile), so an unpinned column would be a {@code varchar(255)} in every
 * test while production ran V18's narrower one. Any value between the two would pass CI and
 * fail live. Same reason {@code InquiryApproval} pins its own {@code command_id}.
 *
 * <p>{@code disposition_from} is null on the first decision for a review, mirroring how
 * {@code InquiryWorkItemAudit.phase_from} is null at open. There is no event-type column:
 * every row here records the same kind of event (a human set a disposition), so a column
 * with one possible value would carry no information — unlike the inquiry trail, which
 * multiplexes seven distinct lifecycle events onto one table.
 */
@Getter
@Setter
@Entity
@Table(name = "review_triage_audit",
        uniqueConstraints = @UniqueConstraint(
                name = "uq_review_triage_audit_org_command",
                columnNames = {"org_id", "command_id"}))
public class ReviewTriageAudit extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    /** The {@link ReviewTriage} this event belongs to. */
    @Column(name = "review_triage_id", nullable = false)
    private UUID reviewTriageId;

    /** Client-supplied idempotency key; unique per org. */
    @Column(name = "command_id", nullable = false, length = ReviewTriageService.MAX_COMMAND_ID_LEN)
    private String commandId;

    /** Disposition before this decision; {@code null} when it is the review's first. */
    @Enumerated(EnumType.STRING)
    @Column(name = "disposition_from", length = 32)
    private TriageDisposition dispositionFrom;

    @Enumerated(EnumType.STRING)
    @Column(name = "disposition_to", nullable = false, length = 32)
    private TriageDisposition dispositionTo;

    /** Who decided (an actor tag, e.g. {@code SELLER:<userId>}) — no PII. */
    @Column(name = "actor", nullable = false, length = 120)
    private String actor;
}
