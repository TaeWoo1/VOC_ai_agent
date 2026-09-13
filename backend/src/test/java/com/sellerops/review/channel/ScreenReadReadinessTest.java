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
import com.sellerops.selleraccount.AccountSessionSlot;
import com.sellerops.selleraccount.AccountSessionSlotRepository;
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
    private final ChannelReviewAcquisitionRefRepository refs = mock(ChannelReviewAcquisitionRefRepository.class);
    private final CredentialVault vault = mock(CredentialVault.class);
    private final ChannelReviewAcquisitionService service =
            new ChannelReviewAcquisitionService(accounts, channels, slots, refs, vault);

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
        when(slots.findBySellerAccountId(a.getId())).thenReturn(Optional.empty());
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

        when(slots.findBySellerAccountId(a.getId())).thenReturn(Optional.of(new AccountSessionSlot()));
        // Linked, and still not startable: we cannot say which store this account is.
        assertThat(service.readiness(ORG, a.getId()).state()).isEqualTo("STORE_IDENTITY_UNKNOWN");
        assertThatThrownBy(() -> service.mint(ORG, a.getId(), UUID.randomUUID()))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("어느 스토어인지 대조할 수 없습니다");
        verify(refs, never()).save(any());
    }

    @Test
    @DisplayName("a channel with no screen read refuses both the read's verdict and the press")
    void unsupportedChannelIsRefusedBothWays() {
        Channel naver = channel("NAVER");
        SellerAccount a = account(naver, false);
        when(accounts.findByIdAndOrgId(a.getId(), ORG)).thenReturn(Optional.of(a));
        when(channels.findById(naver.getId())).thenReturn(Optional.of(naver));
        when(slots.findBySellerAccountId(a.getId())).thenReturn(Optional.of(new AccountSessionSlot()));
        when(vault.open(ORG, a.getId())).thenThrow(new IllegalStateException("no key"));

        assertThat(service.readiness(ORG, a.getId()).state()).isEqualTo("CHANNEL_NOT_SUPPORTED");
        assertThatThrownBy(() -> service.mint(ORG, a.getId(), UUID.randomUUID()))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("화면에서 상품평을 가져오는 기능이 없습니다");
        verify(refs, never()).save(any());
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
