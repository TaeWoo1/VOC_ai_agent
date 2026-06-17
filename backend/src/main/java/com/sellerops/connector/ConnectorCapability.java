package com.sellerops.connector;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.Getter;
import lombok.Setter;

/**
 * Reference data: whether a (channel_code, connector_class, data_type) combination
 * is collectable, with an honest verification status (CONFIRMED /
 * NEEDS_VERIFICATION / UNSUPPORTED). Seeded in V3 from the verified Phase 3B
 * findings. This slice only defines the entity/repo — capability gating is later.
 */
@Getter
@Setter
@Entity
@Table(name = "connector_capabilities", uniqueConstraints = @UniqueConstraint(
        name = "uq_connector_capabilities_natural",
        columnNames = {"channel_code", "connector_class", "data_type"}))
public class ConnectorCapability extends BaseEntity {

    @Column(name = "channel_code", nullable = false)
    private String channelCode;

    @Column(name = "connector_class", nullable = false)
    private String connectorClass;

    @Column(name = "data_type", nullable = false)
    private String dataType;

    @Column(nullable = false)
    private boolean supported;

    /** CONFIRMED / NEEDS_VERIFICATION / UNSUPPORTED. */
    @Column(name = "verification_status", nullable = false)
    private String verificationStatus;

    @Column(columnDefinition = "text")
    private String notes;
}
