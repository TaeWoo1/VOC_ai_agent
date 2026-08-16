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
import com.sellerops.connector.MockApiConnector;
import com.sellerops.connector.PullConnector;
import com.sellerops.connector.UnsupportedScope;
import com.sellerops.connector.coupang.CoupangApiConnector;
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
        // naver/coupang lifecycle (last two args) are null: this test exercises channelCapabilityOverview
        // only, never the testConnection path that would call them.
        return new CollectControlService(
                null, channels, null, null, null, null, registry, null, null, null, null, null, null);
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

    /**
     * The case the acquisition axis exists for. Coupang's pull connector cannot serve REVIEW — Coupang
     * publishes no seller review API — and SellerOps collects 상품평 anyway, through the operator-
     * confirmed Action Window. The overview must carry BOTH facts on the same data type, because a
     * reader with only the boolean prints 미지원 over a record that is not empty.
     *
     * <p>Uses the REAL {@link CoupangApiConnector}; {@code capabilities()} and
     * {@code unsupportedScopes()} touch neither its clients nor the vault.
     */
    @Test
    void coupangReviewIsUnsupportedByThePullConnectorAndStillAcquired() {
        Channel coupang = new Channel();
        coupang.setCode("COUPANG");
        coupang.setNameKo("쿠팡");
        when(channels.findByCode("COUPANG")).thenReturn(Optional.of(coupang));
        ConnectorRegistry registry = new ConnectorRegistry(List.of(new CoupangApiConnector(null, null, null)));

        ChannelCapabilityOverview overview = serviceWith(registry).channelCapabilityOverview("COUPANG");

        ChannelCapabilityOverview.DataTypeCapability review = overview.dataTypes().stream()
                .filter(d -> "REVIEW".equals(d.dataType()))
                .findFirst()
                .orElseThrow();
        // The pull connector's answer is UNCHANGED by this axis — it still says it cannot serve REVIEW.
        assertThat(review.supported()).isFalse();
        assertThat(review.verificationStatus()).isEqualTo("UNSUPPORTED");
        // And beside it, how the 상품평 actually arrive.
        assertThat(review.acquisitionPaths())
                .singleElement()
                .satisfies(path -> {
                    assertThat(path.method()).isEqualTo("ACTION_WINDOW");
                    assertThat(path.verificationStatus()).isEqualTo("LIVE_PROVEN");
                });
        // The missing official API is an asserted fact, not something inferred from the boolean —
        // that is what the badge is meant to render for it. Exactly once: the connector and the
        // channel registry both name it, and an operator must not read one fact twice.
        assertThat(overview.unsupportedScopes())
                .extracting(ChannelCapabilityOverview.ScopeNote::code)
                .containsExactly("REVIEW_API");
        assertThat(overview.unsupportedScopes())
                .extracting(ChannelCapabilityOverview.ScopeNote::label)
                .containsExactly("리뷰 API 없음 (쿠팡 미제공)");
    }

    /**
     * The default environment, which is where operators actually looked. {@code CoupangApiConnector}
     * is behind a feature flag that is off unless someone turns it on, so
     * {@link ConnectorRegistry#resolvePullConnector} hands back the generic {@link MockApiConnector}
     * — and the 리뷰 API 없음 note, which lived on the Coupang connector alone, silently went with it.
     * The acquisition badge then stood on the screen with nothing answering it.
     *
     * <p>The fact is about the marketplace, so it must survive whichever connector answered.
     */
    @Test
    void theMissingReviewApiSurvivesTheConnectorItWasWrittenOn() {
        Channel coupang = new Channel();
        coupang.setCode("COUPANG");
        coupang.setNameKo("쿠팡");
        when(channels.findByCode("COUPANG")).thenReturn(Optional.of(coupang));
        // No dedicated Coupang connector registered at all — exactly the default wiring.
        ConnectorRegistry registry = new ConnectorRegistry(List.of(new MockApiConnector()));

        ChannelCapabilityOverview overview = serviceWith(registry).channelCapabilityOverview("COUPANG");

        assertThat(overview.unsupportedScopes())
                .extracting(ChannelCapabilityOverview.ScopeNote::code)
                .containsExactly("REVIEW_API");
        // And the two halves are both on the screen: what the channel never offered, beside how
        // SellerOps gets 상품평 regardless.
        ChannelCapabilityOverview.DataTypeCapability review = overview.dataTypes().stream()
                .filter(d -> "REVIEW".equals(d.dataType()))
                .findFirst()
                .orElseThrow();
        assertThat(review.supported()).isFalse();
        assertThat(review.acquisitionPaths())
                .singleElement()
                .satisfies(path -> assertThat(path.method()).isEqualTo("ACTION_WINDOW"));
    }

    /**
     * The gap registry is narrow on purpose. A channel nobody has audited must not inherit a
     * neighbour's boundary — the honest answer for it is silence, not a borrowed claim.
     */
    @Test
    void aChannelWithNoAuditedGapGainsNothing() {
        Channel gmarket = new Channel();
        gmarket.setCode("GMARKET");
        when(channels.findByCode("GMARKET")).thenReturn(Optional.of(gmarket));
        ConnectorRegistry registry = new ConnectorRegistry(List.of(new EsmApiConnector(null, null)));

        assertThat(serviceWith(registry).channelCapabilityOverview("GMARKET").unsupportedScopes())
                .isEmpty();
    }

    /**
     * Backward compatibility, stated as a rule rather than a spot check: every data type whose only
     * route is its pull connector answers with an EMPTY path list. The axis is additive — it must not
     * appear where nothing was proven, on any channel.
     */
    @Test
    void everyOtherChannelAndTypeCarriesNoAcquisitionPath() {
        Channel coupang = new Channel();
        coupang.setCode("COUPANG");
        when(channels.findByCode("COUPANG")).thenReturn(Optional.of(coupang));
        Channel cafe24 = new Channel();
        cafe24.setCode("CAFE24");
        when(channels.findByCode("CAFE24")).thenReturn(Optional.of(cafe24));

        CollectControlService coupangService =
                serviceWith(new ConnectorRegistry(List.of(new CoupangApiConnector(null, null, null))));
        CollectControlService cafe24Service =
                serviceWith(new ConnectorRegistry(List.of(new StubCafe24Connector())));

        // Coupang's OTHER types — the ones the official API does serve — gain nothing.
        assertThat(coupangService.channelCapabilityOverview("COUPANG").dataTypes())
                .filteredOn(d -> !"REVIEW".equals(d.dataType()))
                .allSatisfy(d -> assertThat(d.acquisitionPaths()).isEmpty());
        // And a different channel's REVIEW is untouched: CAFE24 collects reviews through its connector,
        // so it stays supported with no acquisition path beside it.
        assertThat(cafe24Service.channelCapabilityOverview("CAFE24").dataTypes())
                .allSatisfy(d -> {
                    assertThat(d.supported()).isTrue();
                    assertThat(d.verificationStatus()).isEqualTo("CONFIRMED");
                    assertThat(d.acquisitionPaths()).isEmpty();
                });
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
