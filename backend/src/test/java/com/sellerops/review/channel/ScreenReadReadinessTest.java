package com.sellerops.review.channel;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.ApiException;
import com.sellerops.credential.CredentialVault;
import com.sellerops.review.channel.dto.StoreIdentityRequest;
import com.sellerops.auth.device.HelperDeviceRepository;
import com.sellerops.selleraccount.AccountSessionSlotRepository;
import com.sellerops.selleraccount.AccountSessionSlotService;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * <b>지금 동기화 can say what is wrong before it is pressed — and says exactly what the press would.</b>
 *
 * <p>The three preconditions lived inside {@code mint} as a throwing sequence. They were right there and
 * could not be asked: a seller learned 「도우미에 연결되지 않았습니다」 by pressing a button and getting a
 * 409. The repair is not a second rule for the screen — a second statement of one rule is the one that
 * goes stale — so both callers ask {@link ChannelReviewAcquisitionService#readinessOf} and these tests
 * assert that the read and the press cannot disagree.
 *
 * <p><b>Nothing here can say whether the marketplace is logged in.</b> That costs a marketplace request,
 * and a panel that made one on every render would spend the seller's session to decorate a screen.
 * {@code READY} means 「시작할 수 있습니다」, never 「성공할 것입니다」.
 */
class ScreenReadReadinessTest {

    private static final UUID ORG = UUID.randomUUID();

    private final SellerAccountRepository accounts = mock(SellerAccountRepository.class);
    private final ChannelRepository channels = mock(ChannelRepository.class);
    private final AccountSessionSlotRepository slots = mock(AccountSessionSlotRepository.class);
    private final AccountSessionSlotService slotService = mock(AccountSessionSlotService.class);
    private final HelperDeviceRepository helperDevices = mock(HelperDeviceRepository.class);
    private final ChannelReviewAcquisitionRefRepository refs = mock(ChannelReviewAcquisitionRefRepository.class);
    private final CredentialVault vault = mock(CredentialVault.class);
    /** The unattended lane is off here, which is its shipped value — these tests are about the pressed one. */
    private final ChannelReviewAcquisitionService service =
            new ChannelReviewAcquisitionService(accounts, channels, slots, slotService, helperDevices, refs, vault,
                    new com.sellerops.responsibility.aside.AsideMarketplaceAccess(false, java.util.Set.of(),
                            java.util.Set.of()));

    /** The one fact the third condition reads: is a helper linked to this reviewnary account. */
    private void helperLinked(boolean linked) {
        when(helperDevices.existsByOrgIdAndRevokedAtIsNull(ORG)).thenReturn(linked);
    }

    private static Channel channel(String code) {
        Channel c = new Channel();
        c.setId(UUID.randomUUID());
        c.setCode(code);
        return c;
    }

    private static SellerAccount account(Channel channel, boolean fileUpload) {
        SellerAccount a = new SellerAccount();
        a.setId(UUID.randomUUID());
        a.setOrgId(ORG);
        a.setChannelId(channel.getId());
        a.setFileUpload(fileUpload);
        return a;
    }

    @Test
    @DisplayName("the rule is one function: channel, account kind, helper link, then whether we can say which store this is")
    void theRuleIsOneFunction() {
        Channel coupang = channel("COUPANG");
        assertThat(ChannelReviewAcquisitionService.readinessOf(account(coupang, false), coupang, true, true))
                .isEqualTo(ScreenReadReadiness.READY);
        assertThat(ChannelReviewAcquisitionService.readinessOf(account(coupang, false), coupang, false, true))
                .isEqualTo(ScreenReadReadiness.HELPER_NOT_LINKED);
        assertThat(ChannelReviewAcquisitionService.readinessOf(account(coupang, true), coupang, true, true))
                .isEqualTo(ScreenReadReadiness.FILE_UPLOAD_ACCOUNT);

        // Observed live 2026-09-14: with no expectation the run reaches the marketplace, reads the store
        // label successfully, and stops at UNRESOLVED / NO_EXPECTATION — telling the seller to check a
        // screen that was never the problem. It is knowable here, before the press.
        assertThat(ChannelReviewAcquisitionService.readinessOf(account(coupang, false), coupang, true, false))
                .isEqualTo(ScreenReadReadiness.STORE_IDENTITY_UNKNOWN);

        // Cafe24 has an API and NAVER's path is an export — neither has a screen read, and the channel
        // is asked FIRST so a file-upload NAVER account is not told it is the file upload that stops it.
        for (String code : new String[] {"NAVER", "CAFE24", "GMARKET"}) {
            Channel other = channel(code);
            assertThat(ChannelReviewAcquisitionService.readinessOf(account(other, true), other, false, false))
                    .isEqualTo(ScreenReadReadiness.CHANNEL_NOT_SUPPORTED);
        }
    }

    @Test
    @DisplayName("the read reports what the press would refuse, and mints nothing doing it")
    void theReadAgreesWithThePress() {
        Channel coupang = channel("COUPANG");
        SellerAccount a = account(coupang, false);
        when(accounts.findByIdAndOrgId(a.getId(), ORG)).thenReturn(Optional.of(a));
        when(channels.findById(coupang.getId())).thenReturn(Optional.of(coupang));
        helperLinked(false);
        // A vault that cannot be opened is exactly the live condition of 2026-09-14 — and it is not what
        // this account is missing FIRST, which is the point of asking the conditions in one order.
        when(vault.open(ORG, a.getId())).thenThrow(new IllegalStateException("no key"));

        assertThat(service.readiness(ORG, a.getId()).state()).isEqualTo("HELPER_NOT_LINKED");
        assertThat(service.readiness(ORG, a.getId()).channelCode()).isEqualTo("COUPANG");
        assertThatThrownBy(() -> service.mint(ORG, a.getId(), UUID.randomUUID()))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("도우미에 연결되지 않아");
        // A refused press spends nothing, and a readiness read never mints even when it answers READY.
        verify(refs, never()).save(any());

        helperLinked(true);
        // Linked, and the read still says truthfully that we cannot name the store...
        assertThat(service.readiness(ORG, a.getId()).state()).isEqualTo("STORE_IDENTITY_UNKNOWN");
        // ...but the press is NOT refused, because that run is how the store gets established. It reads
        // the identity off the seller's open screen and drops every row unread, so it can collect nothing.
        // Refusing here would make the bootstrap circular.
        when(refs.save(any())).thenAnswer(inv -> inv.getArgument(0));
        assertThat(service.mint(ORG, a.getId(), UUID.randomUUID()).acquisitionRef()).isNotBlank();
    }

    /**
     * <b>The dead end, named and closed.</b>
     *
     * <p>A seller who linked their helper and did nothing else has no session slot — a slot is minted on
     * first use by whoever first needs one. The readiness gate used to read that absence as «no helper»,
     * so it refused the only press that would ever have produced a slot, under a sentence telling the
     * seller to connect a helper their own card said was connected. Live on 2026-09-14, on a fresh
     * browser-only account.
     */
    @Test
    @DisplayName("a linked helper with no session slot is READY, and the press mints the slot the run needs")
    void aLinkedHelperWithNoSlotIsNotADeadEnd() {
        Channel coupang = channel("COUPANG");
        SellerAccount a = account(coupang, false);
        a.setStoreIdentity("A00123456");
        when(accounts.findByIdAndOrgId(a.getId(), ORG)).thenReturn(Optional.of(a));
        when(channels.findById(coupang.getId())).thenReturn(Optional.of(coupang));
        helperLinked(true);
        // No slot anywhere — the state this gate used to read as «no helper».
        when(slots.findBySellerAccountId(a.getId())).thenReturn(Optional.empty());
        when(refs.save(any())).thenAnswer(inv -> inv.getArgument(0));

        assertThat(service.readiness(ORG, a.getId()).state()).isEqualTo("READY");
        assertThat(service.mint(ORG, a.getId(), UUID.randomUUID()).acquisitionRef()).isNotBlank();
        // …and the run can hand its reading somewhere: the slot is created by the press that needs it,
        // find-or-create, rather than demanded before it.
        verify(slotService).resolveSlot(ORG, a.getId(), coupang.getId());
    }

    /** The read still mints nothing — only the press does. */
    @Test
    @DisplayName("a readiness read never mints a session slot")
    void theReadMintsNoSlot() {
        Channel coupang = channel("COUPANG");
        SellerAccount a = account(coupang, false);
        a.setStoreIdentity("A00123456");
        when(accounts.findByIdAndOrgId(a.getId(), ORG)).thenReturn(Optional.of(a));
        when(channels.findById(coupang.getId())).thenReturn(Optional.of(coupang));
        helperLinked(true);

        assertThat(service.readiness(ORG, a.getId()).state()).isEqualTo("READY");
        verify(slotService, never()).resolveSlot(any(), any(), any());
    }

    @Test
    @DisplayName("a channel with no screen read refuses both the read's verdict and the press")
    void unsupportedChannelIsRefusedBothWays() {
        Channel naver = channel("NAVER");
        SellerAccount a = account(naver, false);
        when(accounts.findByIdAndOrgId(a.getId(), ORG)).thenReturn(Optional.of(a));
        when(channels.findById(naver.getId())).thenReturn(Optional.of(naver));
        helperLinked(true);
        when(vault.open(ORG, a.getId())).thenThrow(new IllegalStateException("no key"));

        assertThat(service.readiness(ORG, a.getId()).state()).isEqualTo("CHANNEL_NOT_SUPPORTED");
        assertThatThrownBy(() -> service.mint(ORG, a.getId(), UUID.randomUUID()))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("화면에서 상품평을 가져오는 기능이 없습니다");
        verify(refs, never()).save(any());
    }

    /**
     * <b>업체코드 is not an API key, and this is where the product stops treating them as one thing.</b>
     *
     * <p>The only form carrying a vendor code was the OpenAPI credential form, whose three fields are all
     * required — so a seller who wanted browser collection had to obtain API keys to tell us their store
     * code. The store identity now lives on the account, and an account that has one is ready with no
     * credential at all.
     */
    @Test
    @DisplayName("a browser-only account is READY from its store identity alone — no vault, no API keys")
    void storeIdentityAloneIsEnough() {
        Channel coupang = channel("COUPANG");
        SellerAccount a = account(coupang, false);
        when(accounts.findByIdAndOrgId(a.getId(), ORG)).thenReturn(Optional.of(a));
        when(channels.findById(coupang.getId())).thenReturn(Optional.of(coupang));
        helperLinked(true);
        // No credential anywhere: opening the vault throws, exactly as it does for an account that never
        // registered one.
        when(vault.open(ORG, a.getId())).thenThrow(new IllegalStateException("no credential"));

        assertThat(service.readiness(ORG, a.getId()).state()).isEqualTo("STORE_IDENTITY_UNKNOWN");

        assertThat(service.setStoreIdentity(ORG, a.getId(), new StoreIdentityRequest("A00123456")).state())
                .isEqualTo("READY");
        assertThat(a.getStoreIdentity()).isEqualTo("A00123456");
        assertThat(service.readiness(ORG, a.getId()).state()).isEqualTo("READY");
    }

    @Test
    @DisplayName("the account's own identity is preferred; the credential stays the fallback for accounts that predate it")
    void accountIdentityWinsAndTheVaultRemainsTheFallback() {
        Channel coupang = channel("COUPANG");
        SellerAccount a = account(coupang, false);
        when(accounts.findByIdAndOrgId(a.getId(), ORG)).thenReturn(Optional.of(a));
        when(channels.findById(coupang.getId())).thenReturn(Optional.of(coupang));
        helperLinked(true);
        when(vault.open(ORG, a.getId())).thenThrow(new IllegalStateException("not opened"));

        a.setStoreIdentity("A00123456");
        assertThat(service.readiness(ORG, a.getId()).state()).isEqualTo("READY");
        // The account answered, so the vault was never asked — an account that declares its own store
        // does not need a credential to be opened on every render.
        verify(vault, never()).open(ORG, a.getId());
    }

    @Test
    @DisplayName("a store identity is refused when blank or pasted with whitespace, and on a channel with no screen read")
    void storeIdentityIsValidatedWithoutInventingAFormat() {
        Channel coupang = channel("COUPANG");
        SellerAccount a = account(coupang, false);
        when(accounts.findByIdAndOrgId(a.getId(), ORG)).thenReturn(Optional.of(a));
        when(channels.findById(coupang.getId())).thenReturn(Optional.of(coupang));
        helperLinked(true);

        assertThatThrownBy(() -> service.setStoreIdentity(ORG, a.getId(), new StoreIdentityRequest("   ")))
                .isInstanceOf(ApiException.class).hasMessageContaining("업체코드를 입력");
        assertThatThrownBy(() -> service.setStoreIdentity(ORG, a.getId(), new StoreIdentityRequest("A001 23456")))
                .isInstanceOf(ApiException.class).hasMessageContaining("공백");
        // No format rule is invented — a wrong-but-well-formed code is accepted here and fails closed at
        // the identity check, which is where the screen can actually be compared.
        assertThat(service.setStoreIdentity(ORG, a.getId(), new StoreIdentityRequest(" A99999999 ")).state())
                .isEqualTo("READY");
        assertThat(a.getStoreIdentity()).isEqualTo("A99999999");

        Channel naver = channel("NAVER");
        SellerAccount n = account(naver, false);
        when(accounts.findByIdAndOrgId(n.getId(), ORG)).thenReturn(Optional.of(n));
        when(channels.findById(naver.getId())).thenReturn(Optional.of(naver));
        assertThatThrownBy(() -> service.setStoreIdentity(ORG, n.getId(), new StoreIdentityRequest("X1")))
                .isInstanceOf(ApiException.class).hasMessageContaining("화면에서 상품평을 가져오는 기능이 없습니다");
    }

    @Test
    @DisplayName("another org's account is not found — readiness is not a way to probe for accounts")
    void otherOrgsAccountIsNotFound() {
        UUID unknown = UUID.randomUUID();
        when(accounts.findByIdAndOrgId(unknown, ORG)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.readiness(ORG, unknown))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("판매 계정을 찾을 수 없습니다");
    }
}
