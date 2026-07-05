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
 * The publish intent — what WOULD be sent — bound to the approved fingerprint. One
 * per work item, created atomically with the approval. It performs no side effect.
 */
@Getter
@Setter
@Entity
@Table(name = "inquiry_action_intent",
        uniqueConstraints = @UniqueConstraint(
                name = "uq_inquiry_action_intent_work_item", columnNames = "work_item_id"))
public class InquiryActionIntent {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(updatable = false, nullable = false)
    private UUID id;

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "work_item_id", nullable = false)
    private UUID workItemId;

    @Column(name = "approved_fingerprint", nullable = false, length = 64)
    private String approvedFingerprint;

    @Column(name = "action_kind", nullable = false, length = 40)
    private String actionKind;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @PrePersist
    void onCreate() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }
}
