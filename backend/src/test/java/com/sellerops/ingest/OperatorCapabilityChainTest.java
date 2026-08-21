package com.sellerops.ingest;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.attention.AttentionCoverage;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.customermemory.CustomerMemoryEntryRepository;
import com.sellerops.customermemory.CustomerMemoryIndexer;
import com.sellerops.customermemory.CustomerMemoryKind;
import com.sellerops.customermemory.CustomerMemoryQueryService;
import com.sellerops.customermemory.LexicalCustomerMemoryRetriever;
import com.sellerops.customermemory.RepeatedInquiryService;
import com.sellerops.customermemory.dto.RepeatedInquiryView;
import com.sellerops.inbox.InboxService;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.reply.InquiryReplyDraftRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.itemanalysis.ItemAnalysisRepository;
import com.sellerops.itemanalysis.ItemAnalysisService;
import com.sellerops.itemanalysis.RuleBasedInboxItemAnalyzer;
import com.sellerops.product.Product;
import com.sellerops.product.ProductQueryService;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.ProductSignalsService;
import com.sellerops.product.dto.ProductSignalsView;
import com.sellerops.product.dto.SignalCoverageView;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import com.sellerops.reviewissue.ReviewIssueEvidenceRepository;
import com.sellerops.reviewissue.ReviewIssueQueryService;
import com.sellerops.reviewissue.ReviewIssueRepository;
import com.sellerops.reviewissue.ReviewIssueSnapshotService;
import com.sellerops.reviewissue.ReviewIssueStateEventRepository;
import com.sellerops.reviewissue.RuleBasedIssueSignatureExtractor;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.test.context.ActiveProfiles;

/**
 * <b>The cross-stack chain the Operator actually stands on.</b>
 *
 * Every other test in this package proves one link. This one walks the whole thing in one go, with
 * real services over a real database, in the order production runs it:
 *
 * <pre>
 *   ingest → IngestFollowUp → { item analysis · issue-memory event · customer-memory index }
 *          → the exact READS the Operator's tools make
 *          → the invariants the Operator's answer depends on
 * </pre>
 *
 * <b>Why a chain test rather than more unit tests.</b> Audit defects B and C were both invisible to
 * unit tests: every component worked, every component's test passed, and the composition was wrong —
 * FAQ candidates were structurally always 0 for a connector org and the repeated-issue memory could
 * never see Coupang or uploaded reviews. A test that only ever holds one link cannot see a missing
 * link. So the assertions below are deliberately about what an OPERATOR ANSWER would contain, not
 * about any one service's return value.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class OperatorCapabilityChainTest {

    @Autowired ReviewRepository reviews;
    @Autowired InquiryRepository inquiries;
    @Autowired ItemAnalysisRepository analyses;
    @Autowired ProductRepository products;
    @Autowired ChannelRepository channels;
    @Autowired com.sellerops.inquirysignal.InquirySignatureCacheRepository signatureCache;
    @Autowired CustomerMemoryEntryRepository memory;
    @Autowired ReviewIssueRepository issues;
    @Autowired ReviewIssueEvidenceRepository evidence;
    @Autowired ReviewIssueStateEventRepository stateEvents;
    @Autowired InquiryWorkItemRepository workItems;
    @Autowired InquiryReplyDraftRepository drafts;

    private final UUID org = UUID.randomUUID();
    private UUID channelId;
    private final List<Object> published = new ArrayList<>();

    private IngestFollowUp followUp;
    private ProductSignalsService productSignals;
    private CustomerMemoryQueryService customerMemory;
    private RepeatedInquiryService repeats;
    private InboxService inbox;

    /** A single-clause body, so the extractor yields a signature — see CustomerMemoryRetrievalTest. */
    private static final String ADHESION_REVIEW = "양면테이프 부분이 떨어졌어요";
    private static final String ADHESION_INQUIRY = "양면테이프 부분이 떨어졌어요";

    @BeforeEach
    void setUp() {
        published.clear();
        channelId = seedChannel();
        ItemAnalysisService analysis =
                new ItemAnalysisService(inquiries, reviews, analyses, new RuleBasedInboxItemAnalyzer());
        CustomerMemoryIndexer indexer = new CustomerMemoryIndexer(memory, reviews, inquiries, analyses,
                new RuleBasedIssueSignatureExtractor(false),
                // The inquiry axis is semantic since Operator Graph v2 — the rule extractor produced a
                // signature for 0 of 3,220 real inquiries, so wiring it here would only re-pin a
                // measured failure. The stub stands at the CLASSIFIER port (not at a planner), and
                // `InquirySignatureClassifierFenceTest` proves no sibling exists in main.
                new com.sellerops.inquirysignal.InquirySignatureService(
                        new com.sellerops.inquirysignal.StubInquirySignatureClassifier()
                                .answeringContains("떨어졌", "품질",
                                        com.sellerops.reviewissue.InquiryAskKind.DEFECT),
                        signatureCache));
        ApplicationEventPublisher events = published::add;
        followUp = new IngestFollowUp(analysis, indexer, events);

        ReviewIssueQueryService issueQuery = new ReviewIssueQueryService(issues, evidence, stateEvents,
                new ReviewIssueSnapshotService(evidence), reviews, products);
        productSignals = new ProductSignalsService(new ProductQueryService(products), issueQuery, evidence,
                analyses, reviews, inquiries, memory, channels);
        customerMemory = new CustomerMemoryQueryService(memory, new LexicalCustomerMemoryRetriever(memory),
                workItems, drafts, products, channels);
        repeats = new RepeatedInquiryService(memory);
        inbox = new InboxService(inquiries, reviews, channels, products);
    }

    @Test
    @DisplayName("데모 1 — 오늘 뭐부터: the unanswered count the Operator reads is the server's uncapped one")
    void theUnansweredCountIsTheServersOwn() {
        Product product = product("전선몰딩 1호", "SKU-77");
        for (int i = 0; i < 60; i++) {
            ingestInquiry(product.getId(), "배송 문의 " + i, "택배가 언제 오나요", "UNANSWERED", "2026-08-18");
        }

        // The Operator's get_today_inbox tool reads /api/inbox with limit=1. The COUNT must not follow
        // the limit — that divergence is audit defect A, and it is the reason this assertion exists.
        long counted = inbox.inbox(org, null, 1).unansweredInquiries();

        assertThat(counted).isEqualTo(60);
        assertThat(inbox.inbox(org, null, 1).items()).hasSize(1);
    }

    @Test
    @DisplayName("데모 2 — A상품: an API-collected review reaches the product's signals AND its coverage")
    void aCollectedReviewReachesProductSignals() {
        Product product = product("전선몰딩 1호", "SKU-77");
        ingestReview(product.getId(), ADHESION_REVIEW, 1);

        ProductSignalsView view = productSignals.signals(org, product.getId(), LocalDate.parse("2026-08-21"));

        assertThat(view.volume().reviews()).isEqualTo(1);
        assertThat(coverage(view, SignalCoverageView.REVIEW).coverage())
                .as("a product with linked rows can be answered for")
                .isEqualTo(AttentionCoverage.COVERED);
        assertThat(coverage(view, SignalCoverageView.ITEM_ANALYSIS).coverage())
                .as("defect B: analysis used to run for uploads only, so this was UNCERTAIN forever")
                .isEqualTo(AttentionCoverage.COVERED);
        assertThat(view.linkedChannels()).containsExactly("CAFE24");
    }

    @Test
    @DisplayName("데모 2 — the unlinked case stays distinguishable from a clean product")
    void anUnlinkedProductIsNotACleanProduct() {
        Product cable = product("케이블타이 2호", "SKU-88");
        // A Cafe24-promoted review: real, negative, and carrying no product link.
        ingestReview(null, ADHESION_REVIEW, 1);

        ProductSignalsView view = productSignals.signals(org, cable.getId(), LocalDate.parse("2026-08-21"));

        assertThat(view.issues()).isEmpty();
        assertThat(view.hasUncertainSignal())
                .as("empty + unlinked evidence must never be reported as 'no problems'")
                .isTrue();
        assertThat(coverage(view, SignalCoverageView.REVIEW).unlinked()).isEqualTo(1);
    }

    @Test
    @DisplayName("데모 3 — 답변 초안: a past answered inquiry becomes recallable context")
    void aPastInquiryBecomesRecallableContext() {
        Product product = product("전선몰딩 1호", "SKU-77");
        Inquiry past = ingestInquiry(product.getId(), "접착 문의", ADHESION_INQUIRY, "ANSWERED", "2026-07-01");
        Inquiry asking = ingestInquiry(product.getId(), "또 떨어져요", ADHESION_INQUIRY, "UNANSWERED", "2026-08-20");

        var recalled = customerMemory.recallForInquiry(org, asking.getId(), 5);

        assertThat(recalled.hits()).isNotEmpty();
        assertThat(recalled.hits().get(0).sourceId()).isEqualTo(past.getId());
        assertThat(recalled.coverage().coverage())
                .as("an indexed org can answer 'have we seen this before'")
                .isEqualTo(AttentionCoverage.COVERED);
        // The cue is closed vocabulary — a customer's words are never the query.
        assertThat(recalled.cueSignatureKey()).isNotNull();
    }

    @Test
    @DisplayName("데모 3 — 반복 문의: the same question twice is detected from the same index")
    void repeatedInquiriesAreDetectedFromTheSameIndex() {
        Product product = product("전선몰딩 1호", "SKU-77");
        ingestInquiry(product.getId(), "접착 문의", ADHESION_INQUIRY, "ANSWERED", "2026-08-05");
        ingestInquiry(product.getId(), "또 떨어져요", ADHESION_INQUIRY, "UNANSWERED", "2026-08-19");

        List<RepeatedInquiryView> rows = repeats.repeats(org, LocalDate.parse("2026-08-21"), 28).stream()
                .filter(v -> RepeatedInquiryView.AXIS_SIGNATURE.equals(v.axis()))
                .toList();

        assertThat(rows).hasSize(1);
        assertThat(rows.get(0).occurrences()).isEqualTo(2);
        assertThat(rows.get(0).answeredOccurrences()).isEqualTo(1);
    }

    @Test
    @DisplayName("데모 4 — 리포트: an API-collected inquiry produces an analysis row, so FAQ 후보 can be non-zero")
    void anApiCollectedInquiryProducesAnAnalysisRow() {
        Product product = product("전선몰딩 1호", "SKU-77");
        Inquiry inquiry = ingestInquiry(product.getId(), "사이즈 문의", "규격이 어떻게 되나요", "UNANSWERED", "2026-08-18");

        assertThat(analyses.existsByOrgIdAndSourceTypeAndSourceId(org, "INQUIRY", inquiry.getId()))
                .as("defect B: the API path produced no analysis row, so FAQ/상세 후보 were always 0")
                .isTrue();
    }

    @Test
    @DisplayName("every ingest path fires the issue-memory refresh, not only NAVER import and Cafe24")
    void everyReviewIngestFiresTheIssueMemoryRefresh() {
        Product product = product("전선몰딩 1호", "SKU-77");

        ingestReview(product.getId(), ADHESION_REVIEW, 1);

        assertThat(published)
                .as("defect C: Coupang acquisition and upload ingest published nothing, so the repeated-"
                        + "issue memory was permanently blind to both")
                .hasSize(1);
    }

    @Test
    @DisplayName("the whole chain is idempotent: a replayed ingest changes no count")
    void theChainIsIdempotent() {
        Product product = product("전선몰딩 1호", "SKU-77");
        Inquiry inquiry = ingestInquiry(product.getId(), "접착 문의", ADHESION_INQUIRY, "UNANSWERED", "2026-08-18");

        followUp.afterInquiryIngest(org, List.of(inquiry.getId()));
        followUp.afterInquiryIngest(org, List.of(inquiry.getId()));

        assertThat(memory.countByOrgIdAndEntryKind(org, CustomerMemoryKind.INQUIRY))
                .as("a re-run sync must not inflate a repeat count")
                .isEqualTo(1);
        assertThat(repeats.repeats(org, LocalDate.parse("2026-08-21"), 28))
                .as("and one inquiry is still not a repeat, however many times it was indexed")
                .isEmpty();
    }

    /* ───────────────────────────── fixtures ───────────────────────────── */

    private SignalCoverageView coverage(ProductSignalsView view, String signal) {
        return view.coverage().stream().filter(c -> c.signal().equals(signal)).findFirst().orElseThrow();
    }

    /** Persist a review the way an ingest does, then run the real follow-up over it. */
    private Review ingestReview(UUID productId, String body, int rating) {
        Review review = new Review();
        review.setOrgId(org);
        review.setChannelId(channelId);
        review.setProductId(productId);
        review.setRating(rating);
        review.setBody(body);
        review.setNegative(rating <= 2);
        review.setReceivedAt(Instant.parse("2026-08-14T00:00:00Z"));
        Review saved = reviews.save(review);
        followUp.afterReviewIngest(org, channelId, List.of(saved.getId()));
        return saved;
    }

    private Inquiry ingestInquiry(UUID productId, String title, String body, String status, String day) {
        Inquiry inquiry = new Inquiry();
        inquiry.setOrgId(org);
        inquiry.setChannelId(channelId);
        inquiry.setProductId(productId);
        inquiry.setTitle(title);
        inquiry.setBody(body);
        inquiry.setStatus(status);
        inquiry.setReceivedAt(Instant.parse(day + "T00:00:00Z"));
        Inquiry saved = inquiries.save(inquiry);
        followUp.afterInquiryIngest(org, List.of(saved.getId()));
        return saved;
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
        channel.setCode("CAFE24");
        channel.setNameKo("카페24");
        channel.setStatus(ChannelStatus.CONNECTED);
        channel.setSupportsInquiry(true);
        channel.setSupportsReview(true);
        channel.setSupportsOrder(true);
        return channels.save(channel).getId();
    }
}
