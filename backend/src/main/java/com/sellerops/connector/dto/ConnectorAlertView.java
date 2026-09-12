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
        Instant acknowledgedAt,
        /**
         * When collection on this account demonstrably started working again, or null.
         *
         * <p><b>This is derived, never stored.</b> It is the first successful (or partial) sync that
         * finished after the alert was raised, computed at read time — the alert row itself is never
         * touched, so the record of what went wrong and when survives exactly as written.
         *
         * <p><b>It is a different fact from {@code acknowledgedAt}, and merging them would lose one.</b>
         * Acknowledgement is 「the operator saw this」; recovery is 「the condition ended」. A seller can
         * see an alert for a channel that is still broken, and a channel can fix itself while nobody
         * looked. Writing recovery into {@code acknowledgedAt} would claim a person read something
         * they never opened.
         *
         * <p>Null for alert types a later success cannot disprove — a credential expiring next month
         * is not refuted by a sync that worked today.
         */
        Instant recoveredAt) {

    public static ConnectorAlertView from(ConnectorAlert a, UUID channelId,
                                          String channelNameKo, String accountAlias) {
        return from(a, channelId, channelNameKo, accountAlias, null);
    }

    public static ConnectorAlertView from(ConnectorAlert a, UUID channelId,
                                          String channelNameKo, String accountAlias,
                                          Instant recoveredAt) {
        return new ConnectorAlertView(a.getId(), a.getSellerAccountId(), channelId,
                channelNameKo, accountAlias, a.getType(), a.getSeverity(), a.getMessage(),
                a.getCreatedAt(), a.getAcknowledgedAt(), recoveredAt);
    }

    /**
     * Whether this alert is a CURRENT connection problem.
     *
     * <p>Unacknowledged and not recovered. A surface that counts connection problems counts these;
     * the history screen shows every row whatever this says, because an alert that resolved itself is
     * still a thing that happened.
     */
    public boolean active() {
        return acknowledgedAt == null && recoveredAt == null;
    }
}
