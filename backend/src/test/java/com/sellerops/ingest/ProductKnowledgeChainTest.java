package com.sellerops.ingest;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.community.Cafe24CommunityArticle;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import com.sellerops.customermemory.CustomerMemoryEntryRepository;
import com.sellerops.ingest.canonical.CanonicalInquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.itemanalysis.ItemAnalysisRepository;
import com.sellerops.product.ChannelProductRepository;
import com.sellerops.product.KnowledgeCoverage;
import com.sellerops.product.Product;
import com.sellerops.product.ProductFactRepository;
import com.sellerops.product.ProductKnowledgeDerivation;
import com.sellerops.product.ProductKnowledgeService;
import com.sellerops.product.ProductQueryService;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.ProductService;
import com.sellerops.product.ProductSignalsService;
import com.sellerops.product.ProductVariantRepository;
import com.sellerops.product.dto.ProductKnowledgeView;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import com.sellerops.reviewissue.ReviewIssueEvidenceRepository;
import com.sellerops.reviewissue.ReviewIssueQueryService;
import java.time.Instant;
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
 * The cross-stack chain Operator Graph v2 adds: stored rows → linkage repair → derived knowledge →
 * the read model an agent tool calls.
 *
 * <p><b>Why the Cafe24 linkage repair is the first step and not a footnote.</b> Cafe24's board article
 * carries {@code product_no}; {@code Cafe24InquiryArticleMapper} has always used that value AS the SKU,
 * so the inquiry path creates products from it. The review path discarded the same key, which meant
 * that inside ONE org the identical identifier became a product on one path and nothing on the other,
 * and every Cafe24 review counted as unattributable against products the inquiry path had already
 * created. That is a consistency defect, not a missing feature, and its fix changes what the knowledge
 * layer above it can see.
 *
 * <p><b>Why a backfill is exercised rather than a re-collection.</b> Ingest is idempotent, so
 * re-collecting already-collected data inserts nothing and every follow-up is a no-op — measured on the
 * demo org 2026-08-21, where 7,136 stored utterances left a derived index at zero. An operator backfill
 * is the only thing that can fill derived state for an existing seller, so it is what the chain test
 * runs.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class ProductKnowledgeChainTest {

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
    @Autowired Cafe24CommunityArticleRepository articles;
    @Autowired com.sellerops.reviewissue.ReviewIssueRepository issues;
    @Autowired com.sellerops.reviewissue.ReviewIssueStateEventRepository stateEvents;

    private final UUID org = UUID.randomUUID();
    private final UUID account = UUID.randomUUID();
    private UUID channelId;
    private ProductService productService;
    private ReviewProductLinkBackfill linkBackfill;
    private ProductKnowledgeDerivation derivation;
    private ProductKnowledgeService knowledge;
    private Cafe24ReviewPromoter promoter;

    @BeforeEach
    void setUp() {
        channelId = seedChannel();
        productService = new ProductService(products);
        promoter = new Cafe24ReviewPromoter(reviews, productService);
        linkBackfill = new ReviewProductLinkBackfill(reviews, articles, productService);
        derivation = new ProductKnowledgeDerivation(products, listings, variants, facts, reviews, inquiries);
        ProductQueryService query = new ProductQueryService(products);
        ReviewIssueQueryService issueQuery = new ReviewIssueQueryService(issues, evidence, stateEvents,
                new com.sellerops.reviewissue.ReviewIssueSnapshotService(evidence), reviews, products);
        knowledge = new ProductKnowledgeService(query, new ProductSignalsService(query, issueQuery,
                evidence, analyses, reviews, inquiries, memory, channels), listings, variants, facts, channels);
    }

    @Test
    @DisplayName("a Cafe24 review promoted before the fix is linked by the backfill, using the inquiry path's own key")
    void theBackfillLinksWhatThePromoterUsedToDrop() {
        // The inquiry path creates the product from product_no — this is the existing behaviour.
        Product fromInquiry = productService.resolveOrCreate(org, null, "77");
        // Article 4001 is ABOUT product 77 — the two numbers are different axes, and conflating them is
        // how a linkage repair silently attaches a review to the wrong product.
        storeArticle(4001L, 77L);
        // A review promoted the old way: stored, real, and unattributable.
        promoteWithoutProduct(4001L);

        assertThat(reviews.findAllByOrgId(org)).singleElement()
                .satisfies(r -> assertThat(r.getProductId()).isNull());

        ReviewProductLinkBackfill.LinkResult result = linkBackfill.backfill(org, 100, 0);

        assertThat(result.linked()).isEqualTo(1);
        assertThat(reviews.findAllByOrgId(org)).singleElement()
                .satisfies(r -> assertThat(r.getProductId())
                        .as("the same product number that made a product on the inquiry path")
                        .isEqualTo(fromInquiry.getId()));
    }

    @Test
    @DisplayName("a review whose article names no product stays unlinked — that IS what is true of it")
    void anArticleWithNoProductNumberStaysUnlinked() {
        storeArticle(4002L, null);
        promoteWithoutProduct(4002L);

        ReviewProductLinkBackfill.LinkResult result = linkBackfill.backfill(org, 100, 0);

        assertThat(result.linked()).isZero();
        assertThat(result.noProductNo()).isEqualTo(1);
    }

    @Test
    @DisplayName("the backfill is idempotent — a linked review leaves the work list")
    void theBackfillIsIdempotent() {
        storeArticle(4003L, 79L);
        promoteWithoutProduct(4003L);

        assertThat(linkBackfill.backfill(org, 100, 0).linked()).isEqualTo(1);
        assertThat(linkBackfill.backfill(org, 100, 0).scanned())
                .as("nothing left to do, so nothing is scanned")
                .isZero();
    }

    @Test
    @DisplayName("link → derive → read: the knowledge layer sees a channel it could not see before")
    void theChainEndsInAReadableKnowledgeView() {
        Product product = productService.resolveOrCreate(org, "전선몰딩 2m", "4004");
        storeArticle(4004L, 4004L);
        promoteWithoutProduct(4004L);

        linkBackfill.backfill(org, 100, 0);
        derivation.derive(org, 100, 0);

        ProductKnowledgeView view = knowledge.knowledge(org, product.getId(), null).orElseThrow();

        assertThat(view.listings())
                .as("the review is now attributed, so this product is known to exist on this channel")
                .singleElement()
                .satisfies(l -> assertThat(l.channelCode()).isEqualTo("CAFE24"));
        // And the layer is honest about what the derivation could NOT establish.
        assertThat(view.knowledgeCoverage()).anySatisfy(c -> {
            if (c.facet() == com.sellerops.product.ProductKnowledgeFacet.PRICE) {
                assertThat(c.coverage()).isEqualTo(KnowledgeCoverage.UNAVAILABLE);
            }
        });
        // The title states a length, so exactly one derived fact exists — a parse, labelled as one.
        assertThat(view.facts()).singleElement()
                .satisfies(f -> assertThat(f.source()).isEqualTo(ProductKnowledgeDerivation.TITLE_SOURCE));
    }

    @Test
    @DisplayName("the promoter now links at write time, so new reviews never need the backfill")
    void newReviewsAreLinkedOnPromotion() {
        Product product = productService.resolveOrCreate(org, null, "4005");

        promoter.promote(org, channelId, "REVIEW", 4, 4005L, "붙는 힘이 약해요", 2,
                Instant.parse("2026-08-14T00:00:00Z"), 4005L);

        assertThat(reviews.findAllByOrgId(org)).singleElement()
                .satisfies(r -> assertThat(r.getProductId()).isEqualTo(product.getId()));
        assertThat(linkBackfill.backfill(org, 100, 0).scanned())
                .as("nothing was left unlinked, so the repair has nothing to repair")
                .isZero();
    }

    // ───────────────────────────────────────────────────────────── helpers

    /** Promotion the way it worked before the fix: no product number reaches the promoter. */
    private void promoteWithoutProduct(long articleNo) {
        promoter.promote(org, channelId, "REVIEW", 4, articleNo, "붙는 힘이 약해요", 2,
                Instant.parse("2026-08-14T00:00:00Z"));
    }

    private void storeArticle(long articleNo, Long productNo) {
        Cafe24CommunityArticle article = new Cafe24CommunityArticle();
        article.setOrgId(org);
        article.setSellerAccountId(account);
        article.setChannelId(channelId);
        article.setBoardNo(4);
        article.setArticleNo(articleNo);
        article.setSourceKind("REVIEW");
        article.setProductNo(productNo);
        article.setContent("붙는 힘이 약해요");
        article.setReplyStatus("UNKNOWN");
        article.setSourceCreatedAt(Instant.parse("2026-08-14T00:00:00Z"));
        article.setSourceHash("h-" + articleNo);
        article.setCollectedAt(Instant.parse("2026-08-15T00:00:00Z"));
        articles.save(article);
    }

    private UUID seedChannel() {
        Channel channel = new Channel();
        channel.setCode("CAFE24");
        channel.setNameKo("카페24");
        channel.setStatus(ChannelStatus.CONNECTED);
        channel.setSupportsReview(true);
        channel.setSupportsInquiry(true);
        return channels.save(channel).getId();
    }
}
