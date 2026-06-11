package com.sellerops.connector;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * A recorded connector failure/health alert. Phase 3B records these rows only —
 * delivery (email/SMS/push) is explicitly out of scope. This slice defines the
 * entity/repo; the alert service that writes them arrives in a later slice.
 */
@Getter
@Setter
@Entity
@Table(name = "connector_alerts")
public class ConnectorAlert extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "seller_account_id", nullable = false)
    private UUID sellerAccountId;

    @Column(name = "sync_job_id")
    private UUID syncJobId;

    /** INFO / WARNING / CRITICAL. */
    @Column(nullable = false)
    private String severity;

    /** AUTH_EXPIRED / REPEATED_FAILURE / RATE_LIMITED. */
    @Column(nullable = false)
    private String type;

    @Column(nullable = false, columnDefinition = "text")
    private String message;

    @Column(name = "acknowledged_at")
    private Instant acknowledgedAt;
}
