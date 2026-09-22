package com.sellerops.operations;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.sellerops.attention.OperatorAttentionService;
import com.sellerops.attention.dto.OperatorReplyWorkView;
import com.sellerops.attention.dto.OperatorVocItem;
import com.sellerops.auth.AuthPrincipal;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.operations.dto.OperationsHomeView;
import com.sellerops.operations.dto.ReviewWorkView;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * <b>확인할 일's review half holds every review the seller still owes something — and nothing 실행 대기 owns.</b>
 * (UI/UX v2 Phase 3.) The items used to be reachable only from the 리뷰 screen's 「내 답변 작업」.
 */
class ReviewWorkControllerTest {

    private final UUID org = UUID.randomUUID();
    private final OperationsHomeService home = mock(OperationsHomeService.class);
    private final OperatorAttentionService attention = mock(OperatorAttentionService.class);
    private final SellerAccountRepository accounts = mock(SellerAccountRepository.class);
    private final ChannelRepository channels = mock(ChannelRepository.class);
    private final ReviewWorkController controller = new ReviewWorkController(home, attention, accounts, channels);

    @Test
    void keepsDraftNeededAndAwaitingApproval_leavesApprovedTo실행대기() {
        Channel naver = channel("NAVER");
        SellerAccount acc = account(naver);
        when(channels.findAll()).thenReturn(List.of(naver));
        when(accounts.findAllByOrgId(org)).thenReturn(List.of(acc));
        when(attention.replyWork(eq(org), eq(acc.getId()), anyInt(), anyInt())).thenReturn(new OperatorReplyWorkView(
                acc.getId(), "네이버", null,
                List.of(item("r1", "DRAFT_NEEDED"), item("r2", "AWAITING_APPROVAL"), item("r3", "APPROVED")),
                List.of()));
        when(home.undecidedAttention(eq(org), anyInt())).thenReturn(List.of());

        ReviewWorkView view = controller.reviewWork(principal());

        assertThat(view.committed()).hasSize(1);
        assertThat(view.committed().get(0).todo()).extracting(OperatorVocItem::reviewId).containsExactly("r1", "r2");
    }

    @Test
    void asksOnlyAccountsWhoseChannelHasAReplyFlow() {
        Channel coupang = channel("COUPANG");
        SellerAccount acc = account(coupang);
        when(channels.findAll()).thenReturn(List.of(coupang));
        when(accounts.findAllByOrgId(org)).thenReturn(List.of(acc));
        when(home.undecidedAttention(eq(org), anyInt())).thenReturn(List.of());

        assertThat(controller.reviewWork(principal()).committed()).isEmpty();
        verify(attention, never()).replyWork(any(), any(), anyInt(), anyInt());
    }

    @Test
    void carriesEveryUndecidedAttentionReview_notTheHomesThree() {
        when(channels.findAll()).thenReturn(List.of());
        when(accounts.findAllByOrgId(org)).thenReturn(List.of());
        List<OperationsHomeView.AttentionReview> eleven = java.util.stream.IntStream.range(0, 11)
                .mapToObj(i -> new OperationsHomeView.AttentionReview(UUID.randomUUID(), null, "NAVER", 1,
                        LocalDate.of(2026, 9, 1), "상품", "불만"))
                .toList();
        when(home.undecidedAttention(org, ReviewWorkController.MAX_ATTENTION)).thenReturn(eleven);
        when(home.undecidedAttentionCount(org)).thenReturn(11L);

        ReviewWorkView view = controller.reviewWork(principal());
        assertThat(view.attention()).hasSize(11);
        assertThat(view.attentionTotal()).isEqualTo(11);
    }

    private AuthPrincipal principal() {
        return new AuthPrincipal(UUID.randomUUID(), org, "seller@example.invalid");
    }

    private static Channel channel(String code) {
        Channel c = new Channel();
        c.setId(UUID.randomUUID());
        c.setCode(code);
        c.setNameKo(code);
        return c;
    }

    private SellerAccount account(Channel channel) {
        SellerAccount a = new SellerAccount();
        a.setId(UUID.randomUUID());
        a.setOrgId(org);
        a.setChannelId(channel.getId());
        return a;
    }

    private static OperatorVocItem item(String reviewId, String state) {
        return new OperatorVocItem("NAVER", "네이버", "REVIEW", "상품", 2, null, "2026-09-01", "2026-09-01", null,
                "불만", "ref-" + reviewId, reviewId, "RESPONSE_NEEDED", !"DRAFT_NEEDED".equals(state), state, null, false);
    }
}
