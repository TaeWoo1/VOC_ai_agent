package com.sellerops.walkthrough;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.credential.ConnectorCredentialRepository;
import com.sellerops.order.ChannelOrderRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncJobRepository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;

/**
 * The walkthrough endpoints are the environment-identity binding: {@code /context} reports a sanitized
 * runtime identity from read-only counts, and {@code /handshake} proves the operator's tab is bound to
 * THIS run + origin with no DB access. This also pins the fail-closed wiring (the routes exist only when
 * the walkthrough flag is on) so they are a 404 in production.
 */
class WalkthroughControllerTest {

    private final ConnectorCredentialRepository credentials = mock(ConnectorCredentialRepository.class);
    private final SyncJobRepository syncJobs = mock(SyncJobRepository.class);
    private final ChannelOrderRepository channelOrders = mock(ChannelOrderRepository.class);
    private final SellerAccountRepository sellerAccounts = mock(SellerAccountRepository.class);
    private final ChannelRepository channels = mock(ChannelRepository.class);

    private static final String RUN = "run-abc123";
    private static final String FE = "http://localhost:5173";

    private WalkthroughController controller() {
        return new WalkthroughController(
                RUN, "abcdef0", "naver_walkthrough", FE, "http://127.0.0.1:18090",
                false, true, credentials, syncJobs, channelOrders, sellerAccounts, channels);
    }

    @Test
    void contextReportsSanitizedIdentityAndBaselineCounts() {
        UUID naverChannel = UUID.randomUUID();
        Channel ch = mock(Channel.class);
        when(ch.getId()).thenReturn(naverChannel);
        when(channels.findByCode("NAVER")).thenReturn(Optional.of(ch));
        SellerAccount naver = mock(SellerAccount.class);
        when(naver.getChannelId()).thenReturn(naverChannel);
        SellerAccount other = mock(SellerAccount.class);
        when(other.getChannelId()).thenReturn(UUID.randomUUID());
        when(sellerAccounts.findAll()).thenReturn(List.of(naver, other));
        when(credentials.count()).thenReturn(0L);
        when(syncJobs.count()).thenReturn(0L);
        when(channelOrders.count()).thenReturn(0L);

        WalkthroughContextView view = controller().context();

        assertThat(view.walkthroughRunId()).isEqualTo(RUN);
        assertThat(view.gitCommit()).isEqualTo("abcdef0");
        assertThat(view.dbAlias()).isEqualTo("naver_walkthrough");
        assertThat(view.frontendOrigin()).isEqualTo(FE);
        assertThat(view.naverConnectorEnabled()).isTrue();
        assertThat(view.schedulerEnabled()).isFalse();
        assertThat(view.startedAt()).isNotBlank();
        assertThat(view.baseline().credentials()).isZero();
        assertThat(view.baseline().naverAccounts()).isEqualTo(1L); // only the NAVER-channel account counts
    }

    @Test
    void handshakeMatchesOnlyTheExactRunAndOrigin() {
        WalkthroughController c = controller();

        WalkthroughHandshake.Result ok = c.handshake(new WalkthroughHandshake.Request(RUN, "nonce-1", FE));
        assertThat(ok.runMatched()).isTrue();
        assertThat(ok.originMatched()).isTrue();
        assertThat(ok.timestamp()).isNotBlank();

        // Wrong run id → not matched (a different bootstrapped runtime / stale tab).
        assertThat(c.handshake(new WalkthroughHandshake.Request("run-other", "n", FE)).runMatched()).isFalse();
        // Wrong origin (127.0.0.1 instead of the approved localhost) → not matched.
        assertThat(c.handshake(new WalkthroughHandshake.Request(RUN, "n", "http://127.0.0.1:5173")).originMatched()).isFalse();
    }

    @Test
    void handshakeNeverTouchesTheDatabase() {
        controller().handshake(new WalkthroughHandshake.Request(RUN, "nonce", FE));
        verifyNoInteractions(credentials, syncJobs, channelOrders, sellerAccounts, channels);
    }

    @Test
    void aBlankRunIdNeverMatches() {
        WalkthroughController blank = new WalkthroughController(
                "", "g", "db", FE, "http://127.0.0.1:18090", false, true,
                credentials, syncJobs, channelOrders, sellerAccounts, channels);
        assertThat(blank.handshake(new WalkthroughHandshake.Request("", "n", FE)).runMatched()).isFalse();
    }

    @Test
    void routesAreConditionalOnTheWalkthroughFlagSoProductionIsA404() {
        // @ConditionalOnProperty(name = sellerops.walkthrough.enabled, havingValue = true) means the bean —
        // and therefore the routes — do not exist unless the flag is on: a production request is a 404.
        ConditionalOnProperty cond = WalkthroughController.class.getAnnotation(ConditionalOnProperty.class);
        assertThat(cond).isNotNull();
        assertThat(cond.name()).contains("sellerops.walkthrough.enabled");
        assertThat(cond.havingValue()).isEqualTo("true");
    }
}
