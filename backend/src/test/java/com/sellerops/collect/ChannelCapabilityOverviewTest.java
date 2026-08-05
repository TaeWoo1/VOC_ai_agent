package com.sellerops.collect;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.collect.dto.ChannelCapabilityOverview;
import com.sellerops.connector.ChannelConnector;
import com.sellerops.connector.ConnectorCapabilities;
import com.sellerops.connector.ConnectorRegistry;
import com.sellerops.connector.DataType;
import com.sellerops.connector.FetchPage;
import com.sellerops.connector.FetchRequest;
import com.sellerops.connector.PullConnector;
import com.sellerops.connector.UnsupportedScope;
import com.sellerops.connector.esm.EsmApiConnector;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.Test;

/**
 * The channel-generic capability overview must prefer the in-code connector
 * capabilities (CAFE24 is not seeded into {@code connector_capabilities}) and carry
 * the connector's honest unsupported-scope boundaries. Plain unit test over a real
 * {@link ConnectorRegistry} with a stub connector — no Spring context, no DB.
 */
class ChannelCapabilityOverviewTest {

    private final ChannelRepository channels = mock(ChannelRepository.class);

    private CollectControlService serviceWith(ConnectorRegistry registry) {
        // Only channels + registry are touched by channelCapabilityOverview; the rest
        // are unused for this read and may be null.
        // naverLifecycle (last arg) is null: this test exercises channelCapabilityOverview only, never
        // the testConnection path that would call it.
        return new CollectControlService(null, channels, null, null, null, null, registry, null, null, null, null);
    }

    @Test
    void cafe24OverviewSurfacesInCodeCapabilitiesAndScopes() {
        Channel cafe24 = new Channel();
        cafe24.setCode("CAFE24");
        cafe24.setNameKo("카페24");
        when(channels.findByCode("CAFE24")).thenReturn(Optional.of(cafe24));
        ConnectorRegistry registry = new ConnectorRegistry(List.of(new StubCafe24Connector()));

        ChannelCapabilityOverview overview = serviceWith(registry).channelCapabilityOverview("CAFE24");

        assertThat(overview.channelCode()).isEqualTo("CAFE24");
        assertThat(overview.channelNameKo()).isEqualTo("카페24");
        assertThat(overview.connectorClass()).isEqualTo("API");
        assertThat(overview.autoCollectSupported()).isTrue();
        // ORDER_SUMMARY / REVIEW / INQUIRY are all CONFIRMED in display order.
        assertThat(overview.dataTypes())
                .extracting(ChannelCapabilityOverview.DataTypeCapability::dataType)
                .containsExactly("ORDER_SUMMARY", "REVIEW", "INQUIRY");
        assertThat(overview.dataTypes())
                .allSatisfy(d -> {
                    assertThat(d.supported()).isTrue();
                    assertThat(d.verificationStatus()).isEqualTo("CONFIRMED");
                });
        assertThat(overview.unsupportedScopes())
                .extracting(ChannelCapabilityOverview.ScopeNote::code)
                .containsExactly("BOARD_9", "COMMENTS", "COMMUNITY_WRITE", "AUTO_REPLY");
    }

    @Test
    void channelWithNoPullConnectorReportsAutoCollectUnsupported() {
        when(channels.findByCode("FILE_UPLOAD")).thenReturn(Optional.empty());
        ConnectorRegistry registry = new ConnectorRegistry(List.of(new StubCafe24Connector()));

        ChannelCapabilityOverview overview = serviceWith(registry).channelCapabilityOverview("FILE_UPLOAD");

        assertThat(overview.autoCollectSupported()).isFalse();
        assertThat(overview.connectorClass()).isNull();
        assertThat(overview.dataTypes()).isEmpty();
        assertThat(overview.unsupportedScopes()).isEmpty();
    }

    /**
     * Second-channel (ESM+ = the GMARKET catalog code) validation: the channel-generic
     * overview must represent a non-Cafe24 channel honestly off the connector's in-code
     * capabilities — no {@code connector_capabilities} DB rows are seeded here — and must
     * never claim CONFIRMED for a skeleton connector with no collectable data type.
     * Uses the REAL {@link EsmApiConnector} (its http/vault are untouched by capabilities()).
     */
    @Test
    void esmGmarketOverviewExposesNoConfirmedDataType() {
        // The real ESM connector's empty, fail-honest capability surface.
        EsmApiConnector esm = new EsmApiConnector(null, null);
        assertThat(esm.dedicatedChannels()).containsExactly("GMARKET");
        assertThat(esm.capabilities("GMARKET").supportedDataTypes()).isEmpty();

        Channel gmarket = new Channel();
        gmarket.setCode("GMARKET");
        gmarket.setNameKo("G마켓/옥션");
        when(channels.findByCode("GMARKET")).thenReturn(Optional.of(gmarket));
        ConnectorRegistry registry = new ConnectorRegistry(List.of(esm));

        ChannelCapabilityOverview overview = serviceWith(registry).channelCapabilityOverview("GMARKET");

        assertThat(overview.channelCode()).isEqualTo("GMARKET");
        assertThat(overview.channelNameKo()).isEqualTo("G마켓/옥션");   // non-Cafe24 name, generically carried
        assertThat(overview.connectorClass()).isEqualTo("API");
        assertThat(overview.autoCollectSupported()).isTrue();
        // Skeleton connector → every data type is UNSUPPORTED, and crucially none is CONFIRMED.
        assertThat(overview.dataTypes())
                .allSatisfy(d -> {
                    assertThat(d.supported()).isFalse();
                    assertThat(d.verificationStatus()).isEqualTo("UNSUPPORTED");
                });
        assertThat(overview.dataTypes())
                .extracting(ChannelCapabilityOverview.DataTypeCapability::verificationStatus)
                .doesNotContain("CONFIRMED");
    }

    /** Minimal CAFE24-dedicated pull connector with CONFIRMED caps + honest scopes. */
    private static final class StubCafe24Connector implements PullConnector, ChannelConnector {
        @Override
        public String kind() {
            return "CAFE24_API";
        }

        @Override
        public Set<String> dedicatedChannels() {
            return Set.of("CAFE24");
        }

        @Override
        public ConnectorCapabilities capabilities(String channelCode) {
            return new ConnectorCapabilities("API",
                    Set.of(DataType.ORDER_SUMMARY, DataType.REVIEW, DataType.INQUIRY),
                    Map.of(DataType.ORDER_SUMMARY, "CONFIRMED",
                            DataType.REVIEW, "CONFIRMED",
                            DataType.INQUIRY, "CONFIRMED"),
                    "stub");
        }

        @Override
        public FetchPage fetch(FetchRequest request) {
            throw new UnsupportedOperationException();
        }

        @Override
        public List<UnsupportedScope> unsupportedScopes(String channelCode) {
            return List.of(
                    new UnsupportedScope("BOARD_9", "1:1 맞춤상담 미수집"),
                    new UnsupportedScope("COMMENTS", "댓글 미수집"),
                    new UnsupportedScope("COMMUNITY_WRITE", "글쓰기 미지원"),
                    new UnsupportedScope("AUTO_REPLY", "자동 답변 미지원"));
        }
    }
}
