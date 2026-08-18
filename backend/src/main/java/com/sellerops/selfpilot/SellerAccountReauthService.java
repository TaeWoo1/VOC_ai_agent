package com.sellerops.selfpilot;

import com.sellerops.channel.ChannelStatus;
import com.sellerops.connector.ChannelConnectionStatus;
import com.sellerops.connector.ChannelConnectionStatusRepository;
import com.sellerops.connector.ConnectorAlert;
import com.sellerops.connector.ConnectorAlertRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncSchedule;
import com.sellerops.sync.SyncScheduleRepository;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Turns an unambiguous authentication failure during collection into a <b>RECONNECT_REQUIRED task</b>
 * — and turns a successful reconnect back into routine collection. Self-Pilot Runtime v1.
 *
 * <p>Before this service a dead credential during a scheduled sync only bumped
 * {@code consecutive_failures}: three ticks later the connection read DEGRADED with a generic
 * "repeated failure" alert while the channel card still said 연결됨, and the schedule kept spending
 * ticks on a credential that could not work. Now, on {@link #markReconnectRequired}:
 * <ol>
 *   <li>the seller account's own status moves to {@link ChannelStatus#RECONNECT_REQUIRED} — the one
 *       word the 채널 연결 hub and the home's 확인이 필요한 연결 item already know how to show;</li>
 *   <li>every enabled schedule of the account is <b>paused with a reason</b> (a system pause, so
 *       {@link #onReconnected} can resume it; an operator-disabled schedule is never touched);</li>
 *   <li>the connection health reads {@code NEEDS_REAUTH} (a reauth state, not a failure count);</li>
 *   <li>one {@code AUTH_EXPIRED} alert row is opened (only if none is open) — recorded, not delivered.</li>
 * </ol>
 * On {@link #onReconnected} the paused schedules are resumed (due now), the health returns to
 * CONNECTED and the alert is closed. The account status itself is left to the channel's own lifecycle
 * (NAVER/Coupang: verified → PREPARING → first collected sync → CONNECTED; Cafe24: OAuth completion →
 * CONNECTED), so no channel's connect gate is bypassed here.
 *
 * <p>Idempotent and best-effort by contract: every method is safe to call twice, and a caller must
 * never let a failure here fail the run that detected the auth problem.
 */
@Service
public class SellerAccountReauthService {

    private static final Logger log = LoggerFactory.getLogger(SellerAccountReauthService.class);

    public static final String ALERT_TYPE_AUTH_EXPIRED = "AUTH_EXPIRED";
    public static final String HEALTH_NEEDS_REAUTH = "NEEDS_REAUTH";
    /** The seller-facing reason stamped on a paused schedule; the settings row shows it verbatim. */
    public static final String PAUSED_REASON_AUTH =
            "인증이 만료되어 자동 수집을 멈췄습니다. 채널을 다시 연결하면 자동으로 재개됩니다.";
    static final String ALERT_MESSAGE =
            "채널 인증이 만료되어 자동 수집이 멈췄습니다. 채널 연결에서 다시 연결해 주세요.";

    private final SellerAccountRepository accounts;
    private final SyncScheduleRepository schedules;
    private final ChannelConnectionStatusRepository health;
    private final ConnectorAlertRepository alerts;
    private final TransactionTemplate tx;

    public SellerAccountReauthService(SellerAccountRepository accounts, SyncScheduleRepository schedules,
                                      ChannelConnectionStatusRepository health, ConnectorAlertRepository alerts,
                                      PlatformTransactionManager txManager) {
        this.accounts = accounts;
        this.schedules = schedules;
        this.health = health;
        this.alerts = alerts;
        this.tx = new TransactionTemplate(txManager);
    }

    /**
     * The account's credential was clearly rejected by its channel. {@code detail} is the sanitized
     * connector message (already free of secrets); it becomes the health {@code lastError}.
     */
    public void markReconnectRequired(UUID orgId, UUID sellerAccountId, String detail) {
        try {
            tx.executeWithoutResult(status -> {
                SellerAccount account = accounts.findByIdForUpdate(sellerAccountId).orElse(null);
                if (account == null || !orgId.equals(account.getOrgId())) {
                    return;
                }
                if (account.getConnectionStatus() != ChannelStatus.RECONNECT_REQUIRED) {
                    account.setConnectionStatus(ChannelStatus.RECONNECT_REQUIRED);
                    accounts.save(account);
                }
                Instant now = Instant.now();
                for (SyncSchedule schedule : schedules.findByOrgIdAndSellerAccountId(orgId, sellerAccountId)) {
                    if (schedule.isEnabled()) {
                        schedule.setEnabled(false);
                        schedule.setPausedReason(PAUSED_REASON_AUTH);
                        schedule.setNextRunAt(null);
                        schedules.save(schedule);
                    }
                }
                ChannelConnectionStatus h = health.findBySellerAccountId(sellerAccountId).orElseGet(() -> {
                    ChannelConnectionStatus fresh = new ChannelConnectionStatus();
                    fresh.setOrgId(orgId);
                    fresh.setSellerAccountId(sellerAccountId);
                    return fresh;
                });
                h.setState(HEALTH_NEEDS_REAUTH);
                h.setLastError(detail);
                health.save(h);
                if (!alerts.existsBySellerAccountIdAndTypeAndAcknowledgedAtIsNull(sellerAccountId, ALERT_TYPE_AUTH_EXPIRED)) {
                    ConnectorAlert alert = new ConnectorAlert();
                    alert.setOrgId(orgId);
                    alert.setSellerAccountId(sellerAccountId);
                    alert.setType(ALERT_TYPE_AUTH_EXPIRED);
                    alert.setSeverity("CRITICAL");
                    alert.setMessage(ALERT_MESSAGE);
                    alerts.save(alert);
                }
                log.info("Seller account {} marked RECONNECT_REQUIRED (auth failure); schedules paused at {}",
                        sellerAccountId, now);
            });
        } catch (RuntimeException e) {
            // Best-effort by contract: the detecting run has already recorded its own FAILED status.
            log.warn("markReconnectRequired failed for account {}: {}", sellerAccountId, e.getClass().getSimpleName());
        }
    }

    /**
     * A credential for the account verified again (test-connection success, credential replace,
     * Cafe24 OAuth completion). Resumes system-paused schedules due now, closes the AUTH_EXPIRED
     * alert, and clears the reauth health state. Never re-enables an operator-disabled schedule.
     */
    public void onReconnected(UUID orgId, UUID sellerAccountId) {
        try {
            tx.executeWithoutResult(status -> {
                Instant now = Instant.now();
                for (SyncSchedule schedule : schedules.findByOrgIdAndSellerAccountId(orgId, sellerAccountId)) {
                    if (!schedule.isEnabled() && schedule.getPausedReason() != null) {
                        schedule.setEnabled(true);
                        schedule.setPausedReason(null);
                        schedule.setNextRunAt(now);
                        schedules.save(schedule);
                    }
                }
                health.findBySellerAccountId(sellerAccountId).ifPresent(h -> {
                    if (HEALTH_NEEDS_REAUTH.equals(h.getState())) {
                        h.setState("CONNECTED");
                        h.setLastError(null);
                        h.setConsecutiveFailures(0);
                        health.save(h);
                    }
                });
                List<ConnectorAlert> open = alerts.findBySellerAccountIdAndTypeIn(
                        sellerAccountId, List.of(ALERT_TYPE_AUTH_EXPIRED));
                for (ConnectorAlert alert : open) {
                    if (alert.getAcknowledgedAt() == null) {
                        alert.setAcknowledgedAt(now);
                        alerts.save(alert);
                    }
                }
            });
        } catch (RuntimeException e) {
            log.warn("onReconnected failed for account {}: {}", sellerAccountId, e.getClass().getSimpleName());
        }
    }
}
