package com.sellerops.channel;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Channel card payload for the connection page and dashboard channel status. */
public record ChannelResponse(
        UUID id,
        String code,
        String nameKo,
        ChannelStatus status,
        List<String> dataBadges,
        Instant lastSyncedAt,
        String actionLabel) {
}
