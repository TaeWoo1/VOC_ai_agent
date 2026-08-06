package com.sellerops.walkthrough;

import com.sellerops.channel.ChannelRepository;
import com.sellerops.credential.ConnectorCredentialRepository;
import com.sellerops.order.ChannelOrderRepository;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncJobRepository;
import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Walkthrough environment-identity endpoints. They exist ONLY when {@code sellerops.walkthrough.enabled=true}
 * (the disposable walkthrough runtime): {@link ConditionalOnProperty} means the bean — and therefore the
 * routes — are absent in production, so any request there is a fail-closed 404. They let the operator's tab
 * PROVE it is bound to this exact bootstrapped backend/DB/runtime, closing the gap where a green /health
 * was mistaken for a working, correctly-targeted walkthrough.
 *
 * <p><b>Read-only + sanitized + 0 DB writes.</b> {@code /context} runs only {@code count()} reads and
 * returns a sanitized {@link WalkthroughContextView} (no DB URL / password / vault key / credential / token
 * / raw identifier). {@code /handshake} performs NO DB access at all — it compares the posted run id +
 * origin to this runtime's and logs only sanitized booleans. Both require the operator JWT (they fall under
 * the authenticated matcher), and are reached same-origin through the dev proxy.
 */
@RestController
@RequestMapping("/api/walkthrough")
@ConditionalOnProperty(name = "sellerops.walkthrough.enabled", havingValue = "true")
public class WalkthroughController {

    private static final Logger log = LoggerFactory.getLogger(WalkthroughController.class);

    private final String runId;
    private final String gitCommit;
    private final String dbAlias;
    private final String frontendOrigin;
    private final String backendOrigin;
    private final boolean schedulerEnabled;
    private final String channelCode;
    private final boolean connectorEnabled;
    private final String startedAt = Instant.now().toString();

    private final ConnectorCredentialRepository credentials;
    private final SyncJobRepository syncJobs;
    private final ChannelOrderRepository channelOrders;
    private final SellerAccountRepository sellerAccounts;
    private final ChannelRepository channels;

    public WalkthroughController(
            @Value("${sellerops.walkthrough.run-id:}") String runId,
            @Value("${sellerops.walkthrough.git-commit:unknown}") String gitCommit,
            @Value("${sellerops.walkthrough.db-alias:unknown}") String dbAlias,
            @Value("${sellerops.walkthrough.frontend-origin:http://localhost:5173}") String frontendOrigin,
            @Value("${sellerops.walkthrough.backend-origin:http://127.0.0.1:18090}") String backendOrigin,
            @Value("${sellerops.collect.scheduler-enabled:false}") boolean schedulerEnabled,
            @Value("${sellerops.walkthrough.channel-code:NAVER}") String channelCode,
            @Value("${sellerops.connector.naver.enabled:false}") boolean naverConnectorEnabled,
            @Value("${sellerops.connector.coupang.enabled:false}") boolean coupangConnectorEnabled,
            ConnectorCredentialRepository credentials,
            SyncJobRepository syncJobs,
            ChannelOrderRepository channelOrders,
            SellerAccountRepository sellerAccounts,
            ChannelRepository channels) {
        this.runId = runId;
        this.gitCommit = gitCommit;
        this.dbAlias = dbAlias;
        this.frontendOrigin = frontendOrigin;
        this.backendOrigin = backendOrigin;
        this.schedulerEnabled = schedulerEnabled;
        this.channelCode = sanitizeChannelCode(channelCode);
        this.connectorEnabled = resolveConnectorEnabled(
                this.channelCode, naverConnectorEnabled, coupangConnectorEnabled);
        this.credentials = credentials;
        this.syncJobs = syncJobs;
        this.channelOrders = channelOrders;
        this.sellerAccounts = sellerAccounts;
        this.channels = channels;
    }

    /** Read-only runtime identity + coarse baseline. No DB write; no secret/token/raw id. */
    @GetMapping("/context")
    public WalkthroughContextView context() {
        long channelAccounts = channels.findByCode(channelCode)
                .map(c -> sellerAccounts.findAll().stream()
                        .filter(a -> c.getId().equals(a.getChannelId()))
                        .count())
                .orElse(0L);
        WalkthroughContextView.Baseline baseline = new WalkthroughContextView.Baseline(
                credentials.count(), syncJobs.count(), channelOrders.count(), channelAccounts);
        return new WalkthroughContextView(
                runId, gitCommit, frontendOrigin, backendOrigin, dbAlias,
                schedulerEnabled, channelCode, connectorEnabled, baseline, startedAt);
    }

    /**
     * Normalize the configured target channel code to a sanitized upper-case token. A blank/null value
     * falls back to the default {@code NAVER} so the existing NAVER walkthrough behavior is unchanged.
     */
    private static String sanitizeChannelCode(String channelCode) {
        if (channelCode == null || channelCode.isBlank()) {
            return "NAVER";
        }
        return channelCode.trim().toUpperCase(java.util.Locale.ROOT);
    }

    /**
     * Select the connector feature flag for the configured channel. The two flags live under different
     * property keys ({@code sellerops.connector.naver.enabled}, {@code sellerops.connector.coupang.enabled}),
     * so both are injected and picked by the sanitized channel code. An unknown code fails closed to
     * {@code false} — never surfacing a connector as enabled for a channel the walkthrough does not target.
     */
    private static boolean resolveConnectorEnabled(
            String channelCode, boolean naverConnectorEnabled, boolean coupangConnectorEnabled) {
        return switch (channelCode) {
            case "NAVER" -> naverConnectorEnabled;
            case "COUPANG" -> coupangConnectorEnabled;
            default -> false;
        };
    }

    /**
     * Operator-tab handshake. The frontend posts the run id carried in the TAB'S OWN URL (the address bar),
     * not the value it read from {@code /context}, so this compares the backend's authoritative run id
     * against what the tab actually carries — a cross-source check plus a sanitized backend-side audit that
     * the bound tab reached this runtime. It is a required gate step, but the load-bearing binding is the
     * frontend's 3-way match (URL id == frontend-build id == {@code /context} id) + origin; this handshake
     * can only ever REFUSE the gate, never wrongly open it. NO DB access; the nonce is never persisted or
     * echoed (only its presence is logged).
     */
    @PostMapping("/handshake")
    public WalkthroughHandshake.Result handshake(@RequestBody WalkthroughHandshake.Request req) {
        boolean runMatched = runId != null && !runId.isBlank()
                && runId.equals(req.walkthroughRunId());
        boolean originMatched = frontendOrigin.equals(req.origin());
        String ts = Instant.now().toString();
        log.info("walkthrough tab handshake runMatched={} originMatched={} nonced={} ts={}",
                runMatched, originMatched, req.tabNonce() != null && !req.tabNonce().isBlank(), ts);
        return new WalkthroughHandshake.Result(runMatched, originMatched, ts);
    }
}
