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
 * the walkthrough flag is on) so they are a 404 in production. The binding is channel-neutral: the same
 * run-id hosts a NAVER, Coupang WING, or any other channel's guided walkthrough, and {@code /context}
 * reports which channel it is bound to.
 */
class WalkthroughControllerTest {

    private final ConnectorCredentialRepository credentials = mock(ConnectorCredentialRepository.class);
    private final SyncJobRepository syncJobs = mock(SyncJobRepository.class);
    private final ChannelOrderRepository channelOrders = mock(ChannelOrderRepository.class);
    private final SellerAccountRepository sellerAccounts = mock(SellerAccountRepository.class);
    private final ChannelRepository channels = mock(ChannelRepository.class);

    private static final String RUN = "run-abc123";
    private static final String FE = "http://localhost:5173";

    /**
     * @param channelCode              the configured target channel (default "NAVER")
     * @param naverConnectorEnabled    value of {@code sellerops.connector.naver.enabled}
     * @param coupangConnectorEnabled  value of {@code sellerops.connector.coupang.enabled}
     */
    private WalkthroughController controller(
            String channelCode, boolean naverConnectorEnabled, boolean coupangConnectorEnabled) {
        return new WalkthroughController(
                RUN, "abcdef0", "walkthrough", FE, "http://127.0.0.1:18090",
                false, channelCode, naverConnectorEnabled, coupangConnectorEnabled,
                credentials, syncJobs, channelOrders, sellerAccounts, channels);
    }

    /** The default NAVER walkthrough with its connector flag on. */
    private WalkthroughController naverController() {
        return controller("NAVER", true, false);
    }

    /** Stub one account on the given channel code and one on an unrelated channel. */
    private void stubOneAccountOnChannel(String channelCode) {
        UUID channelId = UUID.randomUUID();
        Channel ch = mock(Channel.class);
        when(ch.getId()).thenReturn(channelId);
        when(channels.findByCode(channelCode)).thenReturn(Optional.of(ch));
        SellerAccount onChannel = mock(SellerAccount.class);
        when(onChannel.getChannelId()).thenReturn(channelId);
        SellerAccount other = mock(SellerAccount.class);
        when(other.getChannelId()).thenReturn(UUID.randomUUID());
        when(sellerAccounts.findAll()).thenReturn(List.of(onChannel, other));
        when(credentials.count()).thenReturn(0L);
        when(syncJobs.count()).thenReturn(0L);
        when(channelOrders.count()).thenReturn(0L);
    }

    @Test
    void contextReportsSanitizedIdentityAndBaselineCounts() {
        stubOneAccountOnChannel("NAVER");

        WalkthroughContextView view = naverController().context();

        assertThat(view.walkthroughRunId()).isEqualTo(RUN);
        assertThat(view.gitCommit()).isEqualTo("abcdef0");
        assertThat(view.dbAlias()).isEqualTo("walkthrough");
        assertThat(view.frontendOrigin()).isEqualTo(FE);
        assertThat(view.channelCode()).isEqualTo("NAVER");
        assertThat(view.connectorEnabled()).isTrue();
        assertThat(view.schedulerEnabled()).isFalse();
        assertThat(view.startedAt()).isNotBlank();
        assertThat(view.baseline().credentials()).isZero();
        assertThat(view.baseline().channelAccounts()).isEqualTo(1L); // only the target-channel account counts
    }

    @Test
    void contextResolvesConnectorAndBaselineForTheConfiguredCoupangChannel() {
        // channel-code=COUPANG + sellerops.connector.coupang.enabled=true; NAVER flag is irrelevant here.
        stubOneAccountOnChannel("COUPANG");

        WalkthroughContextView view = controller("COUPANG", false, true).context();

        assertThat(view.channelCode()).isEqualTo("COUPANG");
        assertThat(view.connectorEnabled()).isTrue(); // resolved from the Coupang flag, not NAVER
        assertThat(view.baseline().channelAccounts()).isEqualTo(1L); // COUPANG-channel account counts
    }

    @Test
    void connectorEnabledIsSelectedPerChannelSoTheWrongChannelsFlagIsIgnored() {
        // COUPANG target but only the NAVER flag is on → connector reports NOT enabled.
        when(channels.findByCode("COUPANG")).thenReturn(Optional.empty());
        assertThat(controller("COUPANG", true, false).context().connectorEnabled()).isFalse();
        // NAVER target but only the Coupang flag is on → connector reports NOT enabled.
        when(channels.findByCode("NAVER")).thenReturn(Optional.empty());
        assertThat(controller("NAVER", false, true).context().connectorEnabled()).isFalse();
    }

    @Test
    void anUnknownChannelCodeFailsClosedToConnectorDisabled() {
        when(channels.findByCode("MYSTERY")).thenReturn(Optional.empty());
        WalkthroughContextView view = controller("MYSTERY", true, true).context();
        assertThat(view.channelCode()).isEqualTo("MYSTERY");
        assertThat(view.connectorEnabled()).isFalse(); // fail-closed for an unknown channel
        assertThat(view.baseline().channelAccounts()).isZero(); // no matching channel → 0
    }

    @Test
    void aBlankChannelCodeDefaultsToNaverKeepingExistingBehavior() {
        stubOneAccountOnChannel("NAVER");
        WalkthroughContextView view = controller("", true, false).context();
        assertThat(view.channelCode()).isEqualTo("NAVER");
        assertThat(view.connectorEnabled()).isTrue();
        assertThat(view.baseline().channelAccounts()).isEqualTo(1L);
    }

    @Test
    void handshakeMatchesOnlyTheExactRunAndOrigin() {
        WalkthroughController c = naverController();

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
        naverController().handshake(new WalkthroughHandshake.Request(RUN, "nonce", FE));
        verifyNoInteractions(credentials, syncJobs, channelOrders, sellerAccounts, channels);
    }

    @Test
    void aBlankRunIdNeverMatches() {
        WalkthroughController blank = new WalkthroughController(
                "", "g", "db", FE, "http://127.0.0.1:18090", false, "NAVER", true, false,
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
