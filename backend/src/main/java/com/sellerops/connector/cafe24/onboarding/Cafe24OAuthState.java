package com.sellerops.connector.cafe24.onboarding;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * One pending Cafe24 authorization attempt. Created (tenant-bound) when a seller
 * starts "Connect Cafe24", consumed exactly once when the browser returns to the
 * callback. Only the SHA-256 {@code stateHash} is stored — the raw state token lives
 * solely in the authorization URL, and the callback value is hashed before lookup, so
 * the persisted row is never a usable credential. {@code mallId} is retained because
 * the per-mall token host is absent from the callback. No secret material
 * (authorization code, token, or raw state) is ever stored here.
 */
@Getter
@Setter
@Entity
@Table(name = "cafe24_oauth_state")
public class Cafe24OAuthState extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "seller_account_id", nullable = false)
    private UUID sellerAccountId;

    @Column(name = "channel_id", nullable = false)
    private UUID channelId;

    /** SHA-256 hash of the raw state token; the raw value is never persisted. */
    @Column(name = "state_hash", nullable = false, unique = true)
    private String stateHash;

    @Column(name = "mall_id", nullable = false)
    private String mallId;

    @Column(name = "redirect_uri", nullable = false, columnDefinition = "text")
    private String redirectUri;

    /** The seller who started the flow; attributed to the stored credential on success. */
    @Column(name = "initiated_by")
    private UUID initiatedBy;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    /** Set once, when the callback consumes this state; a second use is rejected. */
    @Column(name = "consumed_at")
    private Instant consumedAt;

    /** Usable only while unconsumed and not past expiry (checked at {@code now}). */
    public boolean isUsableAt(Instant now) {
        return consumedAt == null && now.isBefore(expiresAt);
    }
}
