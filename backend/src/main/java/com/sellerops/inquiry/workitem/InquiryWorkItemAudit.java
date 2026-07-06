package com.sellerops.inquiry.workitem;

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
 * Append-only audit record for a {@link InquiryWorkItem} lifecycle event. Rows are
 * written once and never updated in place — the immutable evidence trail for the
 * work queue. This slice writes exactly one row ({@link
 * InquiryWorkItemEvent#WORK_ITEM_OPENED}) per new work item, in the same
 * transaction that creates the work item and its inquiry.
 *
 * <p><b>Idempotency:</b> {@code (work_item_id, command_id)} is UNIQUE — a replay of
 * the same command can never append a duplicate audit row (porting the collector's
 * commandId idempotency). {@code phase_from} is {@code null} at open.
 */
@Getter
@Setter
@Entity
@Table(name = "inquiry_work_item_audit",
        uniqueConstraints = @UniqueConstraint(
                name = "uq_inquiry_work_item_audit_command",
                columnNames = {"work_item_id", "command_id"}))
public class InquiryWorkItemAudit extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "work_item_id", nullable = false)
    private UUID workItemId;

    /** Idempotency key for the emitting command (e.g. {@code open:<inquiryId>}). */
    @Column(name = "command_id", nullable = false)
    private String commandId;

    @Enumerated(EnumType.STRING)
    @Column(name = "event_type", nullable = false)
    private InquiryWorkItemEvent eventType;

    /** Phase before the event; {@code null} when the work item is first opened. */
    @Enumerated(EnumType.STRING)
    @Column(name = "phase_from")
    private InquiryWorkItemPhase phaseFrom;

    @Enumerated(EnumType.STRING)
    @Column(name = "phase_to", nullable = false)
    private InquiryWorkItemPhase phaseTo;

    /** Who caused the event (a system/actor tag — no PII). */
    @Column(name = "actor", nullable = false)
    private String actor;

    /**
     * The structured disposition carried by this event, when it records a dismissal
     * ({@link InquiryWorkItemEvent#WORK_ITEM_DISMISSED}); {@code null} for all other
     * events. Keeps the immutable trail self-describing about <i>why</i> the item was
     * dismissed, independent of the (mutable) current work-item state.
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "disposition")
    private InquiryWorkItemDisposition disposition;

    /**
     * The dismissal batch that caused this event, for {@link
     * InquiryWorkItemEvent#WORK_ITEM_DISMISSED} rows; {@code null} for all other
     * events. Ties each dismissal audit back to the durable, approved batch ledger.
     */
    @Column(name = "dismissal_batch_id")
    private UUID dismissalBatchId;

    /**
     * The ESM import batch that caused this event, for a status-reconciliation
     * transition ({@link InquiryWorkItemEvent#VERIFICATION_RECORDED} written when a
     * later ANSWERED export completes an OPEN work item); {@code null} for all other
     * events. Ties the transition back to the durable import batch that triggered it.
     */
    @Column(name = "import_batch_id")
    private UUID importBatchId;
}
