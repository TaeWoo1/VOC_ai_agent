package com.sellerops.inquiry.publish;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * Append-only verification attempt: a re-query of the exact inquiry's {@code
 * informStatus}. {@code verified} is true only when it returned {@code 처리완료};
 * {@code answerDate} is never consulted.
 */
@Getter
@Setter
@Entity
@Table(name = "inquiry_verification")
public class InquiryVerification {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(updatable = false, nullable = false)
    private UUID id;

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "work_item_id", nullable = false)
    private UUID workItemId;

    @Column(name = "execution_id", nullable = false)
    private UUID executionId;

    @Column(name = "verified", nullable = false)
    private boolean verified;

    @Column(name = "observed_status", length = 40)
    private String observedStatus;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @PrePersist
    void onCreate() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }
}
