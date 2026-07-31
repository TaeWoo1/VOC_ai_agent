package com.sellerops.connector.cafe24;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.common.ApiException;
import com.sellerops.connector.cafe24.Cafe24BoardClassifier.BoardKind;
import com.sellerops.connector.cafe24.Cafe24BoardDiscovery.ClassifiedBoard;
import com.sellerops.connector.cafe24.capability.Cafe24CapabilityEvaluator;
import com.sellerops.connector.cafe24.capability.Cafe24ConnectionCapabilityView;
import com.sellerops.credential.CredentialVault;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncJob;
import com.sellerops.sync.SyncJobRepository;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** Unit tests of the capability service wiring (fail-closed resolution + sanitized probe mapping). */
class Cafe24ConnectionCapabilityServiceTest {

    private final SellerAccountRepository accounts = mock(SellerAccountRepository.class);
    private final ChannelRepository channels = mock(ChannelRepository.class);
    private final CredentialVault vault = mock(CredentialVault.class);
    private final Cafe24Authorizer authorizer = mock(Cafe24Authorizer.class);
    private final Cafe24BoardDiscovery discovery = mock(Cafe24BoardDiscovery.class);
    private final SyncJobRepository syncJobs = mock(SyncJobRepository.class);

    private final Cafe24ConnectionCapabilityService service =
            new Cafe24ConnectionCapabilityService(accounts, channels, vault, authorizer, discovery, syncJobs);

    private final UUID orgId = UUID.randomUUID();
    private final UUID accountId = UUID.randomUUID();
    private final UUID channelId = UUID.randomUUID();

    private SellerAccount cafe24Account(ChannelStatus status, boolean fileUpload) {
        SellerAccount account = mock(SellerAccount.class);
        when(account.getChannelId()).thenReturn(channelId);
        when(account.getConnectionStatus()).thenReturn(status);
        when(account.isFileUpload()).thenReturn(fileUpload);
        return account;
    }

    private void stubCafe24Channel() {
        Channel channel = mock(Channel.class);
        when(channel.getCode()).thenReturn("CAFE24");
        when(channels.findById(channelId)).thenReturn(Optional.of(channel));
    }

    private void stubMappedBoards() {
        Cafe24BoardDiscovery.Result result = new Cafe24BoardDiscovery.Result(List.of(
                new ClassifiedBoard(4, "구매후기", "board", BoardKind.REVIEW_BEARING),
                new ClassifiedBoard(6, "문의사항", "board", BoardKind.INQUIRY_BEARING)), Map.of());
        when(discovery.discover(any(), any())).thenReturn(result);
    }

    private void stubOrderSync(String status) {
        SyncJob job = mock(SyncJob.class);
        when(job.getStatus()).thenReturn(status);
        when(syncJobs.findFirstByOrgIdAndSellerAccountIdAndDataTypeOrderByCreatedAtDesc(
                orgId, accountId, "ORDER_SUMMARY")).thenReturn(Optional.of(job));
    }

    @Test
    void missingAccountIsNotFound() {
        when(accounts.findByIdAndOrgId(accountId, orgId)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.check(orgId, accountId))
                .isInstanceOf(ApiException.class);
        verify(authorizer, never()).authorize(any(), any());
    }

    @Test
    void nonCafe24ChannelIsNotFound() {
        SellerAccount account = cafe24Account(ChannelStatus.CONNECTED, false);
        when(accounts.findByIdAndOrgId(accountId, orgId)).thenReturn(Optional.of(account));
        Channel other = mock(Channel.class);
        when(other.getCode()).thenReturn("NAVER");
        when(channels.findById(channelId)).thenReturn(Optional.of(other));

        assertThatThrownBy(() -> service.check(orgId, accountId)).isInstanceOf(ApiException.class);
        verify(authorizer, never()).authorize(any(), any());
    }

    @Test
    void fileUploadAccountIsNotFound() {
        SellerAccount account = cafe24Account(ChannelStatus.CONNECTED, true);
        when(accounts.findByIdAndOrgId(accountId, orgId)).thenReturn(Optional.of(account));
        stubCafe24Channel();

        assertThatThrownBy(() -> service.check(orgId, accountId)).isInstanceOf(ApiException.class);
        verify(authorizer, never()).authorize(any(), any());
    }

    @Test
    void happyPathIsVerified() {
        SellerAccount account = cafe24Account(ChannelStatus.CONNECTED, false);
        when(accounts.findByIdAndOrgId(accountId, orgId)).thenReturn(Optional.of(account));
        stubCafe24Channel();
        when(vault.hasCredential(orgId, accountId)).thenReturn(true);
        when(authorizer.authorize(orgId, accountId))
                .thenReturn(new Cafe24Authorizer.Authorized("teststore", "access-token"));
        stubMappedBoards();
        stubOrderSync("SUCCESS");

        Cafe24ConnectionCapabilityView view = service.check(orgId, accountId);

        assertThat(view.connectionVerified()).isTrue();
        assertThat(view.overall()).isEqualTo(Cafe24CapabilityEvaluator.AVAILABLE);
        assertThat(view.credentialDecryptable()).isTrue();
        assertThat(view.sellerAccountId()).isEqualTo(accountId);
    }

    @Test
    void rateLimitedProbeIsProviderErrorAndSkipsDiscovery() {
        SellerAccount account = cafe24Account(ChannelStatus.CONNECTED, false);
        when(accounts.findByIdAndOrgId(accountId, orgId)).thenReturn(Optional.of(account));
        stubCafe24Channel();
        when(vault.hasCredential(orgId, accountId)).thenReturn(true);
        when(authorizer.authorize(orgId, accountId)).thenThrow(new Cafe24RateLimitedException(30));

        Cafe24ConnectionCapabilityView view = service.check(orgId, accountId);

        assertThat(view.reason()).isEqualTo(Cafe24CapabilityEvaluator.REASON_PROVIDER_ERROR);
        assertThat(view.credentialDecryptable()).isFalse();
        verify(discovery, never()).discover(any(), any());
    }

    @Test
    void authorizeFailureAsksToReconnectAndDoesNotLeakMessage() {
        SellerAccount account = cafe24Account(ChannelStatus.CONNECTED, false);
        when(accounts.findByIdAndOrgId(accountId, orgId)).thenReturn(Optional.of(account));
        stubCafe24Channel();
        when(vault.hasCredential(orgId, accountId)).thenReturn(true);
        // A message that would be a leak if propagated (mall id + token-like string).
        String leaky = "mall_id=secretstore refresh_token=RT-ABC123";
        when(authorizer.authorize(orgId, accountId)).thenThrow(new IllegalStateException(leaky));

        Cafe24ConnectionCapabilityView view = service.check(orgId, accountId);

        assertThat(view.reason()).isEqualTo(Cafe24CapabilityEvaluator.REASON_RECONNECT_REQUIRED);
        assertThat(view.credentialDecryptable()).isFalse();
        // The exception detail must appear nowhere in the sanitized view.
        assertThat(view.toString()).doesNotContain("secretstore").doesNotContain("RT-ABC123");
    }

    @Test
    void pendingConnectionSkipsLiveProbe() {
        SellerAccount account = cafe24Account(ChannelStatus.PENDING, false);
        when(accounts.findByIdAndOrgId(accountId, orgId)).thenReturn(Optional.of(account));
        stubCafe24Channel();
        when(vault.hasCredential(orgId, accountId)).thenReturn(true);

        Cafe24ConnectionCapabilityView view = service.check(orgId, accountId);

        assertThat(view.reason()).isEqualTo(Cafe24CapabilityEvaluator.REASON_CONNECTION_INCOMPLETE);
        verify(authorizer, never()).authorize(any(), any());
    }

    @Test
    void missingCredentialSkipsLiveProbe() {
        SellerAccount account = cafe24Account(ChannelStatus.CONNECTED, false);
        when(accounts.findByIdAndOrgId(accountId, orgId)).thenReturn(Optional.of(account));
        stubCafe24Channel();
        when(vault.hasCredential(orgId, accountId)).thenReturn(false);

        Cafe24ConnectionCapabilityView view = service.check(orgId, accountId);

        assertThat(view.reason()).isEqualTo(Cafe24CapabilityEvaluator.REASON_CREDENTIAL_MISSING);
        verify(authorizer, never()).authorize(any(), any());
    }

    @Test
    void orderSyncFailureIsReported() {
        SellerAccount account = cafe24Account(ChannelStatus.CONNECTED, false);
        when(accounts.findByIdAndOrgId(accountId, orgId)).thenReturn(Optional.of(account));
        stubCafe24Channel();
        when(vault.hasCredential(orgId, accountId)).thenReturn(true);
        when(authorizer.authorize(orgId, accountId))
                .thenReturn(new Cafe24Authorizer.Authorized("teststore", "access-token"));
        stubMappedBoards();
        stubOrderSync("FAILED");

        Cafe24ConnectionCapabilityView view = service.check(orgId, accountId);

        String orderReason = view.features().stream()
                .filter(f -> f.feature().equals(Cafe24CapabilityEvaluator.FEATURE_ORDER))
                .findFirst().orElseThrow().reason();
        assertThat(orderReason).isEqualTo(Cafe24CapabilityEvaluator.REASON_SYNC_FAILED);
    }
}
