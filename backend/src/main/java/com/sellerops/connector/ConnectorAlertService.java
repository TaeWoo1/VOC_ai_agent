package com.sellerops.connector;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.connector.dto.ConnectorAlertView;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Read-only access to the recorded connector/sync alerts. Org-scoped at the
 * query; names are resolved from the org's seller accounts + the channel catalog
 * (the alert row stores only ids). Open (unacknowledged) alerts sort first, then
 * newest. No writes here — acknowledgement is a future slice.
 */
@Service
public class ConnectorAlertService {

    private final ConnectorAlertRepository alerts;
    private final SellerAccountRepository sellerAccounts;
    private final ChannelRepository channels;

    public ConnectorAlertService(ConnectorAlertRepository alerts,
                                 SellerAccountRepository sellerAccounts,
                                 ChannelRepository channels) {
        this.alerts = alerts;
        this.sellerAccounts = sellerAccounts;
        this.channels = channels;
    }

    @Transactional(readOnly = true)
    public List<ConnectorAlertView> list(UUID orgId) {
        Map<UUID, SellerAccount> accountsById = sellerAccounts.findAllByOrgId(orgId).stream()
                .collect(Collectors.toMap(SellerAccount::getId, a -> a, (a, b) -> a));
        Map<UUID, String> channelNames = channels.findAll().stream()
                .collect(Collectors.toMap(Channel::getId, Channel::getNameKo, (a, b) -> a));

        return alerts.findTop200ByOrgIdOrderByCreatedAtDesc(orgId).stream()
                .map(a -> {
                    SellerAccount account = accountsById.get(a.getSellerAccountId());
                    UUID channelId = account == null ? null : account.getChannelId();
                    String channelNameKo = channelId == null ? null : channelNames.get(channelId);
                    String alias = account == null ? null : account.getAlias();
                    return ConnectorAlertView.from(a, channelId, channelNameKo, alias);
                })
                // Open (unacknowledged) first, then newest. createdAt is never null.
                .sorted(Comparator
                        .comparing((ConnectorAlertView v) -> v.acknowledgedAt() != null)
                        .thenComparing(ConnectorAlertView::createdAt, Comparator.reverseOrder()))
                .toList();
    }
}
