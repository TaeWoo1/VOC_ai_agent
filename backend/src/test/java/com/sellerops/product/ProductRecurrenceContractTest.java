package com.sellerops.product;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.common.DataOrigin;
import com.sellerops.ingest.canonical.CanonicalProduct;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * What a SECOND catalogue cycle is allowed to do — the half of PRODUCT collection a one-shot read can
 * never demonstrate, and the reason a schedule may be turned on at all.
 *
 * <p>The connectors' own tests prove the sweep restarts (the cursor). These prove the restart is worth
 * anything: that re-reading the same catalogue re-observes a changed price, status and name in place
 * rather than minting a parallel product, and that a listing which is NOT in the read is left exactly as
 * it was. The second one is load-bearing on the demo org, where 8 of the 47 pre-existing NAVER listings
 * are synthetic {@code DERIVED:INGEST} rows with no channel counterpart: a cycle that swept them up
 * would promote invented SKUs into operational truth stamped with a real channel's provenance.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class ProductRecurrenceContractTest {

    @Autowired ProductRepository products;
    @Autowired ChannelProductRepository listings;
    @Autowired ProductVariantRepository variants;
    @Autowired ProductFactRepository facts;
    @Autowired ChannelRepository channels;

    private static final String NAVER_SOURCE = "NAVER:PRODUCT_API:v1";
    private static final String SYNTHETIC_SOURCE = "DERIVED:INGEST";

    private final UUID org = UUID.randomUUID();
    private UUID channelId;
    private ProductKnowledgeWriter writer;

    @BeforeEach
    void setUp() {
        channelId = seedChannel();
        writer = new ProductKnowledgeWriter(products, new ProductService(products), listings, variants, facts);
    }

    @Test
    @DisplayName("a second cycle re-observes the same listing in place — price, status and name")
    void aSecondCycleUpdatesTheSameListingRatherThanCreatingAnother() {
        writer.write(org, channelId, List.of(catalogueRow(
                "6473457702", "선바로 전선몰딩 2m", "12900", "SALE", Instant.parse("2026-08-22T02:00:00Z"))));

        long productsAfterFirst = products.findAll().stream().filter(p -> org.equals(p.getOrgId())).count();

        // The seller drops the price and suspends the listing, and renames it.
        writer.write(org, channelId, List.of(catalogueRow(
                "6473457702", "선바로 전선몰딩 2m (리뉴얼)", "9900", "SUSPENSION",
                Instant.parse("2026-08-23T02:00:00Z"))));

        List<ChannelProduct> stored = listingsOnChannel();
        assertThat(stored).as("identity is (channel, external id) — a re-read is one listing, not two")
                .hasSize(1);
        ChannelProduct listing = stored.get(0);
        assertThat(listing.getChannelPrice()).isEqualByComparingTo(new BigDecimal("9900"));
        assertThat(listing.getSellingStatus()).isEqualTo(SellingStatus.SUSPENDED.name());
        assertThat(listing.getChannelProductName()).isEqualTo("선바로 전선몰딩 2m (리뉴얼)");
        assertThat(listing.getLastSeenAt()).isEqualTo(Instant.parse("2026-08-23T02:00:00Z"));
        assertThat(listing.getFirstSeenAt()).isEqualTo(Instant.parse("2026-08-22T02:00:00Z"));
        assertThat(products.findAll().stream().filter(p -> org.equals(p.getOrgId())).count())
                .as("a renamed listing must not split its own history into a second product")
                .isEqualTo(productsAfterFirst);
    }

    @Test
    @DisplayName("a listing the cycle did not read is untouched — synthetic rows are never promoted")
    void aListingAbsentFromTheReadKeepsItsOwnProvenance() {
        // A synthetic row of the kind the demo org carries: an invented SKU with no channel counterpart.
        Product synthetic = product("합성 상품", "SKU-SYN-1");
        ChannelProduct derived = new ChannelProduct();
        derived.setOrgId(org);
        derived.setProductId(synthetic.getId());
        derived.setChannelId(channelId);
        derived.setExternalProductId("SKU-SYN-1");
        derived.setSourceKind(SYNTHETIC_SOURCE);
        derived.setObservedAt(Instant.parse("2026-07-01T00:00:00Z"));
        derived.setLastSeenAt(Instant.parse("2026-07-01T00:00:00Z"));
        listings.save(derived);

        writer.write(org, channelId, List.of(catalogueRow(
                "6473457702", "선바로 전선몰딩 2m", "12900", "SALE", Instant.parse("2026-08-22T02:00:00Z"))));

        ChannelProduct reloaded = listings
                .findByChannelIdAndExternalProductId(channelId, "SKU-SYN-1").orElseThrow();
        assertThat(reloaded.getSourceKind())
                .as("a row the channel never returned must not acquire the channel's provenance")
                .isEqualTo(SYNTHETIC_SOURCE);
        assertThat(reloaded.getLastSeenAt()).isEqualTo(Instant.parse("2026-07-01T00:00:00Z"));
        // And it is not deleted either: absence from one read is not evidence the listing is gone.
        assertThat(listingsOnChannel()).hasSize(2);
    }

    @Test
    @DisplayName("re-observation never rewrites data origin — a real product stays REAL")
    void reObservationKeepsDataOrigin() {
        writer.write(org, channelId, List.of(catalogueRow(
                "6473457702", "선바로 전선몰딩 2m", "12900", "SALE", Instant.parse("2026-08-22T02:00:00Z"))));
        writer.write(org, channelId, List.of(catalogueRow(
                "6473457702", "선바로 전선몰딩 2m", "12900", "SALE", Instant.parse("2026-08-23T02:00:00Z"))));

        assertThat(listingsOnChannel())
                .allSatisfy(l -> assertThat(l.getDataOrigin()).isEqualTo(DataOrigin.REAL));
        assertThat(products.findAll().stream().filter(p -> org.equals(p.getOrgId())))
                .allSatisfy(p -> assertThat(p.getDataOrigin()).isEqualTo(DataOrigin.REAL));
    }

    // ─────────────────────────── the display alias across cycles

    @Test
    @DisplayName("the display id is stored on the listing and survives a second cycle unchanged")
    void theDisplayIdIsStoredAndReObservedInPlace() {
        CanonicalProduct first = withDisplayId(
                catalogueRow("111", "전선몰딩", "12900", "SALE", Instant.now()), "6473457702");
        writer.write(org, channelId, List.of(first));

        CanonicalProduct second = withDisplayId(
                catalogueRow("111", "전선몰딩 2m", "13900", "SALE", Instant.now()), "6473457702");
        writer.write(org, channelId, List.of(second));

        assertThat(listingsOnChannel()).hasSize(1);
        ChannelProduct listing = listings.findByChannelIdAndExternalProductId(channelId, "111").orElseThrow();
        assertThat(listing.getExternalDisplayProductId()).isEqualTo("6473457702");
        // The listing is still keyed by 등록상품ID. The alias did not become the identity.
        assertThat(listing.getExternalProductId()).isEqualTo("111");
        assertThat(products.findAll().stream().filter(p -> org.equals(p.getOrgId())).count())
                .as("carrying an alias must not split the product the listing already had")
                .isEqualTo(1);
    }

    @Test
    @DisplayName("a later read that states no display id does not erase the one already stored")
    void anAbsentDisplayIdLeavesTheStoredAliasAlone() {
        writer.write(org, channelId, List.of(withDisplayId(
                catalogueRow("111", "전선몰딩", "12900", "SALE", Instant.now()), "6473457702")));

        // The shape of a cycle whose detail call failed: identity and status, no alias.
        writer.write(org, channelId,
                List.of(catalogueRow("111", "전선몰딩", "12900", "SALE", Instant.now())));

        assertThat(listings.findByChannelIdAndExternalProductId(channelId, "111").orElseThrow()
                .getExternalDisplayProductId()).isEqualTo("6473457702");
    }

    // ───────────────────────────────────────────────────────────── helpers

    /** The same catalogue row, now also stating the channel's display id. */
    private static CanonicalProduct withDisplayId(CanonicalProduct row, String displayId) {
        return new CanonicalProduct(row.externalProductId(), row.name(), row.sku(), row.productUrl(),
                row.price(), row.currency(), row.rawSellingStatus(), row.brand(), row.manufacturer(),
                row.category(), row.description(), row.attributes(), row.variants(), row.observedAt(),
                row.sourceUpdatedAt(), row.sourceKind(), row.sourceRow(), displayId);
    }

    private CanonicalProduct catalogueRow(String externalId, String name, String price,
                                          String status, Instant observedAt) {
        return new CanonicalProduct(
                externalId, name, externalId, null, new BigDecimal(price), "KRW", status,
                null, null, "생활/건강", null, Map.of(), List.of(),
                observedAt, Instant.parse("2026-07-01T00:00:00Z"), NAVER_SOURCE, 1, null);
    }

    private List<ChannelProduct> listingsOnChannel() {
        return listings.findAll().stream()
                .filter(l -> org.equals(l.getOrgId()) && channelId.equals(l.getChannelId()))
                .toList();
    }

    private Product product(String name, String sku) {
        Product product = new Product();
        product.setOrgId(org);
        product.setName(name);
        product.setSku(sku);
        product.setStatus("ACTIVE");
        return products.save(product);
    }

    private UUID seedChannel() {
        Channel channel = new Channel();
        channel.setCode("NAVER");
        channel.setNameKo("네이버");
        channel.setStatus(ChannelStatus.CONNECTED);
        channel.setSupportsOrder(true);
        return channels.save(channel).getId();
    }
}
