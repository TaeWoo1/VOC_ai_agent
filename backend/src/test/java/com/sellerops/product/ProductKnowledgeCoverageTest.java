package com.sellerops.product;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.customermemory.CustomerMemoryEntryRepository;
import com.sellerops.ingest.canonical.CanonicalProduct;
import com.sellerops.ingest.canonical.CanonicalProductVariant;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.itemanalysis.ItemAnalysisRepository;
import com.sellerops.product.dto.KnowledgeCoverageView;
import com.sellerops.product.dto.ProductKnowledgeView;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import com.sellerops.reviewissue.ReviewIssueEvidenceRepository;
import com.sellerops.reviewissue.ReviewIssueQueryService;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * "정보가 없음" and "사실이 아님" are different claims, and this is where that becomes checkable.
 *
 * <p><b>The whole Product Knowledge layer exists because the product used to answer the second when it
 * only knew the first.</b> Before Operator Graph v2 the entire product context in SellerOps was
 * {@code products.name} and {@code products.sku} (measured: {@code
 * docs/slices/product-context-diagnosis-groundwork.md} §3), so an agent asked about a spec had nothing
 * to read and nothing to say about NOT having read it. Every assertion here is about that distinction —
 * not about whether a number is right.
 *
 * <p>The second thing asserted is that the AVAILABILITY axis stays separate from the ATTRIBUTION one.
 * A product can be fully catalogued with unattributable reviews, or perfectly attributed and completely
 * unknown; one verdict could not say both.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class ProductKnowledgeCoverageTest {

    @Autowired ProductRepository products;
    @Autowired ChannelProductRepository listings;
    @Autowired ProductVariantRepository variants;
    @Autowired ProductFactRepository facts;
    @Autowired ReviewRepository reviews;
    @Autowired InquiryRepository inquiries;
    @Autowired ItemAnalysisRepository analyses;
    @Autowired ReviewIssueEvidenceRepository evidence;
    @Autowired CustomerMemoryEntryRepository memory;
    @Autowired ChannelRepository channels;
    @Autowired com.sellerops.reviewissue.ReviewIssueRepository issues;
    @Autowired com.sellerops.reviewissue.ReviewIssueStateEventRepository stateEvents;

    private final UUID org = UUID.randomUUID();
    private UUID channelId;
    private ProductKnowledgeService knowledge;
    private ProductKnowledgeWriter writer;
    private ProductKnowledgeDerivation derivation;

    @BeforeEach
    void setUp() {
        channelId = seedChannel();
        ProductQueryService query = new ProductQueryService(products);
        ReviewIssueQueryService issueQuery = new ReviewIssueQueryService(issues, evidence, stateEvents,
                new com.sellerops.reviewissue.ReviewIssueSnapshotService(evidence), reviews, products);
        ProductSignalsService signals = new ProductSignalsService(query, issueQuery, evidence, analyses,
                reviews, inquiries, memory, channels);
        knowledge = new ProductKnowledgeService(query, signals, listings, variants, facts, channels);
        writer = new ProductKnowledgeWriter(products, new ProductService(products), listings, variants, facts);
        derivation = new ProductKnowledgeDerivation(products, listings, variants, facts, reviews, inquiries);
    }

    @Test
    @DisplayName("a product nobody has catalogued reports UNAVAILABLE — never 'the product has no spec'")
    void nothingHeldIsUnavailable() {
        Product product = product("전선몰딩 1호", "SKU-77");

        ProductKnowledgeView view = knowledge.knowledge(org, product.getId(), null).orElseThrow();

        assertThat(view.facts()).isEmpty();
        assertThat(facet(view, ProductKnowledgeFacet.SPEC).coverage()).isEqualTo(KnowledgeCoverage.UNAVAILABLE);
        assertThat(facet(view, ProductKnowledgeFacet.LISTING).coverage()).isEqualTo(KnowledgeCoverage.UNAVAILABLE);
        // The identity facet is still AVAILABLE: we DO know which product this is. Reporting the whole
        // product as unknown would be as wrong in the other direction.
        assertThat(facet(view, ProductKnowledgeFacet.IDENTITY).coverage()).isEqualTo(KnowledgeCoverage.AVAILABLE);
        assertThat(facet(view, ProductKnowledgeFacet.SPEC).isStatable())
                .as("a caller may not state a spec it does not hold")
                .isFalse();
    }

    @Test
    @DisplayName("a catalogued product reports AVAILABLE, with every fact carrying its source and time")
    void aCataloguedProductIsAvailableAndTraceable() {
        writer.write(org, channelId, List.of(fullCatalogueRow()));
        Product product = products.findByOrgIdAndSku(org, "SELLER-CODE-1").orElseThrow();

        ProductKnowledgeView view = knowledge.knowledge(org, product.getId(), null).orElseThrow();

        assertThat(facet(view, ProductKnowledgeFacet.LISTING).coverage()).isEqualTo(KnowledgeCoverage.AVAILABLE);
        assertThat(facet(view, ProductKnowledgeFacet.VARIANT).coverage()).isEqualTo(KnowledgeCoverage.AVAILABLE);
        assertThat(view.facts()).isNotEmpty();
        for (var fact : view.facts()) {
            // Operator Graph v2 treats a product fact as EVIDENCE, and evidence with no origin is not
            // evidence — the judge refuses a sentence resting on one.
            assertThat(fact.source()).isNotBlank();
            assertThat(fact.observedAt()).isNotNull();
            assertThat(fact.confidence()).isNotNull();
        }
        assertThat(view.listings()).singleElement()
                .satisfies(l -> assertThat(l.sellingStatus()).isEqualTo("SELLING"));
    }

    @Test
    @DisplayName("an old observation is STALE, not AVAILABLE and not missing")
    void anOldObservationIsStale() {
        CanonicalProduct old = new CanonicalProduct(
                "6473457702", "전선몰딩 1호", "SELLER-CODE-1", null, new BigDecimal("12900"), "KRW",
                "SALE", null, null, null, null, Map.of(), List.of(),
                // OBSERVED 200 days ago — that is what makes it stale. The channel's own
                // last-changed time is irrelevant to freshness and is deliberately absent here.
                Instant.now().minus(200, ChronoUnit.DAYS), null, "NAVER:PRODUCT_API:v1", 1, null);
        writer.write(org, channelId, List.of(old));
        Product product = products.findByOrgIdAndSku(org, "SELLER-CODE-1").orElseThrow();

        ProductKnowledgeView view = knowledge.knowledge(org, product.getId(), null).orElseThrow();

        // Three different states, three different sentences a surface must be able to write: we have it,
        // we have it but it is old, we never had it. One boolean could carry at most two of them.
        assertThat(facet(view, ProductKnowledgeFacet.PRICE).coverage()).isEqualTo(KnowledgeCoverage.STALE);
        assertThat(facet(view, ProductKnowledgeFacet.PRICE).newestObservedAt()).isNotNull();
    }

    @Test
    @DisplayName("a listing derived from ingested rows is PARTIAL — it states existence, not a catalogue")
    void derivedListingsArePartialNotAvailable() {
        Product product = product("전선몰딩 1호", "SKU-77");
        review(product.getId());

        derivation.derive(org, 100, 0);
        ProductKnowledgeView view = knowledge.knowledge(org, product.getId(), null).orElseThrow();

        assertThat(view.listings()).hasSize(1);
        assertThat(view.listings().get(0).source()).isEqualTo(ProductKnowledgeDerivation.SOURCE);
        assertThat(view.listings().get(0).listingName())
                .as("nothing ingested states the listing's own title, so none is invented")
                .isNull();
        assertThat(facet(view, ProductKnowledgeFacet.LISTING).coverage())
                .as("a row that only says 'this product was seen on this channel' is not a known listing")
                .isEqualTo(KnowledgeCoverage.UNAVAILABLE);
        assertThat(facet(view, ProductKnowledgeFacet.PRICE).coverage()).isEqualTo(KnowledgeCoverage.UNAVAILABLE);
    }

    @Test
    @DisplayName("a derivation never overwrites what a real catalogue read stated")
    void aRealReadWinsOverADerivation() {
        writer.write(org, channelId, List.of(fullCatalogueRow()));
        Product product = products.findByOrgIdAndSku(org, "SELLER-CODE-1").orElseThrow();
        review(product.getId());

        derivation.derive(org, 100, 0);
        ProductKnowledgeView view = knowledge.knowledge(org, product.getId(), null).orElseThrow();

        assertThat(view.listings()).allSatisfy(l ->
                assertThat(l.source()).isEqualTo("NAVER:PRODUCT_API:v1"));
        assertThat(view.listings().get(0).listingName()).isEqualTo("선바로 일체형 전선몰딩 2m");
    }

    @Test
    @DisplayName("title-derived specs are stored as DERIVED, so a parse is never mistaken for a statement")
    void titleParsesAreLabelledAsParses() {
        product("세모금컵 4000매 일회용", "SKU-CUP");

        derivation.derive(org, 100, 0);
        Product product = products.findByOrgIdAndSku(org, "SKU-CUP").orElseThrow();
        ProductKnowledgeView view = knowledge.knowledge(org, product.getId(), null).orElseThrow();

        assertThat(view.facts()).isNotEmpty();
        assertThat(view.facts()).allSatisfy(f -> {
            assertThat(f.confidence()).isEqualTo(FactConfidence.DERIVED);
            assertThat(f.source()).isEqualTo(ProductKnowledgeDerivation.TITLE_SOURCE);
        });
    }

    @Test
    @DisplayName("the two coverage axes are reported side by side and never merged")
    void availabilityAndAttributionAreSeparate() {
        Product product = product("전선몰딩 1호", "SKU-77");
        // A real, stored, 1-star review that carries no product link — the Cafe24 promoted-review shape.
        Review orphan = new Review();
        orphan.setOrgId(org);
        orphan.setChannelId(channelId);
        orphan.setProductId(null);
        orphan.setRating(1);
        orphan.setBody("붙이는 부분이 떨어졌어요");
        orphan.setNegative(true);
        orphan.setReceivedAt(Instant.parse("2026-08-14T00:00:00Z"));
        reviews.save(orphan);

        ProductKnowledgeView view = knowledge.knowledge(org, product.getId(), null).orElseThrow();

        // Attribution: we hold rows we cannot tie to this product.
        assertThat(view.signals().hasUncertainSignal()).isTrue();
        // Availability: we never held its specs. Two different limits, two different remedies —
        // "채널을 연결하세요" vs "상품 정보를 가져오세요".
        assertThat(facet(view, ProductKnowledgeFacet.SPEC).coverage()).isEqualTo(KnowledgeCoverage.UNAVAILABLE);
    }

    @Test
    @DisplayName("a re-read of the same catalogue changes nothing but the observation time")
    void writesAreIdempotent() {
        writer.write(org, channelId, List.of(fullCatalogueRow()));
        long listingsAfterFirst = listings.countByOrgId(org);
        long variantsAfterFirst = variants.countByOrgId(org);
        long factsAfterFirst = facts.countByOrgId(org);

        writer.write(org, channelId, List.of(fullCatalogueRow()));

        assertThat(listings.countByOrgId(org)).isEqualTo(listingsAfterFirst);
        assertThat(variants.countByOrgId(org)).isEqualTo(variantsAfterFirst);
        assertThat(facts.countByOrgId(org)).isEqualTo(factsAfterFirst);
    }

    @Test
    @DisplayName("a targeted fact read accepts a bare name, not only a namespaced key")
    void factLookupAcceptsTheSellersWord() {
        writer.write(org, channelId, List.of(fullCatalogueRow()));
        Product product = products.findByOrgIdAndSku(org, "SELLER-CODE-1").orElseThrow();

        // A need is phrased in the seller's words; making it depend on a storage namespace would turn a
        // spelling difference into a silent "규격 정보가 없습니다".
        assertThat(knowledge.factsFor(org, product.getId(), List.of("길이"))).isNotEmpty();
        assertThat(knowledge.factsFor(org, product.getId(), List.of("spec:길이"))).isNotEmpty();
        assertThat(knowledge.factsFor(org, product.getId(), List.of("존재하지않는키"))).isEmpty();
    }

    /**
     * A product the mall has not touched in years, read successfully today, is NOT stale.
     *
     * <p>This is the exact shape of the 2026-08-22 Cafe24 catalogue read: 144 listings fetched in two
     * seconds, the oldest last modified in 2014, and every coverage verdict came back STALE — because
     * "when we read it" and "when the channel says it changed" were the same column and freshness was
     * computed from it. The age of a PRODUCT is not the freshness of a READ.
     */
    @Test
    @DisplayName("an old product read just now is AVAILABLE — freshness follows the read, not the product")
    void aFreshReadOfAnOldProductIsNotStale() {
        CanonicalProduct oldProductFreshlyRead = new CanonicalProduct(
                "186", "원터치 디스펜서 종이컵 보관함", "186", null, new BigDecimal("10500"), "KRW",
                "SELLING", null, null, null, null, Map.of("상품무게", "1.00"), List.of(),
                Instant.now(),                              // read: now
                Instant.parse("2014-09-17T01:34:38Z"),      // channel says: untouched since 2014
                "CAFE24:PRODUCT_API:v2", 1, null);

        writer.write(org, channelId, List.of(oldProductFreshlyRead));

        Product product = products.findByOrgIdAndSku(org, "186").orElseThrow();
        ProductKnowledgeView view = knowledge.knowledge(org, product.getId(), null).orElseThrow();

        assertThat(facet(view, ProductKnowledgeFacet.LISTING).coverage())
                .isEqualTo(KnowledgeCoverage.AVAILABLE);
        assertThat(facet(view, ProductKnowledgeFacet.PRICE).coverage())
                .isEqualTo(KnowledgeCoverage.AVAILABLE);
    }

    /** The channel's own last-changed time is kept — it is a real fact, just not a freshness one. */
    @Test
    void theChannelsLastChangedTimeIsStoredBesideTheObservation() {
        Instant sourceChanged = Instant.parse("2014-09-17T01:34:38Z");
        writer.write(org, channelId, List.of(new CanonicalProduct(
                "187", "오래된 상품", "187", null, null, null, "SELLING", null, null, null, null,
                Map.of(), List.of(), Instant.now(), sourceChanged, "CAFE24:PRODUCT_API:v2", 1, null)));

        ChannelProduct listing = listings.findByChannelIdAndExternalProductId(channelId, "187").orElseThrow();

        assertThat(listing.getSourceUpdatedAt()).isEqualTo(sourceChanged);
        // The observation primitives record when WE looked, which is the whole point of the split.
        assertThat(listing.getObservedAt()).isAfter(sourceChanged);
        assertThat(listing.getLastSeenAt()).isAfter(sourceChanged);
    }

    // ───────────────────────────────────────────────────────────── helpers

    private CanonicalProduct fullCatalogueRow() {
        return new CanonicalProduct(
                "6473457702", "선바로 일체형 전선몰딩 2m", "SELLER-CODE-1",
                "https://smartstore.naver.com/x/6473457702", new BigDecimal("12900"), "KRW",
                "SALE", "선바로", "선바로산업", "생활/건강", "몰딩 제품입니다.",
                Map.of("길이", "2m", "원산지", "대한민국"),
                List.of(new CanonicalProductVariant("opt-1", "화이트 / 2m", "SKU-77-W",
                        new BigDecimal("12900"), "SALE")),
                // Read on 08-20; the channel says the listing itself last changed on 07-01. Freshness
                // follows the first, never the second.
                Instant.parse("2026-08-20T02:00:00Z"), Instant.parse("2026-07-01T00:00:00Z"),
                "NAVER:PRODUCT_API:v1", 1, null);
    }

    private static KnowledgeCoverageView facet(ProductKnowledgeView view, ProductKnowledgeFacet facet) {
        Optional<KnowledgeCoverageView> found =
                view.knowledgeCoverage().stream().filter(c -> c.facet() == facet).findFirst();
        assertThat(found).as("every facet must be reported, including the empty ones").isPresent();
        return found.get();
    }

    private Product product(String name, String sku) {
        Product product = new Product();
        product.setOrgId(org);
        product.setName(name);
        product.setSku(sku);
        product.setStatus("ACTIVE");
        return products.save(product);
    }

    private void review(UUID productId) {
        Review review = new Review();
        review.setOrgId(org);
        review.setChannelId(channelId);
        review.setProductId(productId);
        review.setRating(5);
        review.setBody("잘 쓰고 있습니다");
        review.setNegative(false);
        review.setReceivedAt(Instant.parse("2026-08-14T00:00:00Z"));
        reviews.save(review);
    }

    private UUID seedChannel() {
        Channel channel = new Channel();
        channel.setCode("NAVER");
        channel.setNameKo("네이버");
        channel.setStatus(ChannelStatus.CONNECTED);
        channel.setSupportsReview(true);
        channel.setSupportsOrder(true);
        return channels.save(channel).getId();
    }
}
