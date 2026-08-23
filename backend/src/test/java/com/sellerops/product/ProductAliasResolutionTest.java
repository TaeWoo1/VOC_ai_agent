package com.sellerops.product;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.common.DataOrigin;
import com.sellerops.common.SyntheticDataVisibility;
import com.sellerops.product.dto.ProductSummaryView;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * Resolving a product by the name a human can actually read.
 *
 * <p><b>The red case is a live one.</b> On 2026-08-23 a seller asked about "판도리 일체형 종이컵 수거함"
 * — the title on their own Coupang listing — and the run ended "해당하는 상품을 찾지 못했습니다", twice.
 * The product existed, carried seven real reviews, and was named {@code 15223228019} in
 * {@code products.name}, because that is what a Coupang-derived catalogue stores there
 * ({@code docs/agent_real_validation_v1.md} §9.5, defect C1).
 *
 * <p><b>What is NOT being added.</b> No similarity score, no model, no merging of products. An alias
 * finds a LISTING and returns the canonical product that listing is already attached to; when one
 * title is attached to two different products the answer is two candidates on the same surface, and
 * the caller is expected to refuse. The last three tests are the fences: another tenant's listing,
 * a seeded listing, and a name nobody sells all resolve to nothing.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class ProductAliasResolutionTest {

    @Autowired ProductRepository products;
    @Autowired ChannelProductRepository listings;
    @Autowired ChannelRepository channels;

    private final UUID org = UUID.randomUUID();
    private ProductQueryService query;
    private UUID coupang;
    private UUID cafe24;

    @BeforeEach
    void setUp() {
        // The deployment default, asserted rather than assumed: with synthetic rows visible, the
        // provenance fence below would pass for the wrong reason.
        SyntheticDataVisibility.overrideForTest(false);
        coupang = channel("COUPANG");
        cafe24 = channel("CAFE24");
        query = new ProductQueryService(products, listings);
    }

    // ─────────────────────────────────────────────────────────── the red case

    @Test
    @DisplayName("the listing title resolves the product whose canonical name is a SKU number")
    void theListingTitleResolvesTheProduct() {
        Product product = product("15223228019", "15223228019");
        listing(coupang, product.getId(), "판도리 일체형 종이컵 수거함", org);

        List<ProductSummaryView> found = query.search(org, "판도리 일체형 종이컵 수거함", 5);

        assertThat(found).singleElement().satisfies(v -> {
            assertThat(v.id()).isEqualTo(product.getId());
            assertThat(v.matchedOn()).isEqualTo(ProductMatchSurface.CHANNEL_PRODUCT_NAME_EXACT);
            // The human name travels with the row, so an answer can call the product what the seller
            // called it instead of reading a SKU number back at them.
            assertThat(v.matchedName()).isEqualTo("판도리 일체형 종이컵 수거함");
            assertThat(v.name()).isEqualTo("15223228019");
        });
    }

    @Test
    @DisplayName("resolving by alias creates nothing — reading is not ingest")
    void resolvingCreatesNothing() {
        Product product = product("15223228019", "15223228019");
        listing(coupang, product.getId(), "판도리 일체형 종이컵 수거함", org);
        long before = products.count();
        long listingsBefore = listings.count();

        query.search(org, "판도리 일체형 종이컵 수거함", 5);
        query.search(org, "존재하지 않는 상품", 5);

        assertThat(products.count()).isEqualTo(before);
        assertThat(listings.count()).isEqualTo(listingsBefore);
    }

    // ─────────────────────────────────────────────────────────── what must not break

    @Test
    @DisplayName("SKU and canonical name resolve exactly as before")
    void theExistingSurfacesStillResolve() {
        Product molding = product("전선몰딩 1호", "SKU-77");

        assertThat(query.search(org, "SKU-77", 5)).singleElement()
                .satisfies(v -> assertThat(v.matchedOn()).isEqualTo(ProductMatchSurface.SKU_EXACT));
        assertThat(query.search(org, "전선몰딩 1호", 5)).singleElement()
                .satisfies(v -> assertThat(v.matchedOn()).isEqualTo(ProductMatchSurface.CANONICAL_NAME_EXACT));
        assertThat(query.search(org, "전선몰딩", 5)).singleElement()
                .satisfies(v -> {
                    assertThat(v.id()).isEqualTo(molding.getId());
                    assertThat(v.matchedOn()).isEqualTo(ProductMatchSurface.CANONICAL_NAME_PARTIAL);
                });
    }

    @Test
    @DisplayName("a whole name the seller typed outranks a fragment of another product's name")
    void exactOutranksPartial() {
        Product coded = product("94", "94");
        listing(coupang, coded.getId(), "종이컵 수거함", org);
        product("종이컵 수거함 거치대 세트", "SKU-SET");

        List<ProductSummaryView> found = query.search(org, "종이컵 수거함", 5);

        assertThat(found).hasSize(2);
        assertThat(found.get(0).id()).isEqualTo(coded.getId());
        assertThat(found.get(0).matchedOn()).isEqualTo(ProductMatchSurface.CHANNEL_PRODUCT_NAME_EXACT);
        assertThat(found.get(1).matchedOn()).isEqualTo(ProductMatchSurface.CANONICAL_NAME_PARTIAL);
    }

    @Test
    @DisplayName("only what is invisible on screen is normalized away")
    void normalizationIsMinimal() {
        Product product = product("170", "170");
        listing(coupang, product.getId(), "  판도리   조립형 종이컵 수거함 ", org);

        assertThat(query.search(org, "판도리 조립형 종이컵 수거함", 5)).singleElement()
                .satisfies(v -> assertThat(v.id()).isEqualTo(product.getId()));
        // …and nothing else is. A different quantity is a different product, not a spelling variant.
        assertThat(query.search(org, "판도리 조립형 종이컵 수거함 2p", 5)).isEmpty();
    }

    // ─────────────────────────────────────────────────────────── one title, several listings

    @Test
    @DisplayName("the same title on two channels is one product, not two candidates")
    void oneTitleOnTwoChannelsConverges() {
        Product product = product("15223231934", "15223231934");
        listing(coupang, product.getId(), "판도리 조립형 종이컵 수거함", org);
        listing(cafe24, product.getId(), "판도리 조립형 종이컵 수거함", org);

        assertThat(query.search(org, "판도리 조립형 종이컵 수거함", 5)).singleElement()
                .satisfies(v -> assertThat(v.id()).isEqualTo(product.getId()));
    }

    @Test
    @DisplayName("the same title on two DIFFERENT products stays two candidates on one surface")
    void oneTitleOnTwoProductsIsAmbiguous() {
        // Ten such titles exist on the demo org, one of them shared by four products. Picking the
        // first would be a coin flip, and a coin flip stated confidently is the failure this package
        // exists to avoid — so the resolver reports both and the Operator refuses.
        Product first = product("94", "94");
        Product second = product("179", "179");
        listing(coupang, first.getId(), "스노우 누리젠", org);
        listing(cafe24, second.getId(), "스노우 누리젠", org);

        List<ProductSummaryView> found = query.search(org, "스노우 누리젠", 5);

        assertThat(found).hasSize(2);
        assertThat(found).allSatisfy(v ->
                assertThat(v.matchedOn()).isEqualTo(ProductMatchSurface.CHANNEL_PRODUCT_NAME_EXACT));
        assertThat(found).extracting(ProductSummaryView::id)
                .containsExactlyInAnyOrder(first.getId(), second.getId());
    }

    // ─────────────────────────────────────────────────────────── the fences

    @Test
    @DisplayName("another tenant's listing cannot name a product into this org's answer")
    void aCrossOrgAliasResolvesNothing() {
        UUID otherOrg = UUID.randomUUID();
        Product theirs = new Product();
        theirs.setOrgId(otherOrg);
        theirs.setName("15223228019");
        theirs.setSku("15223228019");
        theirs.setStatus("ACTIVE");
        products.save(theirs);
        listing(coupang, theirs.getId(), "판도리 일체형 종이컵 수거함", otherOrg);

        assertThat(query.search(org, "판도리 일체형 종이컵 수거함", 5)).isEmpty();
    }

    @Test
    @DisplayName("a seeded listing cannot name a real product")
    void aSeededAliasResolvesNothing() {
        Product real = product("15223228019", "15223228019");
        ChannelProduct seeded = listing(coupang, real.getId(), "판도리 일체형 종이컵 수거함", org);
        seeded.setDataOrigin(DataOrigin.DEMO_SEED);
        listings.saveAndFlush(seeded);

        // A real product with a synthetic listing must not be reachable by the synthetic title: the
        // alias would be a claim about what the seller sells that no real row supports.
        assertThat(query.search(org, "판도리 일체형 종이컵 수거함", 5)).isEmpty();
        // The product itself is untouched — it is still reachable the way it always was.
        assertThat(query.search(org, "15223228019", 5)).singleElement()
                .satisfies(v -> assertThat(v.id()).isEqualTo(real.getId()));
    }

    @Test
    @DisplayName("a name nobody sells resolves to nothing, and says nothing")
    void anUnknownNameResolvesNothing() {
        product("15223228019", "15223228019");
        listing(coupang, products.findAll().get(0).getId(), "판도리 일체형 종이컵 수거함", org);

        assertThat(query.search(org, "판도리 우주선", 5)).isEmpty();
    }

    // ─────────────────────────────────────────────────────────── helpers

    private Product product(String name, String sku) {
        Product product = new Product();
        product.setOrgId(org);
        product.setName(name);
        product.setSku(sku);
        product.setStatus("ACTIVE");
        return products.save(product);
    }

    private ChannelProduct listing(UUID channelId, UUID productId, String title, UUID owner) {
        ChannelProduct listing = new ChannelProduct();
        listing.setOrgId(owner);
        listing.setChannelId(channelId);
        listing.setProductId(productId);
        listing.setExternalProductId(UUID.randomUUID().toString());
        listing.setChannelProductName(title);
        return listings.saveAndFlush(listing);
    }

    private UUID channel(String code) {
        Channel channel = new Channel();
        channel.setCode(code);
        channel.setNameKo(code);
        channel.setStatus(ChannelStatus.CONNECTED);
        return channels.save(channel).getId();
    }
}
