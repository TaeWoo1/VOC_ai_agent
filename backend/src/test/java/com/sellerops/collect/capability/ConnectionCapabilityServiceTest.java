package com.sellerops.collect.capability;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.common.ApiException;
import com.sellerops.credential.CredentialVault;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncJob;
import com.sellerops.sync.SyncJobRepository;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** Unit tests of the capability service wiring: org-scoped fail-closed resolution + persisted-fact mapping. */
class ConnectionCapabilityServiceTest {

    private final SellerAccountRepository accounts = mock(SellerAccountRepository.class);
    private final ChannelRepository channels = mock(ChannelRepository.class);
    private final CredentialVault vault = mock(CredentialVault.class);
    private final SyncJobRepository syncJobs = mock(SyncJobRepository.class);

    private final ConnectionCapabilityService service =
            new ConnectionCapabilityService(accounts, channels, vault, syncJobs);

    private final UUID orgId = UUID.randomUUID();
    private final UUID accountId = UUID.randomUUID();
    private final UUID channelId = UUID.randomUUID();

    /**
     * Build + register the account mock as this org's account. Registration happens here (not inline
     * inside a {@code thenReturn(Optional.of(naverAccount(...)))}) so we never start a nested stub
     * while {@code findByIdAndOrgId} is still being stubbed (Mockito UnfinishedStubbing).
     */
    private SellerAccount registerNaverAccount(boolean fileUpload) {
        SellerAccount account = mock(SellerAccount.class);
        when(account.getChannelId()).thenReturn(channelId);
        when(account.getConnectionStatus()).thenReturn(ChannelStatus.CONNECTED);
        when(account.isFileUpload()).thenReturn(fileUpload);
        when(accounts.findByIdAndOrgId(accountId, orgId)).thenReturn(Optional.of(account));
        return account;
    }

    private void stubChannel(String code) {
        Channel channel = mock(Channel.class);
        when(channel.getCode()).thenReturn(code);
        when(channels.findById(channelId)).thenReturn(Optional.of(channel));
    }

    private void stubOrderSync(String status) {
        SyncJob job = mock(SyncJob.class);
        when(job.getStatus()).thenReturn(status);
        when(syncJobs.findFirstByOrgIdAndSellerAccountIdAndDataTypeOrderByCreatedAtDesc(
                orgId, accountId, "ORDER_SUMMARY")).thenReturn(Optional.of(job));
    }

    @Test
    void missingOrForeignAccountIsNotFound() {
        // A cross-org id reads as absent through the org-scoped query.
        when(accounts.findByIdAndOrgId(accountId, orgId)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.capability(orgId, accountId)).isInstanceOf(ApiException.class);
    }

    @Test
    void nonNaverChannelIsNotFound() {
        registerNaverAccount(false);
        stubChannel("CAFE24");
        assertThatThrownBy(() -> service.capability(orgId, accountId)).isInstanceOf(ApiException.class);
    }

    @Test
    void fileUploadAccountIsNotFound() {
        registerNaverAccount(true);
        stubChannel("NAVER");
        assertThatThrownBy(() -> service.capability(orgId, accountId)).isInstanceOf(ApiException.class);
    }

    @Test
    void happyPathConfirmsIdentityFromSuccessfulSync() {
        registerNaverAccount(false);
        stubChannel("NAVER");
        when(vault.hasCredential(orgId, accountId)).thenReturn(true);
        stubOrderSync("SUCCESS");

        ConnectionCapabilityView view = service.capability(orgId, accountId);

        assertThat(view.identityConfirmed()).isTrue();
        assertThat(view.overall()).isEqualTo(NaverCapabilityEvaluator.AVAILABLE);
        assertThat(view.channelCode()).isEqualTo("NAVER");
        assertThat(view.sellerAccountId()).isEqualTo(accountId);
        assertThat(view.firstSyncStatus()).isEqualTo(NaverCapabilityEvaluator.SYNC_STATUS_SUCCESS);
    }

    @Test
    void noSyncHistoryReportsFirstSyncRequired() {
        registerNaverAccount(false);
        stubChannel("NAVER");
        when(vault.hasCredential(orgId, accountId)).thenReturn(true);
        when(syncJobs.findFirstByOrgIdAndSellerAccountIdAndDataTypeOrderByCreatedAtDesc(
                orgId, accountId, "ORDER_SUMMARY")).thenReturn(Optional.empty());

        ConnectionCapabilityView view = service.capability(orgId, accountId);

        assertThat(view.identityConfirmed()).isFalse();
        assertThat(view.reason()).isEqualTo(NaverCapabilityEvaluator.REASON_FIRST_SYNC_REQUIRED);
        assertThat(view.firstSyncStatus()).isEqualTo(NaverCapabilityEvaluator.SYNC_STATUS_NONE);
    }

    @Test
    void syncFailureIsSurfacedDistinctlyFromIdentity() {
        registerNaverAccount(false);
        stubChannel("NAVER");
        when(vault.hasCredential(orgId, accountId)).thenReturn(true);
        stubOrderSync("FAILED");

        ConnectionCapabilityView view = service.capability(orgId, accountId);

        assertThat(view.identityConfirmed()).isFalse();
        assertThat(view.reason()).isEqualTo(NaverCapabilityEvaluator.REASON_SYNC_FAILED);
        assertThat(view.firstSyncStatus()).isEqualTo(NaverCapabilityEvaluator.SYNC_STATUS_FAILED);
    }

    @Test
    void missingCredentialFailsClosed() {
        registerNaverAccount(false);
        stubChannel("NAVER");
        when(vault.hasCredential(orgId, accountId)).thenReturn(false);

        ConnectionCapabilityView view = service.capability(orgId, accountId);

        assertThat(view.credentialPresent()).isFalse();
        assertThat(view.identityConfirmed()).isFalse();
        assertThat(view.reason()).isEqualTo(NaverCapabilityEvaluator.REASON_CREDENTIAL_MISSING);
    }
}
