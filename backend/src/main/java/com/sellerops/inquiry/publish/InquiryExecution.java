package com.sellerops.inquiry.publish;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * The execution record for a work item's publish, with its explicit {@link
 * InquiryExecutionStatus}. One per work item ({@code work_item_id} UNIQUE);
 * {@code dispatch_key} is a single-dispatch guard (UNIQUE) — not an exactly-once
 * external-delivery guarantee. Mutable: the status transitions across the flow, so
 * it carries {@code updated_at}. Neither the reply token nor any provider error
 * text is ever stored here (only a numeric {@code result_code}).
 */
@Getter
@Setter
@Entity
@Table(name = "inquiry_execution",
        uniqueConstraints = {
                @UniqueConstraint(name = "uq_inquiry_execution_work_item", columnNames = "work_item_id"),
                @UniqueConstraint(name = "uq_inquiry_execution_dispatch_key", columnNames = "dispatch_key")})
public class InquiryExecution {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(updatable = false, nullable = false)
    private UUID id;

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "work_item_id", nullable = false)
    private UUID workItemId;

    @Column(name = "action_intent_id", nullable = false)
    private UUID actionIntentId;

    @Column(name = "dispatch_key", nullable = false, length = 64)
    private String dispatchKey;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 32)
    private InquiryExecutionStatus status;

    /** EXECUTION_FAILED / VERIFICATION_FAILED when terminal-failed; null otherwise. */
    @Column(name = "failure_reason", length = 40)
    private String failureReason;

    /** Normalized provider messageNo echoed on success; null otherwise. */
    @Column(name = "provider_message_no", length = 120)
    private String providerMessageNo;

    /** Numeric provider result code on rejection; null otherwise (never the message text). */
    @Column(name = "result_code")
    private Integer resultCode;

    @Column(name = "verify_attempts", nullable = false)
    private int verifyAttempts;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @PrePersist
    void onCreate() {
        Instant now = Instant.now();
        if (createdAt == null) {
            createdAt = now;
        }
        updatedAt = now;
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = Instant.now();
    }
}
