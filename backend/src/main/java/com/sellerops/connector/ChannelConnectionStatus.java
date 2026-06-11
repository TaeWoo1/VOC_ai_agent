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
 * Per-seller-account connection health (one row per account) driving the
 * Channels-page status UI. Written by the health tracker in a later slice; this
 * slice only defines the entity/repo.
 */
@Getter
@Setter
@Entity
@Table(name = "channel_connection_status")
public class ChannelConnectionStatus extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "seller_account_id", nullable = false, unique = true)
    private UUID sellerAccountId;

    /** CONNECTED / DEGRADED / EXPIRED / DISCONNECTED / NEEDS_REAUTH. */
    @Column(nullable = false)
    private String state;

    @Column(name = "last_success_at")
    private Instant lastSuccessAt;

    @Column(name = "consecutive_failures", nullable = false)
    private int consecutiveFailures = 0;

    @Column(name = "last_error", columnDefinition = "text")
    private String lastError;
}
