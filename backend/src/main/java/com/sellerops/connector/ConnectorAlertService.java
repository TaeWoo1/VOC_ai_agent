package com.sellerops.connector;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.ApiException;
import com.sellerops.connector.dto.ConnectorAlertView;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Access to the recorded connector/sync alerts. Org-scoped at the query; names
 * are resolved from the org's seller accounts + the channel catalog (the alert
 * row stores only ids). Open (unacknowledged) alerts sort first, then newest.
 * The only write is {@link #acknowledge(UUID, UUID)} (확인 처리) — acknowledging
 * marks the alert as seen; it does not resolve the underlying connection issue.
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
                .map(a -> toView(a, accountsById.get(a.getSellerAccountId()), channelNames))
                // Open (unacknowledged) first, then newest. createdAt is never null.
                .sorted(Comparator
                        .comparing((ConnectorAlertView v) -> v.acknowledgedAt() != null)
                        .thenComparing(ConnectorAlertView::createdAt, Comparator.reverseOrder()))
                .toList();
    }

    /**
     * Mark one alert as 확인 처리 (seen). Org-scoped: a cross-org or missing id is
     * a 404, never another org's row. Idempotent — {@code acknowledgedAt} is set
     * once and a repeat call keeps the original timestamp. Acknowledging only
     * records that the operator saw the alert; the underlying connection issue
     * (e.g. AUTH_EXPIRED) is still fixed in the channel via 재연결·테스트.
     */
    @Transactional
    public ConnectorAlertView acknowledge(UUID orgId, UUID alertId) {
        ConnectorAlert alert = alerts.findByIdAndOrgId(alertId, orgId)
                .orElseThrow(() -> ApiException.notFound("연결 알림을 찾을 수 없습니다."));
        if (alert.getAcknowledgedAt() == null) {
            alert.setAcknowledgedAt(Instant.now());
            alert = alerts.save(alert);
        }
        SellerAccount account = sellerAccounts.findById(alert.getSellerAccountId()).orElse(null);
        Map<UUID, String> channelNames = channels.findAll().stream()
                .collect(Collectors.toMap(Channel::getId, Channel::getNameKo, (a, b) -> a));
        return toView(alert, account, channelNames);
    }

    /** Attach channel/account names to one alert. {@code account} may be null when
     *  the seller account behind the alert no longer exists. */
    private ConnectorAlertView toView(ConnectorAlert alert, SellerAccount account,
                                      Map<UUID, String> channelNames) {
        UUID channelId = account == null ? null : account.getChannelId();
        String channelNameKo = channelId == null ? null : channelNames.get(channelId);
        String alias = account == null ? null : account.getAlias();
        return ConnectorAlertView.from(alert, channelId, channelNameKo, alias);
    }
}
