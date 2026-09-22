package com.sellerops.responsibility;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.connector.ChannelConnector;
import com.sellerops.connector.ConnectorCapabilities;
import com.sellerops.connector.ConnectorRegistry;
import com.sellerops.connector.DataType;
import com.sellerops.connector.FetchPage;
import com.sellerops.connector.FetchRequest;
import com.sellerops.connector.PullConnector;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * <b>Which candidate sources become real sources for an organisation — and why a collector's silence and a
 * collector's «no» are different answers.</b>
 *
 * <p>The template's source list stopped being one channel's on 2026-09-22, so a seller can now hold an API account
 * on a channel whose collection of a data type this deployment does not offer. Promising to keep such a source
 * current would record a failure every window for something nobody can act on. Dropping sources whenever no
 * collector is wired at all would do something worse and quieter: take the responsibility away from an
 * organisation on an ordinary channel, because a local boot has every connector flag off by default.
 */
class ResponsibilitySourcesCapabilityGateTest {

    private static final ResponsibilityTemplate TEMPLATE = ResponsibilityTemplate.CUSTOMER_OPERATIONS_V1;

    private final UUID org = UUID.randomUUID();
    private final UUID cafe24Channel = UUID.randomUUID();

    @Test
    void withoutAnyRegistry_everyCandidateOfTheAccountsChannelIsASource() {
        ResponsibilitySources sources = new ResponsibilitySources(accounts(), channels());

        assertThat(sources.resolve(org, TEMPLATE))
                .extracting(s -> s.channelCode() + ":" + s.dataType())
                .containsExactly("CAFE24:INQUIRY", "CAFE24:REVIEW");
    }

    @Test
    void aCollectorThatSaysItCannotReadTheTypeRemovesThatSource_andOnlyThatOne() {
        ResponsibilitySources sources = new ResponsibilitySources(accounts(), channels(),
                registryOf(new FakeConnector(Set.of(DataType.INQUIRY))));

        // REVIEW is gone because the collector answered; INQUIRY stays because it answered the other way.
        assertThat(sources.resolve(org, TEMPLATE))
                .extracting(s -> s.channelCode() + ":" + s.dataType())
                .containsExactly("CAFE24:INQUIRY");
    }

    @Test
    void noCollectorAtAllIsNotAnAnswer_soTheSourcesStayAndTheRunRecordsTheDeploymentFact() {
        // An ordinary local boot: every connector flag off, mock fallback off, so the registry resolves nothing.
        ResponsibilitySources sources = new ResponsibilitySources(accounts(), channels(), registryOf());

        assertThat(sources.resolve(org, TEMPLATE))
                .extracting(s -> s.channelCode() + ":" + s.dataType())
                .containsExactly("CAFE24:INQUIRY", "CAFE24:REVIEW");
    }

    @Test
    void aCollectorThatReadsNothingWeAskFor_leavesTheOrganisationWithNoSource() {
        // The honest end of the same rule: nothing is promised, so no window reports a gap about this channel.
        ResponsibilitySources sources = new ResponsibilitySources(accounts(), channels(),
                registryOf(new FakeConnector(Set.of(DataType.ORDER_SUMMARY))));

        assertThat(sources.resolve(org, TEMPLATE)).isEmpty();
    }

    // ── fixtures ────────────────────────────────────────────────────────────────────────────────────────────────

    private SellerAccountRepository accounts() {
        SellerAccount account = new SellerAccount();
        account.setId(UUID.randomUUID());
        account.setOrgId(org);
        account.setChannelId(cafe24Channel);
        SellerAccountRepository repo = mock(SellerAccountRepository.class);
        when(repo.findAllByOrgId(org)).thenReturn(List.of(account));
        return repo;
    }

    private ChannelRepository channels() {
        Channel channel = new Channel();
        channel.setId(cafe24Channel);
        channel.setCode("CAFE24");
        ChannelRepository repo = mock(ChannelRepository.class);
        when(repo.findAll()).thenReturn(List.of(channel));
        return repo;
    }

    /** The registry Spring builds: mock fallback OFF, so an unserved channel resolves to nothing. */
    private static ConnectorRegistry registryOf(ChannelConnector... connectors) {
        return new ConnectorRegistry(List.of(connectors), false);
    }

    /** A collector dedicated to CAFE24 that serves exactly the data types it is given. */
    private record FakeConnector(Set<DataType> supported) implements PullConnector {

        @Override
        public String kind() {
            return "CAFE24_CAPABILITY_GATE_TEST";
        }

        @Override
        public Set<String> dedicatedChannels() {
            return Set.of("CAFE24");
        }

        @Override
        public ConnectorCapabilities capabilities(String channelCode) {
            return new ConnectorCapabilities(kind(), supported,
                    Map.of(), "테스트: 선언된 데이터 유형만 제공한다.");
        }

        @Override
        public FetchPage fetch(FetchRequest request) {
            throw new UnsupportedOperationException("이 테스트는 수집을 실행하지 않는다.");
        }
    }
}
