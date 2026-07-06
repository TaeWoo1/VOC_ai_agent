package com.sellerops.inquiry.esmimport;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.common.ApiException;
import com.sellerops.credential.CredentialVault;
import com.sellerops.credential.DecryptedCredential;
import com.sellerops.inquiry.esmimport.dto.EsmFileImportAccountResponse;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * Provisioning file-import GMARKET accounts: create is always a new not-CONNECTED
 * account, identity-update requires an explicit valid account, both store only
 * marketplace selling ids (no secrets) and preserve the other marketplace key.
 */
@DataJpaTest
@ActiveProfiles("test")
class EsmFileImportAccountServiceTest {

    @Autowired SellerAccountRepository accounts;
    @Autowired ChannelRepository channels;

    private EsmFileImportAccountService service;
    private CredentialVault vault;
    private UUID channelId;
    private final UUID orgId = UUID.randomUUID();
    private final UUID actor = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        Channel gmarket = new Channel();
        gmarket.setCode("GMARKET");
        gmarket.setNameKo("G마켓/옥션");
        gmarket.setStatus(ChannelStatus.AVAILABLE);
        gmarket.setSupportsInquiry(true);
        channelId = channels.save(gmarket).getId();

        vault = mock(CredentialVault.class);
        lenient().when(vault.hasCredential(any(), any())).thenReturn(false);
        service = new EsmFileImportAccountService(accounts, channels, vault);
    }

    @SuppressWarnings("unchecked")
    private ArgumentCaptor<Map<String, String>> captureStore(UUID accountId) {
        ArgumentCaptor<Map<String, String>> secrets = ArgumentCaptor.forClass(Map.class);
        verify(vault).store(eq(orgId), eq(accountId), eq("FILE_IMPORT"), eq("NONE"),
                secrets.capture(), isNull(), isNull(), eq(actor));
        return secrets;
    }

    private SellerAccount gmarketFileImport() {
        SellerAccount a = new SellerAccount();
        a.setOrgId(orgId);
        a.setChannelId(channelId);
        a.setConnectionStatus(ChannelStatus.FILE_UPLOAD_SUPPORTED);
        a.setFileUpload(true);
        return accounts.save(a);
    }

    // ---- create ----------------------------------------------------------------

    @Test
    void createMakesANotConnectedFileImportAccountAndVaultsOnlyTheSellingId() {
        EsmFileImportAccountResponse resp = service.create(orgId, actor, EsmMarketplace.GMARKET, "내 G마켓", "1234567890");

        SellerAccount account = accounts.findById(resp.sellerAccountId()).orElseThrow();
        assertThat(account.getConnectionStatus()).isEqualTo(ChannelStatus.FILE_UPLOAD_SUPPORTED);
        assertThat(account.isFileUpload()).isTrue();
        assertThat(account.getLastSyncedAt()).isNull();
        assertThat(resp.idempotentReplay()).isFalse();                  // first creation
        assertThat(resp.sellerIdSha256Prefix()).isNotBlank().doesNotContain("1234567890");

        Map<String, String> stored = captureStore(account.getId()).getValue();
        assertThat(stored).containsOnlyKeys("gmarket_seller_id");
        assertThat(stored.get("gmarket_seller_id")).isEqualTo("1234567890");
    }

    @Test
    void exactCreateRetryReturnsSameAccountWithNoNewWrites() {
        SellerAccount existing = gmarketFileImport();
        when(vault.hasCredential(orgId, existing.getId())).thenReturn(true);
        when(vault.open(orgId, existing.getId())).thenReturn(new DecryptedCredential(
                "FILE_IMPORT", "NONE", Map.of("gmarket_seller_id", "1234567890"), null, null));

        EsmFileImportAccountResponse resp = service.create(orgId, actor, EsmMarketplace.GMARKET, "x", "1234567890");

        assertThat(resp.idempotentReplay()).isTrue();
        assertThat(resp.sellerAccountId()).isEqualTo(existing.getId());
        assertThat(accounts.findAllByOrgId(orgId)).hasSize(1);          // no new SellerAccount
        verify(vault, never()).store(any(), any(), any(), any(), any(), any(), any(), any()); // no new credential
    }

    @Test
    void sameMarketplaceDifferentSellerIdCreatesADistinctAccount() {
        SellerAccount existing = gmarketFileImport();
        when(vault.hasCredential(orgId, existing.getId())).thenReturn(true);
        when(vault.open(orgId, existing.getId())).thenReturn(new DecryptedCredential(
                "FILE_IMPORT", "NONE", Map.of("gmarket_seller_id", "1111111111"), null, null));

        EsmFileImportAccountResponse resp = service.create(orgId, actor, EsmMarketplace.GMARKET, "x", "2222222222");
        assertThat(resp.idempotentReplay()).isFalse();
        assertThat(resp.sellerAccountId()).isNotEqualTo(existing.getId());
        assertThat(accounts.findAllByOrgId(orgId)).hasSize(2);
    }

    @Test
    void sameSellerIdInAnotherOrgCreatesAnIndependentAccount() {
        SellerAccount existing = gmarketFileImport();                    // in orgId
        when(vault.hasCredential(orgId, existing.getId())).thenReturn(true);
        when(vault.open(orgId, existing.getId())).thenReturn(new DecryptedCredential(
                "FILE_IMPORT", "NONE", Map.of("gmarket_seller_id", "1234567890"), null, null));

        UUID otherOrg = UUID.randomUUID();
        EsmFileImportAccountResponse resp = service.create(otherOrg, actor, EsmMarketplace.GMARKET, "x", "1234567890");
        assertThat(resp.idempotentReplay()).isFalse();
        assertThat(accounts.findAllByOrgId(otherOrg)).hasSize(1);
        assertThat(accounts.findAllByOrgId(orgId)).hasSize(1);
    }

    @Test
    void gmarketCreateDoesNotMatchAnAuctionOnlyIdentity() {
        SellerAccount existing = gmarketFileImport();
        when(vault.hasCredential(orgId, existing.getId())).thenReturn(true);
        when(vault.open(orgId, existing.getId())).thenReturn(new DecryptedCredential(
                "FILE_IMPORT", "NONE", Map.of("auction_seller_id", "1234567890"), null, null));

        // Same value but the selected key (gmarket_seller_id) is absent → not a match.
        EsmFileImportAccountResponse resp = service.create(orgId, actor, EsmMarketplace.GMARKET, "x", "1234567890");
        assertThat(resp.idempotentReplay()).isFalse();
        assertThat(accounts.findAllByOrgId(orgId)).hasSize(2);
    }

    @Test
    void liveGmarketAccountWithTheSameSellerIdIsNeverReusedOrMutated() {
        SellerAccount live = new SellerAccount();
        live.setOrgId(orgId);
        live.setChannelId(channelId);
        live.setConnectionStatus(ChannelStatus.CONNECTED);
        live.setFileUpload(false);                                       // live API account
        UUID liveId = accounts.save(live).getId();
        // Even if its vault held the same seller id, a non-file-import account is never a match.
        lenient().when(vault.hasCredential(orgId, liveId)).thenReturn(true);
        lenient().when(vault.open(orgId, liveId)).thenReturn(new DecryptedCredential(
                "API", "JWT_HS256", Map.of("gmarket_seller_id", "1234567890"), null, null));

        EsmFileImportAccountResponse resp = service.create(orgId, actor, EsmMarketplace.GMARKET, "x", "1234567890");
        assertThat(resp.idempotentReplay()).isFalse();
        assertThat(resp.sellerAccountId()).isNotEqualTo(liveId);
        assertThat(accounts.findById(liveId).orElseThrow().isFileUpload()).isFalse();   // untouched
        assertThat(accounts.findAllByOrgId(orgId)).hasSize(2);
    }

    @Test
    void createDoesNotAlterAnExistingLiveGmarketAccountAndAllowsTwoAccounts() {
        SellerAccount live = new SellerAccount();
        live.setOrgId(orgId);
        live.setChannelId(channelId);
        live.setConnectionStatus(ChannelStatus.CONNECTED);
        live.setFileUpload(false);                       // a real API connection
        UUID liveId = accounts.save(live).getId();

        service.create(orgId, actor, EsmMarketplace.GMARKET, null, "1234567890");

        // The live account is untouched; both accounts coexist.
        SellerAccount stillLive = accounts.findById(liveId).orElseThrow();
        assertThat(stillLive.isFileUpload()).isFalse();
        assertThat(stillLive.getConnectionStatus()).isEqualTo(ChannelStatus.CONNECTED);
        assertThat(accounts.findAllByOrgId(orgId)).hasSize(2);
    }

    @Test
    void twoCreatesYieldTwoSeparateFileImportAccounts() {
        UUID a = service.create(orgId, actor, EsmMarketplace.GMARKET, "A", "1111111111").sellerAccountId();
        UUID b = service.create(orgId, actor, EsmMarketplace.GMARKET, "B", "2222222222").sellerAccountId();
        assertThat(a).isNotEqualTo(b);
        assertThat(accounts.findAllByOrgId(orgId)).hasSize(2);
    }

    @Test
    void createFailsClosedOnBlankSellerOrMissingMarketplace() {
        assertThatThrownBy(() -> service.create(orgId, actor, EsmMarketplace.GMARKET, null, "  "))
                .isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.create(orgId, actor, null, null, "1234567890"))
                .isInstanceOf(ApiException.class);
        assertThat(accounts.findAllByOrgId(orgId)).isEmpty();
    }

    // ---- updateIdentity --------------------------------------------------------

    @Test
    void updateIdentityRequiresAnExplicitAccountId() {
        assertThatThrownBy(() -> service.updateIdentity(orgId, actor, null, EsmMarketplace.GMARKET, "1234567890"))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void updateIdentityRejectsForeignOrgNonGmarketAndLiveAccounts() {
        // foreign org
        SellerAccount mine = gmarketFileImport();
        assertThatThrownBy(() -> service.updateIdentity(UUID.randomUUID(), actor, mine.getId(),
                EsmMarketplace.GMARKET, "1234567890")).isInstanceOf(ApiException.class);

        // non-GMARKET channel
        Channel other = new Channel();
        other.setCode("COUPANG");
        other.setNameKo("쿠팡");
        other.setStatus(ChannelStatus.AVAILABLE);
        UUID otherCh = channels.save(other).getId();
        SellerAccount nonGmarket = new SellerAccount();
        nonGmarket.setOrgId(orgId);
        nonGmarket.setChannelId(otherCh);
        nonGmarket.setConnectionStatus(ChannelStatus.FILE_UPLOAD_SUPPORTED);
        nonGmarket.setFileUpload(true);
        UUID nonGmarketId = accounts.save(nonGmarket).getId();
        assertThatThrownBy(() -> service.updateIdentity(orgId, actor, nonGmarketId,
                EsmMarketplace.GMARKET, "1234567890")).isInstanceOf(ApiException.class);

        // live (non-fileUpload) GMARKET account
        SellerAccount live = new SellerAccount();
        live.setOrgId(orgId);
        live.setChannelId(channelId);
        live.setConnectionStatus(ChannelStatus.CONNECTED);
        live.setFileUpload(false);
        UUID liveId = accounts.save(live).getId();
        assertThatThrownBy(() -> service.updateIdentity(orgId, actor, liveId,
                EsmMarketplace.GMARKET, "1234567890")).isInstanceOf(ApiException.class);
    }

    @Test
    void addingAuctionPreservesExistingGmarketIdentity() {
        SellerAccount account = gmarketFileImport();
        when(vault.hasCredential(orgId, account.getId())).thenReturn(true);
        when(vault.open(orgId, account.getId())).thenReturn(new DecryptedCredential(
                "FILE_IMPORT", "NONE", Map.of("gmarket_seller_id", "GID10"), null, null));

        service.updateIdentity(orgId, actor, account.getId(), EsmMarketplace.AUCTION, "AID20");

        Map<String, String> stored = captureStore(account.getId()).getValue();
        assertThat(stored).containsOnlyKeys("gmarket_seller_id", "auction_seller_id");
        assertThat(stored.get("gmarket_seller_id")).isEqualTo("GID10");
        assertThat(stored.get("auction_seller_id")).isEqualTo("AID20");
    }

    @Test
    void updatingGmarketPreservesExistingAuctionIdentity() {
        SellerAccount account = gmarketFileImport();
        when(vault.hasCredential(orgId, account.getId())).thenReturn(true);
        when(vault.open(orgId, account.getId())).thenReturn(new DecryptedCredential(
                "FILE_IMPORT", "NONE", Map.of("auction_seller_id", "AID20"), null, null));

        service.updateIdentity(orgId, actor, account.getId(), EsmMarketplace.GMARKET, "GID10");

        Map<String, String> stored = captureStore(account.getId()).getValue();
        assertThat(stored).containsOnlyKeys("gmarket_seller_id", "auction_seller_id");
        assertThat(stored.get("gmarket_seller_id")).isEqualTo("GID10");
        assertThat(stored.get("auction_seller_id")).isEqualTo("AID20");
    }

    @Test
    void identityUpdateIsIdempotentPerAccount() {
        SellerAccount account = gmarketFileImport();
        service.updateIdentity(orgId, actor, account.getId(), EsmMarketplace.GMARKET, "1234567890");
        service.updateIdentity(orgId, actor, account.getId(), EsmMarketplace.GMARKET, "1234567890");
        // No duplicate account row (vault upserts one credential row per account by design).
        assertThat(accounts.findAllByOrgId(orgId)).hasSize(1);
    }
}
