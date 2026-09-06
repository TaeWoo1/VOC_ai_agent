package com.sellerops.product;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.attention.AttentionCoverage;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.customermemory.CustomerMemoryEntryRepository;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.itemanalysis.ItemAnalysisRepository;
import com.sellerops.itemanalysis.ItemAnalysisService;
import com.sellerops.itemanalysis.RuleBasedInboxItemAnalyzer;
import com.sellerops.product.dto.ProductSignalsView;
import com.sellerops.product.dto.SignalCoverageView;
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
 * "A상품 요즘 문제 있어?" — and the two very different ways of answering "no".
 *
 * <p><b>This is the false-calm guard, one level below where it was first built.</b>
 * {@code docs/slices/attention-coverage-false-calm-v1.md} introduced {@link AttentionCoverage}
 * because an empty review-attention list was being rendered as "nothing needs attention" when the
 * truth was that reviews could not be attributed to an account. A product report has the same failure
 * mode with a sharper edge: {@code Cafe24ReviewPromoter} sets {@code productId = null} by design and
 * Coupang review rows are keyed on an option id, so for many real orgs "이 상품은 문제 없습니다" and
 * "이 상품에 연결된 데이터가 하나도 없습니다" are the same empty answer.
 *
 * <p>So what is asserted here is not that the numbers are right. It is that the two answers are
 * DISTINGUISHABLE — because that distinction is what the Evidence Judge downstream reads to decide
 * whether the agent may say "문제 없음" at all.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class ProductSignalsCoverageTest {

    @Autowired ProductRepository products;
    @Autowired ChannelProductRepository listings;
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
    private ProductSignalsService signals;

    @BeforeEach
    void setUp() {
        channelId = seedChannel();
        // @DataJpaTest loads repositories, not @Service beans, so the issue query service is built the
        // way ReviewIssueMemoryTest already builds it. Building the REAL one matters: the product
        // report must render issues through the issue memory's own judgements, never its own.
        ReviewIssueQueryService issueQuery = new ReviewIssueQueryService(issues, evidence, stateEvents,
                new com.sellerops.reviewissue.ReviewIssueSnapshotService(evidence), reviews, products);
        signals = new ProductSignalsService(new ProductQueryService(products, listings), issueQuery, evidence,
                analyses, reviews, inquiries, memory, channels);
    }

    @Test
    @DisplayName("a product with linked rows is COVERED — an empty issue list there is a real zero")
    void linkedRowsAreCovered() {
        Product product = product("합성-몰딩-1호", "SKU-1");
        review(product.getId(), "배송도 빠르고 아주 만족합니다", 5);

        ProductSignalsView view = signals.signals(org, product.getId(), null);

        assertThat(coverage(view, SignalCoverageView.REVIEW).coverage())
                .as("rows are attributed to this product, so its zero is a measured zero")
                .isEqualTo(AttentionCoverage.COVERED);
        assertThat(view.volume().reviews()).isEqualTo(1);
        assertThat(view.linkedChannels()).containsExactly("CAFE24");
    }

    @Test
    @DisplayName("a product whose channel never links rows is UNCERTAIN_PRODUCT_UNLINKED, not calm")
    void unlinkedChannelDataIsUncertainNotCalm() {
        Product product = product("합성-몰딩-1호", "SKU-1");
        // A Cafe24-promoted review: real, stored, and carrying no product link — exactly what
        // Cafe24ReviewPromoter produces today, and the reason this verdict exists.
        review(null, "붙이는 부분이 떨어졌어요", 1);

        ProductSignalsView view = signals.signals(org, product.getId(), null);

        assertThat(view.issues()).isEmpty();
        assertThat(coverage(view, SignalCoverageView.REVIEW).coverage())
                .as("there IS a 1-star review about this kind of product and we cannot attribute it — "
                        + "reporting that as 'no problems' is the exact harm this guard prevents")
                .isEqualTo(AttentionCoverage.UNCERTAIN_PRODUCT_UNLINKED);
        assertThat(coverage(view, SignalCoverageView.REVIEW).unlinked())
                .as("and the size of the blind spot is reported, not hidden")
                .isEqualTo(1);
        assertThat(view.hasUncertainSignal()).isTrue();
    }

    @Test
    @DisplayName("an org with no data at all is COVERED — a new seller is not told their data is broken")
    void anEmptyOrgIsAMeasuredZero() {
        Product product = product("합성-몰딩-1호", "SKU-1");

        ProductSignalsView view = signals.signals(org, product.getId(), null);

        assertThat(coverage(view, SignalCoverageView.REVIEW).coverage())
                .as("nothing linked AND nothing unlinked is a genuine zero, not a linkage gap")
                .isEqualTo(AttentionCoverage.COVERED);
    }

    @Test
    @DisplayName("a fully-linked org reports a measured zero for a quiet product, not 'cannot tell'")
    void aQuietProductInAFullyLinkedOrgIsAMeasuredZero() {
        // Found live 2026-08-21 on the demo org: 81 issue-evidence rows, ZERO of them unlinked, and yet
        // every product without an issue reported "판단할 수 없습니다". Declining to answer when we CAN
        // answer is a milder failure than the reverse, but it is still false — and a surface that cries
        // uncertainty everywhere teaches a seller to ignore it, which is how the real blind spots stop
        // being read.
        Product quiet = product("합성-조용한상품", "SKU-Q");
        Product noisy = product("합성-시끄러운상품", "SKU-N");
        review(noisy.getId(), "붙이는 부분이 떨어졌어요", 1);
        inquiry(noisy.getId(), "UNANSWERED");

        ProductSignalsView view = signals.signals(org, quiet.getId(), null);

        assertThat(coverage(view, SignalCoverageView.REVIEW).unlinked())
                .as("the precondition: this org attributes every row it has").isZero();
        assertThat(coverage(view, SignalCoverageView.REVIEW).coverage())
                .as("so this product having none is a fact about the product, not about our data")
                .isEqualTo(AttentionCoverage.COVERED);
        assertThat(coverage(view, SignalCoverageView.REVIEW_ISSUE).coverage())
                .isEqualTo(AttentionCoverage.COVERED);
        assertThat(coverage(view, SignalCoverageView.ITEM_ANALYSIS).coverage())
                .as("no rows to analyse is not an analysis gap")
                .isEqualTo(AttentionCoverage.COVERED);
        assertThat(view.hasUncertainSignal()).isFalse();
    }

    @Test
    @DisplayName("every signal source reports its own coverage and its own provenance")
    void everySourceCarriesCoverageAndProvenance() {
        Product product = product("합성-몰딩-1호", "SKU-1");
        Review linked = review(product.getId(), "붙이는 부분이 떨어졌어요", 1);
        new ItemAnalysisService(inquiries, reviews, analyses, new RuleBasedInboxItemAnalyzer())
                .analyzeForSources(org, "REVIEW", List.of(linked.getId()));

        ProductSignalsView view = signals.signals(org, product.getId(), null);

        assertThat(view.coverage()).extracting(SignalCoverageView::signal)
                .as("a reader must be able to ask each source separately whether it could answer")
                .containsExactlyInAnyOrder(SignalCoverageView.REVIEW_ISSUE, SignalCoverageView.ITEM_ANALYSIS,
                        SignalCoverageView.REVIEW, SignalCoverageView.INQUIRY,
                        SignalCoverageView.CUSTOMER_MEMORY);
        assertThat(coverage(view, SignalCoverageView.ITEM_ANALYSIS).provenance())
                .as("provenance is read off the stored analyzer, never hardcoded — the draftKindLabel rule")
                .contains("RULE_BASED");
    }

    @Test
    @DisplayName("unanswered inquiries are counted per product, using the org-wide status definition")
    void unansweredIsCountedPerProduct() {
        Product product = product("합성-몰딩-1호", "SKU-1");
        inquiry(product.getId(), "UNANSWERED");
        inquiry(product.getId(), "ANSWERED");
        inquiry(null, "UNANSWERED");

        ProductSignalsView view = signals.signals(org, product.getId(), null);

        assertThat(view.volume().inquiries()).isEqualTo(2);
        assertThat(view.volume().unansweredInquiries())
                .as("the same UNANSWERED status the home screen counts, narrowed by product")
                .isEqualTo(1);
    }


    /**
     * <b>A product screen counts this product's evidence, not the issue's</b> (pilot QA 2026-09-06).
     *
     * <p>{@code ReviewIssueView.evidenceCount} is org-wide, which is exactly right on the 고객운영
     * 메모리 list and exactly wrong under a product heading: 「접착 부족 · 근거 18건」 there is read as
     * eighteen pieces of evidence about that product. Measured on the demo org's top product: the row
     * said 18 where 16 were the product's, 배송 지연 said 6 where 4 were, and the section header stood
     * at 「근거 46건」 over 42 stored rows. The query this list is built from already returns the
     * product's own count; the code was discarding it.
     */
    @Test
    @DisplayName("an issue on a product page carries the product's evidence count, not the org-wide one")
    void issueCountsOnAProductAreTheProductsOwn() {
        Product mine = product("합성-몰딩-1호", "SKU-1");
        Product other = product("합성-몰딩-2호", "SKU-2");
        UUID issueId = issue("접착", "부족");
        evidenceRow(issueId, mine.getId());
        evidenceRow(issueId, mine.getId());
        evidenceRow(issueId, other.getId());

        ProductSignalsView view = signals.signals(org, mine.getId(), null);

        assertThat(view.issues()).singleElement()
                .extracting(com.sellerops.reviewissue.dto.ReviewIssueView::evidenceCount)
                .as("two of the three rows are this product's")
                .isEqualTo(2L);
        assertThat(view.volume().issueEvidence())
                .as("and the header that sums the rows sums the same numbers the rows show")
                .isEqualTo(2);
    }

    @Test
    @DisplayName("another org's product id is not found, and cannot be probed")
    void productLookupIsOrgScoped() {
        Product theirs = new Product();
        theirs.setOrgId(UUID.randomUUID());
        theirs.setName("남의 상품");
        theirs.setStatus("ACTIVE");
        Product saved = products.save(theirs);

        assertThatThrownBy(() -> signals.signals(org, saved.getId(), null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("상품을 찾을 수 없습니다.");
    }

    /* ───────────────────────────── fixtures ───────────────────────────── */

    private SignalCoverageView coverage(ProductSignalsView view, String signal) {
        return view.coverage().stream().filter(c -> c.signal().equals(signal)).findFirst().orElseThrow();
    }

    private Product product(String name, String sku) {
        Product product = new Product();
        product.setOrgId(org);
        product.setName(name);
        product.setSku(sku);
        product.setStatus("ACTIVE");
        return products.save(product);
    }

    private Review review(UUID productId, String body, int rating) {
        Review review = new Review();
        review.setOrgId(org);
        review.setChannelId(channelId);
        review.setProductId(productId);
        review.setRating(rating);
        review.setBody(body);
        review.setNegative(rating <= 2);
        review.setReceivedAt(Instant.parse("2026-08-14T00:00:00Z"));
        return reviews.save(review);
    }

    private Inquiry inquiry(UUID productId, String status) {
        Inquiry inquiry = new Inquiry();
        inquiry.setOrgId(org);
        inquiry.setChannelId(channelId);
        inquiry.setProductId(productId);
        inquiry.setTitle("문의");
        inquiry.setBody("확인 부탁드립니다");
        inquiry.setStatus(status);
        inquiry.setReceivedAt(Instant.parse("2026-08-18T00:00:00Z"));
        return inquiries.save(inquiry);
    }

    private UUID issue(String aspect, String problem) {
        com.sellerops.reviewissue.ReviewIssue row = new com.sellerops.reviewissue.ReviewIssue();
        row.setOrgId(org);
        row.setSignatureKey(aspect + ":" + problem);
        row.setTitle(aspect + " " + problem);
        row.setAspect(aspect);
        row.setProblem(problem);
        row.setSeverity(com.sellerops.reviewissue.IssueSeverity.NORMAL);
        row.setLifecycleState(com.sellerops.reviewissue.IssueLifecycleState.OBSERVING);
        row.setExtractorKind("RULE_BASED");
        row.setExtractorVersion("issue-rules-v2");
        row.setFirstEvidenceOn(java.time.LocalDate.parse("2026-08-14"));
        row.setLastEvidenceOn(java.time.LocalDate.parse("2026-08-14"));
        return issues.save(row).getId();
    }

    private void evidenceRow(UUID issueId, UUID productId) {
        Review source = review(productId, "붙이는 부분이 떨어졌어요", 1);
        com.sellerops.reviewissue.ReviewIssueEvidence row = new com.sellerops.reviewissue.ReviewIssueEvidence();
        row.setOrgId(org);
        row.setIssueId(issueId);
        row.setReviewId(source.getId());
        row.setUnitOrdinal(0);
        row.setProductId(productId);
        row.setOccurredOn(java.time.LocalDate.parse("2026-08-14"));
        row.setMatchConfidence(com.sellerops.reviewissue.MatchConfidence.EXACT_SIGNATURE);
        evidence.save(row);
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
