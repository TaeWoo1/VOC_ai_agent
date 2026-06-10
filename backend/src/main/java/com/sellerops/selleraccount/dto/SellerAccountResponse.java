package com.sellerops.selleraccount.dto;

import com.sellerops.channel.ChannelStatus;
import java.time.Instant;
import java.util.UUID;

public record SellerAccountResponse(
        UUID id,
        UUID channelId,
        String channelNameKo,
        String alias,
        ChannelStatus connectionStatus,
        Instant lastSyncedAt,
        boolean fileUpload) {
}
