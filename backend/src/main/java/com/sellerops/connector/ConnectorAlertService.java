package com.sellerops.connector;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.ApiException;
import com.sellerops.connector.coupang.CoupangCredentialExpiryStatus;
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

    /** Credential is inside the renew-recommended window (D-14 → date passed) — 갱신 권고. */
    public static final String TYPE_COUPANG_CREDENTIAL_EXPIRING = "COUPANG_CREDENTIAL_EXPIRING";
    /** Credential's expiry date has passed AND the connection is auth-failing — 재발급 필요. */
    public static final String TYPE_COUPANG_CREDENTIAL_EXPIRED = "COUPANG_CREDENTIAL_EXPIRED";

    // The connector_alerts.severity vocabulary (see ConnectorAlert): INFO / WARNING / CRITICAL.
    private static final String SEVERITY_WARNING = "WARNING";
    private static final String SEVERITY_CRITICAL = "CRITICAL";

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

    /**
     * Evaluate a Coupang credential's computed expiry and upsert the matching alert,
     * reusing the existing one-unacknowledged-per-type dedup so a repeated read never
     * spams the operator. Idempotent: while an alert of the target type is still open
     * (unacknowledged) nothing new is written; once acknowledged, a fresh occurrence
     * may open again. The escalation across D-30 → D-14 → D-7 → D-1 is carried by the
     * STATUS display, not by a new alert per bucket — this method opens at most:
     * <ul>
     *   <li>{@link #TYPE_COUPANG_CREDENTIAL_EXPIRED} (CRITICAL) when the state is EXPIRED
     *       (date passed AND auth-failing);</li>
     *   <li>{@link #TYPE_COUPANG_CREDENTIAL_EXPIRING} (WARNING) when the credential is in
     *       the renew-recommended window (WARN_14 / WARN_7 / WARN_1 / DATE_PASSED).</li>
     * </ul>
     * No alert for OK / WARN_30 / UNKNOWN. The message carries the days bucket only —
     * never a secret. A missing / cross-org account is a safe no-op (fail closed).
     * The caller is expected to have already org-scoped the account.
     */
    @Transactional
    public void evaluateCoupangExpiryAlert(UUID orgId, UUID sellerAccountId,
                                           CoupangCredentialExpiryStatus expiry) {
        if (orgId == null || sellerAccountId == null || expiry == null) {
            return;
        }
        // Fail closed: only act on an account that actually belongs to the caller's org.
        if (sellerAccounts.findById(sellerAccountId)
                .filter(a -> orgId.equals(a.getOrgId())).isEmpty()) {
            return;
        }
        if (expiry.state() == CoupangCredentialExpiryStatus.State.EXPIRED) {
            openOnce(orgId, sellerAccountId, TYPE_COUPANG_CREDENTIAL_EXPIRED, SEVERITY_CRITICAL,
                    expiredMessage(expiry));
        } else if (expiry.renewRecommended()) {
            // renewRecommended without EXPIRED ⇒ WARN_14 / WARN_7 / WARN_1 / DATE_PASSED.
            openOnce(orgId, sellerAccountId, TYPE_COUPANG_CREDENTIAL_EXPIRING, SEVERITY_WARNING,
                    expiringMessage(expiry));
        }
        // OK / WARN_30 / UNKNOWN: no alert.
    }

    /** Open a new alert only when no unacknowledged alert of this type is already on file (dedup). */
    private void openOnce(UUID orgId, UUID sellerAccountId, String type, String severity, String message) {
        if (alerts.existsBySellerAccountIdAndTypeAndAcknowledgedAtIsNull(sellerAccountId, type)) {
            return; // one open alert of a type per account — no spam.
        }
        ConnectorAlert alert = new ConnectorAlert();
        alert.setOrgId(orgId);
        alert.setSellerAccountId(sellerAccountId);
        alert.setType(type);
        alert.setSeverity(severity);
        alert.setMessage(message);
        alerts.save(alert);
    }

    private static String expiringMessage(CoupangCredentialExpiryStatus expiry) {
        if (expiry.state() == CoupangCredentialExpiryStatus.State.DATE_PASSED) {
            return "쿠팡 API 키 만료일이 지났습니다. WING에서 API 키를 재발급해 연결을 갱신해 주세요.";
        }
        Integer days = expiry.daysRemaining();
        String bucket = days != null ? "D-" + days + "일" : "곧";
        return "쿠팡 API 키 만료 예정(" + bucket + "). WING에서 API 키를 갱신해 주세요.";
    }

    private static String expiredMessage(CoupangCredentialExpiryStatus expiry) {
        return "쿠팡 API 키가 만료되어 연결이 실패하고 있습니다. WING에서 API 키를 재발급해 주세요.";
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
