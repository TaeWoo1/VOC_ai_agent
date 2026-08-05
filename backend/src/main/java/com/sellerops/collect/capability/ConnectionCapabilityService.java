package com.sellerops.collect.capability;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.ApiException;
import com.sellerops.connector.naver.NaverApiConnector;
import com.sellerops.credential.CredentialVault;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncJob;
import com.sellerops.sync.SyncJobRepository;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * Read-only connection-capability check for the NAVER guided-connection wizard's capability-result
 * screen. Given an org + seller account it gathers a few PERSISTED facts — is a credential on file,
 * what is the account's connection status, and what was the latest {@code ORDER_SUMMARY} sync
 * outcome — and hands them to the pure {@link NaverCapabilityEvaluator}.
 *
 * <p><b>No live provider call.</b> Unlike the Cafe24 first-connection capability check (which
 * refreshes a token with single-use rotation), this reads only local/persisted state, so it is a
 * safe, idempotent, cacheable-free GET. Seller identity is therefore reported from a prior
 * successful sync, never a fresh whoami (NAVER exposes none).
 *
 * <p><b>Fail-closed + sanitized.</b> A missing/foreign account is a 404 (org-scoped query first).
 * A file-upload or non-NAVER account is a 404 — this endpoint currently serves the NAVER API guided
 * connection only. The returned view carries no token, id, order id, or personal data.
 */
@Component
public class ConnectionCapabilityService {

    private static final String ORDER_SUMMARY = "ORDER_SUMMARY";

    private final SellerAccountRepository accounts;
    private final ChannelRepository channels;
    private final CredentialVault vault;
    private final SyncJobRepository syncJobs;

    public ConnectionCapabilityService(SellerAccountRepository accounts, ChannelRepository channels,
                                       CredentialVault vault, SyncJobRepository syncJobs) {
        this.accounts = accounts;
        this.channels = channels;
        this.vault = vault;
        this.syncJobs = syncJobs;
    }

    /** Run the read-only capability check for one org-scoped NAVER account. */
    public ConnectionCapabilityView capability(UUID orgId, UUID sellerAccountId) {
        SellerAccount account = accounts.findByIdAndOrgId(sellerAccountId, orgId)
                .orElseThrow(() -> ApiException.notFound("연결 계정을 찾을 수 없습니다."));
        String channelCode = channels.findById(account.getChannelId())
                .map(Channel::getCode)
                .orElse(null);
        if (account.isFileUpload() || !NaverApiConnector.CHANNEL_CODE.equals(channelCode)) {
            // This endpoint currently serves the NAVER API guided connection only.
            throw ApiException.notFound("네이버 API 연결 계정이 아닙니다.");
        }

        boolean credentialPresent = vault.hasCredential(orgId, sellerAccountId);
        NaverCapabilityEvaluator.OrderSync orderSync = latestOrderSync(orgId, sellerAccountId);

        return NaverCapabilityEvaluator.evaluate(
                sellerAccountId, channelCode, account.getConnectionStatus(), credentialPresent, orderSync);
    }

    private NaverCapabilityEvaluator.OrderSync latestOrderSync(UUID orgId, UUID sellerAccountId) {
        Optional<SyncJob> latest = syncJobs
                .findFirstByOrgIdAndSellerAccountIdAndDataTypeOrderByCreatedAtDesc(
                        orgId, sellerAccountId, ORDER_SUMMARY);
        if (latest.isEmpty()) {
            return NaverCapabilityEvaluator.OrderSync.NONE;
        }
        String status = latest.get().getStatus();
        if ("SUCCESS".equals(status)) {
            return NaverCapabilityEvaluator.OrderSync.SUCCESS;
        }
        if ("PARTIAL".equals(status)) {
            return NaverCapabilityEvaluator.OrderSync.PARTIAL;
        }
        if ("RUNNING".equals(status)) {
            return NaverCapabilityEvaluator.OrderSync.RUNNING;
        }
        return NaverCapabilityEvaluator.OrderSync.FAILED;
    }
}
