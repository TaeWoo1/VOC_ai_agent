package com.sellerops.selleraccount;

import com.sellerops.channel.ChannelStatus;
import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * An org's connection to a specific channel (or a file-upload channel).
 *
 * <p><b>At most one API-mode account per (org, channel).</b> An org's official-API connection to a
 * channel is singular, so a duplicate is prevented by a <b>partial</b> unique index —
 * {@code uq_seller_accounts_api_org_channel} on {@code (org_id, channel_id) WHERE is_file_upload =
 * false} (Flyway migration V36). File-upload accounts are deliberately NOT covered: ESM file-import
 * legitimately holds several file-upload rows on one channel, one per marketplace seller identity
 * ({@code EsmFileImportAccountService}). The index is filtered, which JPA's {@code @UniqueConstraint}
 * cannot express, so it lives in the migration only (like the existing V2 partial unique indexes) and
 * is the DB backstop behind the PESSIMISTIC_WRITE channel-row lock in {@code SellerAccountService}.
 */
@Getter
@Setter
@Entity
@Table(name = "seller_accounts")
public class SellerAccount extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "channel_id", nullable = false)
    private UUID channelId;

    private String alias;

    @Enumerated(EnumType.STRING)
    @Column(name = "connection_status", nullable = false)
    private ChannelStatus connectionStatus;

    @Column(name = "last_synced_at")
    private Instant lastSyncedAt;

    @Column(name = "is_file_upload", nullable = false)
    private boolean fileUpload;
}
