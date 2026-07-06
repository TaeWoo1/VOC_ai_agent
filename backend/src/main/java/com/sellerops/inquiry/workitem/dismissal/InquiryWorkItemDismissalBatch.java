package com.sellerops.inquiry.workitem.dismissal;

import com.sellerops.common.BaseEntity;
import com.sellerops.inquiry.workitem.InquiryWorkItemDisposition;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * Durable ledger row for one executed bulk dismissal — the reproducibility and
 * idempotency anchor for a chunk. Written only on a fully successful all-or-nothing
 * execution, atomically with the item transitions and their audits.
 *
 * <p><b>Idempotency:</b> {@code (org_id, command_id)} is UNIQUE. {@link #manifestHash}
 * binds the {@code command_id} to the exact approved payload (org, seller account,
 * disposition, sorted work-item ids, approval metadata) so a replay with the same
 * command and payload is recognized, while the same command with a different payload
 * is rejected — never silently re-applied.
 *
 * <p><b>Identities kept distinct:</b> {@link #approvedBy}/{@link #approvedAt} are the
 * manifest's approval metadata (who signed off); {@link #executedBy}/{@link
 * #executedAt} are the authenticated executor and server time. Approval metadata is
 * never treated as identity or authorization. No inquiry title/body/author or buyer
 * PII is stored here.
 */
@Getter
@Setter
@Entity
@Table(name = "inquiry_work_item_dismissal_batch",
        uniqueConstraints = @UniqueConstraint(
                name = "uq_dismissal_batch_org_command", columnNames = {"org_id", "command_id"}))
public class InquiryWorkItemDismissalBatch extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "seller_account_id", nullable = false)
    private UUID sellerAccountId;

    @Column(name = "command_id", nullable = false)
    private String commandId;

    @Enumerated(EnumType.STRING)
    @Column(name = "disposition", nullable = false)
    private InquiryWorkItemDisposition disposition;

    /** SHA-256 hex of the canonical approved payload — binds command_id to the manifest. */
    @Column(name = "manifest_hash", nullable = false)
    private String manifestHash;

    @Column(name = "item_count", nullable = false)
    private int itemCount;

    /** Approval metadata — who signed off (never identity/authorization). */
    @Column(name = "approved_by", nullable = false)
    private String approvedBy;

    @Column(name = "approved_at", nullable = false)
    private Instant approvedAt;

    /** The authenticated executor (system/operator tag derived from the principal). */
    @Column(name = "executed_by", nullable = false)
    private String executedBy;

    @Column(name = "executed_at", nullable = false)
    private Instant executedAt;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false)
    private DismissalBatchStatus status;
}
