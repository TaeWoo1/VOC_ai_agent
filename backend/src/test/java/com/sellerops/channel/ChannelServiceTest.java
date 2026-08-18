package com.sellerops.channel;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.connector.ConnectionVerifier;
import com.sellerops.connector.ConnectorCapabilities;
import com.sellerops.connector.ConnectorRegistry;
import com.sellerops.connector.DataType;
import com.sellerops.connector.FetchPage;
import com.sellerops.connector.FetchRequest;
import com.sellerops.connector.MockApiConnector;
import com.sellerops.connector.PullConnector;
import com.sellerops.connector.VerifyContext;
import com.sellerops.connector.VerifyOutcome;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * Honest, flag-aware channel support facts ({@link ChannelSupport}). Proves the
 * dedicated-vs-mock hinge: the generic mock fallback over-advertises and must
 * never read as real auto-collection; only a dedicated real connector does.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class ChannelServiceTest {

    @Autowired ChannelRepository channels;
    @Autowired SellerAccountRepository sellerAccounts;

    private final UUID org = UUID.randomUUID();

    private ChannelService serviceWith(ConnectorRegistry registry) {
        return new ChannelService(channels, sellerAccounts, registry);
    }

    private void saveChannel(String code, int sortOrder) {
        Channel ch = new Channel();
        ch.setCode(code);
        ch.setNameKo(code);
        ch.setStatus(ChannelStatus.AVAILABLE);
        ch.setSupportsInquiry(true);
        ch.setSupportsReview(true);
        ch.setSupportsOrder(true);
        ch.setSupportsSales(true);
        ch.setSupportsProduct(true);
        ch.setSortOrder(sortOrder);
        channels.save(ch);
    }

    private ChannelResponse find(List<ChannelResponse> all, String code) {
        return all.stream().filter(c -> c.code().equals(code)).findFirst().orElseThrow();
    }

    /**
     * Product assembly (2026-08-17): seller-facing surfaces read the visible catalog, which is
     * exactly NAVER / COUPANG / CAFE24 in product order. The full catalog is untouched underneath.
     */
    @Test
    void visibleCatalogIsExactlyTheThreeProductChannels() {
        saveChannel("GMARKET", 0);
        saveChannel("COUPANG", 1);
        saveChannel("NAVER", 2);
        saveChannel("FILE_UPLOAD", 3);
        saveChannel("CAFE24", 4);
        saveChannel("OHOUSE", 5);
        ChannelService service = serviceWith(new ConnectorRegistry(List.of(new MockApiConnector())));

        assertThat(service.listVisibleForOrg(org)).extracting(ChannelResponse::code)
                .containsExactly("COUPANG", "NAVER", "CAFE24");
        assertThat(service.listForOrg(org)).hasSize(6);
        assertThat(ProductChannels.isVisible("GMARKET")).isFalse();
        assertThat(ProductChannels.isVisible(null)).isFalse();
    }

    @Test
    void mockFallbackNeverReadsAsAutoCollectAndStaysHonest() {
        saveChannel("NAVER", 0);
        saveChannel("OHOUSE", 1); // no credential template
        saveChannel("FILE_UPLOAD", 2); // the manual meta-channel
        // Flags off: only the generic mock exists, so every channel resolves to it.
        ChannelService service = serviceWith(new ConnectorRegistry(List.of(new MockApiConnector())));

        List<ChannelResponse> all = service.listForOrg(org);

        ChannelSupport naver = find(all, "NAVER").support();
        assertThat(naver.autoCollectSupported()).isFalse(); // mock is not dedicated
        assertThat(naver.autoCollectDataTypes()).isEmpty();
        assertThat(naver.connectionCheckSupported()).isFalse(); // mock is not a verifier
        assertThat(naver.fileUploadSupported()).isTrue();
        assertThat(naver.fileUploadDataTypes()).containsExactly("리뷰", "문의", "주문");
        assertThat(naver.credentialSetupSupported()).isTrue(); // NAVER has a template

        ChannelSupport ohouse = find(all, "OHOUSE").support();
        assertThat(ohouse.fileUploadSupported()).isTrue();
        assertThat(ohouse.autoCollectSupported()).isFalse();
        assertThat(ohouse.connectionCheckSupported()).isFalse();
        assertThat(ohouse.credentialSetupSupported()).isFalse(); // no template

        ChannelSupport fileChannel = find(all, "FILE_UPLOAD").support();
        assertThat(fileChannel.fileUploadSupported()).isFalse();
        assertThat(fileChannel.fileUploadDataTypes()).isEmpty();
        assertThat(fileChannel.autoCollectSupported()).isFalse();

        // SALES/PRODUCT have no ingestion path and must never appear as collectable.
        for (ChannelResponse c : all) {
            assertThat(c.support().fileUploadDataTypes()).doesNotContain("매출", "상품");
            assertThat(c.support().autoCollectDataTypes()).doesNotContain("매출", "상품");
        }
    }

    @Test
    void dedicatedConnectorEnablesHonestAutoCollectAndConnectionCheck() {
        saveChannel("NAVER", 0);
        saveChannel("COUPANG", 1);
        // Flag-on shape: generic mock present + a dedicated, verifying NAVER connector.
        ChannelService service = serviceWith(new ConnectorRegistry(List.of(
                new MockApiConnector(),
                new FakeDedicatedConnector("NAVER", Set.of(DataType.ORDER_SUMMARY)))));

        List<ChannelResponse> all = service.listForOrg(org);

        ChannelSupport naver = find(all, "NAVER").support();
        assertThat(naver.autoCollectSupported()).isTrue();
        assertThat(naver.autoCollectDataTypes()).containsExactly("주문");
        assertThat(naver.connectionCheckSupported()).isTrue();

        // COUPANG still resolves to the generic mock — not auto-collectable, not verifiable.
        ChannelSupport coupang = find(all, "COUPANG").support();
        assertThat(coupang.autoCollectSupported()).isFalse();
        assertThat(coupang.connectionCheckSupported()).isFalse();
    }

    /**
     * A connector dedicated to one channel that also opts into auth verification —
     * mirrors the real NAVER connector's shape without any provider/network call.
     */
    private static final class FakeDedicatedConnector implements PullConnector, ConnectionVerifier {
        private final String channelCode;
        private final Set<DataType> caps;

        FakeDedicatedConnector(String channelCode, Set<DataType> caps) {
            this.channelCode = channelCode;
            this.caps = caps;
        }

        @Override
        public String kind() {
            return "FAKE_DEDICATED";
        }

        @Override
        public Set<String> dedicatedChannels() {
            return Set.of(channelCode);
        }

        @Override
        public ConnectorCapabilities capabilities(String code) {
            return new ConnectorCapabilities("API", caps, Map.of(), "");
        }

        @Override
        public FetchPage fetch(FetchRequest request) {
            throw new UnsupportedOperationException("support facts must never collect");
        }

        @Override
        public VerifyOutcome verifyConnection(VerifyContext context) {
            return VerifyOutcome.success();
        }
    }
}
