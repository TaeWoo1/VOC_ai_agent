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

/** An org's connection to a specific channel (or a file-upload channel). */
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
