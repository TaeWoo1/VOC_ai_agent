package com.sellerops.connector.cafe24;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.common.ApiException;
import com.sellerops.connector.cafe24.Cafe24BoardDiscovery.ClassifiedBoard;
import com.sellerops.connector.cafe24.capability.Cafe24CapabilityEvaluator;
import com.sellerops.connector.cafe24.capability.Cafe24CapabilityEvaluator.AuthProbe;
import com.sellerops.connector.cafe24.capability.Cafe24CapabilityEvaluator.OrderProbe;
import com.sellerops.connector.cafe24.capability.Cafe24ConnectionCapabilityView;
import com.sellerops.credential.CredentialVault;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncJob;
import com.sellerops.sync.SyncJobRepository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * Read-only Cafe24 connection capability check for the first-connection tutorial. Given an
 * org + seller account it gathers a few facts and hands them to the pure
 * {@link Cafe24CapabilityEvaluator}: does a credential row exist, does the account read as
 * CONNECTED, does a live authorize + {@code /boards} read succeed (proving the vault decrypts
 * and the credential truly belongs to a reachable mall), how do the discovered boards map, and
 * what was the latest order-sync outcome.
 *
 * <p><b>Fail-closed + sanitized.</b> A missing/foreign account is a 404. The live probe's
 * exceptions are caught and collapsed to a coarse {@link AuthProbe} — their messages (which may
 * name the mall or carry provider detail) never reach the caller or the logs. The returned view
 * carries no mall id, token, board name, or personal data. This method performs a live token
 * refresh (single-use rotation) via {@link Cafe24Authorizer}, so it is a POST, not a GET.
 *
 * <p><b>Order read stays independent of community read.</b> Order status comes solely from the
 * latest {@code ORDER_SUMMARY} {@link SyncJob}; a successful order sync is never treated as proof
 * of {@code mall.read_community}.
 *
 * <p>Registered by component-scan and gated on {@code sellerops.connector.cafe24.enabled} so it
 * exists only when the Cafe24 connector (and its authorize/board-discovery beans) do. It is a
 * {@code @Component} rather than a {@code @Bean} in {@code Cafe24ConnectorConfiguration} so the
 * connector-config slice tests, which load that configuration without JPA repositories, are
 * unaffected.
 */
@Component
@ConditionalOnProperty(name = "sellerops.connector.cafe24.enabled", havingValue = "true")
public class Cafe24ConnectionCapabilityService {

    private static final Logger log = LoggerFactory.getLogger(Cafe24ConnectionCapabilityService.class);

    private static final String CHANNEL_CODE = Cafe24ApiConnector.CHANNEL_CODE;
    private static final String ORDER_SUMMARY = "ORDER_SUMMARY";

    private final SellerAccountRepository accounts;
    private final ChannelRepository channels;
    private final CredentialVault vault;
    private final Cafe24Authorizer authorizer;
    private final Cafe24BoardDiscovery discovery;
    private final SyncJobRepository syncJobs;

    public Cafe24ConnectionCapabilityService(
            SellerAccountRepository accounts, ChannelRepository channels, CredentialVault vault,
            Cafe24Authorizer authorizer, Cafe24BoardDiscovery discovery, SyncJobRepository syncJobs) {
        this.accounts = accounts;
        this.channels = channels;
        this.vault = vault;
        this.authorizer = authorizer;
        this.discovery = discovery;
        this.syncJobs = syncJobs;
    }

    /** Run the read-only capability check for one org-scoped Cafe24 account. */
    public Cafe24ConnectionCapabilityView check(UUID orgId, UUID sellerAccountId) {
        SellerAccount account = accounts.findByIdAndOrgId(sellerAccountId, orgId)
                .orElseThrow(() -> ApiException.notFound("연결 계정을 찾을 수 없습니다."));
        if (account.isFileUpload() || !isCafe24(account.getChannelId())) {
            // Not an API-mode Cafe24 account — this endpoint does not apply to it.
            throw ApiException.notFound("카페24 연결 계정이 아닙니다.");
        }

        boolean credentialPresent = vault.hasCredential(orgId, sellerAccountId);

        AuthProbe authProbe = AuthProbe.NOT_ATTEMPTED;
        List<ClassifiedBoard> boards = null;
        if (account.getConnectionStatus() == ChannelStatus.CONNECTED && credentialPresent) {
            try {
                Cafe24Authorizer.Authorized authorized = authorizer.authorize(orgId, sellerAccountId);
                boards = discovery.discover(authorized.accessToken(), authorized.mallId()).boards();
                authProbe = AuthProbe.OK;
            } catch (Cafe24RateLimitedException transientError) {
                // Transient — tell the seller to retry, never to reconnect. Neither the exception
                // message nor the account id is logged (sanitized coarse outcome only).
                authProbe = AuthProbe.PROVIDER_ERROR;
                log.info("Cafe24 capability probe rate-limited (transient)");
            } catch (RuntimeException authFailed) {
                // Credential/config could not authorize (bad refresh token, missing key, shape).
                // Fail closed: reconnect. Neither the exception message nor the account id is logged.
                authProbe = AuthProbe.AUTH_FAILED;
                log.info("Cafe24 capability probe could not authorize (reconnect required)");
            }
        }

        OrderProbe orderProbe = latestOrderOutcome(orgId, sellerAccountId);

        return Cafe24CapabilityEvaluator.evaluate(
                sellerAccountId,
                account.getConnectionStatus(),
                credentialPresent,
                authProbe,
                boards,
                orderProbe,
                Cafe24BoardArticleMapper.REVIEW_BOARD_NO,
                Cafe24BoardArticleMapper.PRODUCT_INQUIRY_BOARD_NO);
    }

    private OrderProbe latestOrderOutcome(UUID orgId, UUID sellerAccountId) {
        Optional<SyncJob> latest = syncJobs
                .findFirstByOrgIdAndSellerAccountIdAndDataTypeOrderByCreatedAtDesc(
                        orgId, sellerAccountId, ORDER_SUMMARY);
        if (latest.isEmpty()) {
            return OrderProbe.NONE;
        }
        String status = latest.get().getStatus();
        if ("SUCCESS".equals(status) || "PARTIAL".equals(status)) {
            return OrderProbe.OK;
        }
        if ("RUNNING".equals(status)) {
            return OrderProbe.RUNNING;
        }
        return OrderProbe.FAILED;
    }

    private boolean isCafe24(UUID channelId) {
        if (channelId == null) {
            return false;
        }
        return channels.findById(channelId)
                .map(Channel::getCode)
                .filter(CHANNEL_CODE::equals)
                .isPresent();
    }
}
