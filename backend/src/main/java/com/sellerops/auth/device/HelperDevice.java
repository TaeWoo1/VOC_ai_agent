package com.sellerops.auth.device;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * One installed reviewnary 도우미, linked to one seller account by a browser session (Helper Device
 * Authentication v1, docs/helper_device_authentication_v1.md).
 *
 * <p>The helper presents an opaque token ({@code rvh_…}); only its SHA-256 lives here, exactly as
 * {@code auth_handoffs} keeps social one-time codes. The row IS the seller's standing grant: revoking it
 * ({@code revoked_at}) ends the helper's access on its next request — there is no cached verdict to wait out.
 */
@Getter
@Setter
@Entity
@Table(name = "helper_devices")
public class HelperDevice extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "token_hash", nullable = false, unique = true, length = 64)
    private String tokenHash;

    /** A closed, seller-readable name the helper reports about itself (platform · arch), never a hostname. */
    @Column(name = "device_name", nullable = false, length = 80)
    private String deviceName;

    @Column(name = "helper_version", length = 40)
    private String helperVersion;

    @Column(name = "last_used_at")
    private Instant lastUsedAt;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "revoked_at")
    private Instant revokedAt;

    public boolean isActive(Instant now) {
        return revokedAt == null && expiresAt.isAfter(now);
    }
}
