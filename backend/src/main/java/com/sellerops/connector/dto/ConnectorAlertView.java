package com.sellerops.connector.dto;

import com.sellerops.connector.ConnectorAlert;
import java.time.Instant;
import java.util.UUID;

/**
 * One recorded connector/sync alert for the in-app alert list. Read-only: the
 * channel/account names are resolved in-service (the alert row stores only ids).
 * {@code channelId}/{@code channelNameKo}/{@code accountAlias} are nullable when
 * the seller account behind the alert no longer exists.
 */
public record ConnectorAlertView(
        UUID id,
        UUID sellerAccountId,
        UUID channelId,
        String channelNameKo,
        String accountAlias,
        String type,
        String severity,
        String message,
        Instant createdAt,
        Instant acknowledgedAt) {

    public static ConnectorAlertView from(ConnectorAlert a, UUID channelId,
                                          String channelNameKo, String accountAlias) {
        return new ConnectorAlertView(a.getId(), a.getSellerAccountId(), channelId,
                channelNameKo, accountAlias, a.getType(), a.getSeverity(), a.getMessage(),
                a.getCreatedAt(), a.getAcknowledgedAt());
    }
}
