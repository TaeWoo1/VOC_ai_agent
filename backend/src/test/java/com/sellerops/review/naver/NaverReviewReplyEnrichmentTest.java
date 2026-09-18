package com.sellerops.review.naver;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.knowledge.guidance.SellerGuidanceRepository;
import com.sellerops.knowledge.memory.AnswerMemoryRepository;
import com.sellerops.knowledge.org.OrgKnowledgeChunkRepository;
import com.sellerops.knowledge.org.OrgKnowledgeSourceRepository;
import com.sellerops.knowledge.spine.KnowledgeEntry;
import com.sellerops.knowledge.spine.KnowledgeSpineService;
import com.sellerops.knowledge.spine.SourceRefResolver;
import com.sellerops.knowledge.spine.SpineSourceType;
import com.sellerops.knowledge.spine.adapter.InquiryAnswerAdapter;
import com.sellerops.knowledge.spine.adapter.ProductFactAdapter;
import com.sellerops.knowledge.spine.adapter.ReviewReplyAdapter;
import com.sellerops.knowledge.spine.adapter.SellerDecisionAdapter;
import com.sellerops.knowledge.spine.adapter.SellerGuidanceAdapter;
import com.sellerops.knowledge.spine.adapter.SellerKnowledgeAdapter;
import com.sellerops.knowledge.spine.dto.KnowledgeSpineSearchResponse;
import com.sellerops.product.Product;
import com.sellerops.product.ProductFactRepository;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.library.ProductKnowledgeChunkRepository;
import com.sellerops.product.library.ProductKnowledgeSourceRepository;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewReplyState;
import com.sellerops.review.ReviewRepository;
import jakarta.persistence.EntityManager;
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
 * <b>NAVER Review Reply Enrichment</b> (Customer Ops Demo Closure v1): the export's replied review, its reply text read
 * off the Seller Center detail, stored on that same canonical review and retrieved by the Knowledge Spine as a past
 * seller answer — for its product and organisation only.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class NaverReviewReplyEnrichmentTest {

    @Autowired EntityManager em;
    @Autowired ReviewRepository reviews;
    @Autowired ChannelRepository channels;
    @Autowired ProductRepository products;
    @Autowired ProductFactRepository facts;
    @Autowired OrgKnowledgeSourceRepository orgSources;
    @Autowired OrgKnowledgeChunkRepository orgChunks;
    @Autowired ProductKnowledgeSourceRepository productSources;
    @Autowired ProductKnowledgeChunkRepository productChunks;
    @Autowired AnswerMemoryRepository memories;
    @Autowired SellerGuidanceRepository guidanceRows;
    @Autowired com.sellerops.product.ProductVariantRepository variants;
    @Autowired com.sellerops.order.ChannelOrderRepository channelOrders;

    private final UUID org = UUID.randomUUID();
    private NaverReviewReplyEnrichmentService service;
    private KnowledgeSpineService spine;
    private Channel naver;
    private Product molding;
    private Review replied;

    @BeforeEach
    void seed() {
        naver = channels.findByCode("NAVER").orElseGet(() -> {
            Channel ch = new Channel();
            ch.setCode("NAVER");
            ch.setNameKo("네이버 스마트스토어");
            ch.setStatus(ChannelStatus.AVAILABLE);
            ch.setSupportsInquiry(true);
            ch.setSupportsReview(true);
            ch.setSupportsOrder(true);
            ch.setSupportsSales(true);
            ch.setSupportsProduct(true);
            ch.setSortOrder(0);
            return channels.save(ch);
        });
        molding = product(org, "선바로 일체형 전선몰딩");
        replied = review(org, molding.getId(), "5055683531", ReviewReplyState.ANSWERED,
                "접착력이 약해서 여름에 떨어지네요");
        review(org, molding.getId(), "5055683532", ReviewReplyState.PENDING, "좋아요");
        service = new NaverReviewReplyEnrichmentService(reviews, channels, em, products);
        spine = new KnowledgeSpineService(List.of(
                new SellerKnowledgeAdapter(orgSources, orgChunks, productSources, productChunks),
                new ProductFactAdapter(facts), new InquiryAnswerAdapter(memories), new ReviewReplyAdapter(em),
                new SellerDecisionAdapter(em), new SellerGuidanceAdapter(guidanceRows)),
                products, new SourceRefResolver(em), new com.sellerops.inquiry.draft.InquiryEvidenceRetriever(products,
                        new com.sellerops.product.library.ProductKnowledgeLibraryService(products, productSources,
                                productChunks, variants),
                        new com.sellerops.knowledge.org.SellerOperationsKnowledgeService(orgSources, orgChunks),
                        new com.sellerops.knowledge.memory.AnswerMemoryService(memories, orgChunks, productChunks),
                        com.sellerops.order.fact.StoredOnlyOrderFacts.reader(channelOrders, channels,
                                (orgId, code, accountId, rows) -> com.sellerops.coverage.ChannelDataState.OBSERVED_FRESH)));
    }

    @Test
    @DisplayName("the replied review is a target; its read reply lands on it once, with provenance, and is retrieved")
    void aReadReplyBecomesPastSellerKnowledge() {
        assertThat(service.targets(org, 3)).extracting(NaverReviewReplyEnrichmentService.Target::sourceReviewId)
                .containsExactly("5055683531");

        String reply = "안녕하세요 고객님, 여름철에는 부착 전 벽면을 알코올로 닦고 24시간 눌러 고정해 주세요.";
        NaverReviewReplyEnrichmentService.Result first = service.record(org, List.of(
                new NaverReviewReplyEnrichmentService.Observation("5055683531", reply, "2026-08-20T10:15:00+09:00"),
                // Not replied according to the channel, and not this org's id space: both refused, nothing stored.
                new NaverReviewReplyEnrichmentService.Observation("5055683532", "아무 글", null),
                new NaverReviewReplyEnrichmentService.Observation("9999999999", "다른 리뷰", null)));
        assertThat(first).isEqualTo(new NaverReviewReplyEnrichmentService.Result(1, 0, 2));

        Review stored = reviews.findById(replied.getId()).orElseThrow();
        assertThat(stored.getSellerReplyBody()).isEqualTo(reply);
        assertThat(stored.getSellerReplySource()).isEqualTo(NaverReviewReplyEnrichmentService.SOURCE);
        assertThat(stored.getSellerReplyAt()).isEqualTo(Instant.parse("2026-08-20T01:15:00Z"));
        assertThat(stored.getSellerReplyObservedAt()).isNotNull();
        assertThat(service.targets(org, 3)).as("read once, no longer a target").isEmpty();

        // Repeat enrichment: the same text is not a second record.
        assertThat(service.record(org, List.of(new NaverReviewReplyEnrichmentService.Observation(
                "5055683531", reply, "2026-08-20T10:15:00+09:00"))))
                .isEqualTo(new NaverReviewReplyEnrichmentService.Result(0, 1, 0));

        KnowledgeSpineSearchResponse found = spine.search(org, molding.getId(), "여름에 접착이 떨어져요", 5);
        List<KnowledgeEntry> replies = found.hits().stream().map(KnowledgeSpineSearchResponse.Hit::entry)
                .filter(e -> e.sourceType() == SpineSourceType.REVIEW_REPLY).toList();
        assertThat(replies).hasSize(1);
        assertThat(replies.get(0).provenance()).isEqualTo("리뷰 답글 · 채널에 등록된 답글");
        assertThat(replies.get(0).text()).isEqualTo(reply);
        assertThat(replies.get(0).productId()).isEqualTo(molding.getId());
        assertThat(spine.entries(org, molding.getId()).stream()
                .filter(e -> e.sourceType() == SpineSourceType.REVIEW_REPLY)).hasSize(1);

        Product mat = product(org, "논슬립 주방 매트");
        assertThat(spine.entries(org, mat.getId()))
                .as("another product of the same seller does not inherit it")
                .noneMatch(e -> e.sourceType() == SpineSourceType.REVIEW_REPLY);
        UUID other = UUID.randomUUID();
        Product lookalike = product(other, "선바로 일체형 전선몰딩");
        assertThat(spine.entries(other, lookalike.getId())).as("another organisation sees none of it")
                .noneMatch(e -> e.sourceType() == SpineSourceType.REVIEW_REPLY);
        assertThat(service.record(other, List.of(new NaverReviewReplyEnrichmentService.Observation(
                "5055683531", "침입", null))).refused()).as("another org cannot write onto it").isEqualTo(1);
        assertThat(reviews.findById(replied.getId()).orElseThrow().getSellerReplyBody()).isEqualTo(reply);

        // A reading without a date keeps the export's 답글등록일시 — the pop-up states none.
        Review undated = review(org, molding.getId(), "5055683533", ReviewReplyState.ANSWERED, "배송 빨라요");
        service.record(org, List.of(new NaverReviewReplyEnrichmentService.Observation("5055683533", "감사합니다.", null)));
        assertThat(reviews.findById(undated.getId()).orElseThrow().getSellerReplyAt())
                .isEqualTo(Instant.parse("2026-08-19T00:00:00Z"));
    }

    private Product product(UUID orgId, String name) {
        Product p = new Product();
        p.setOrgId(orgId);
        p.setName(name);
        p.setStatus("ACTIVE");
        return products.save(p);
    }

    private Review review(UUID orgId, UUID productId, String externalId, ReviewReplyState state, String body) {
        Review r = new Review();
        r.setOrgId(orgId);
        r.setChannelId(naver.getId());
        r.setProductId(productId);
        r.setExternalId(externalId);
        r.setRating(2);
        r.setBody(body);
        r.setReplyState(state);
        r.setReceivedAt(Instant.parse("2026-08-18T00:00:00Z"));
        if (state == ReviewReplyState.ANSWERED) {
            r.setRepliedAt(Instant.parse("2026-08-19T00:00:00Z"));
        }
        return reviews.save(r);
    }
}
