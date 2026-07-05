package com.sellerops.inquiry.publish;

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
 * Immutable approval binding: one per work item, bound to the exact draft version +
 * {@code approved_fingerprint} the seller confirmed. {@code command_id} is the
 * idempotency key of the confirm command.
 */
@Getter
@Setter
@Entity
@Table(name = "inquiry_approval",
        uniqueConstraints = @UniqueConstraint(
                name = "uq_inquiry_approval_work_item", columnNames = "work_item_id"))
public class InquiryApproval {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(updatable = false, nullable = false)
    private UUID id;

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "work_item_id", nullable = false)
    private UUID workItemId;

    @Column(name = "approved_draft_version", nullable = false)
    private int approvedDraftVersion;

    @Column(name = "approved_fingerprint", nullable = false, length = 64)
    private String approvedFingerprint;

    @Column(name = "command_id", nullable = false, length = 120)
    private String commandId;

    @Column(name = "approver", nullable = false, length = 120)
    private String approver;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @PrePersist
    void onCreate() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }
}
