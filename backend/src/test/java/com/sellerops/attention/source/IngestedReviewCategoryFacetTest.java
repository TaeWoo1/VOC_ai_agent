package com.sellerops.attention.source;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;

import com.sellerops.attention.AttentionSignalType;
import com.sellerops.attention.OperatorAttentionService;
import com.sellerops.attention.dto.CategoryCount;
import com.sellerops.attention.dto.OperatorVocItem;
import com.sellerops.attention.dto.OperatorVocItemPage;
import com.sellerops.attention.reply.ReviewReplyApprovalRepository;
import com.sellerops.attention.reply.ReviewReplyDraftRepository;
import com.sellerops.attention.triage.ReviewTriageRepository;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.common.ApiException;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import com.sellerops.itemanalysis.ItemAnalysis;
import com.sellerops.itemanalysis.ItemAnalysisCategories;
import com.sellerops.itemanalysis.ItemAnalysisRepository;
import com.sellerops.product.ProductRepository;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewReplyState;
import com.sellerops.review.ReviewRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * The queue becomes a worklist: worst-first, each row saying what it is about, filterable by that.
 *
 * <p>What this slice deliberately does NOT do is change who is in the queue — that is still rating +
 * reply state alone. The classification is CONTEXT, and these tests are written to catch the two ways
 * it could stop being context: a row disappearing because nothing analyzed it, and a facet's counts
 * disagreeing with the list they label.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class IngestedReviewCategoryFacetTest {

    @Autowired ReviewRepository reviews;
    @Autowired ChannelRepository channels;
    @Autowired SellerAccountRepository sellerAccounts;
    @Autowired ProductRepository products;
    @Autowired ReviewTriageRepository triage;
    @Autowired ReviewReplyDraftRepository replyDrafts;
    @Autowired ReviewReplyApprovalRepository replyApprovals;
    @Autowired ItemAnalysisRepository itemAnalyses;
    @Autowired Cafe24CommunityArticleRepository communityArticles;

    private OperatorAttentionService attention;
    private final UUID org = UUID.randomUUID();
    private UUID channelId;
    private UUID accountId;

    private static final LocalDate FROM = LocalDate.parse("2026-05-01");
    private static final LocalDate TO = LocalDate.parse("2026-05-31");

    @BeforeEach
    void setUp() {
        attention = new OperatorAttentionService(sellerAccounts, channels,
                new VocItemSourceRegistry(List.of(
                        new Cafe24VocItemSource(communityArticles),
                        new IngestedReviewVocItemSource(reviews, sellerAccounts, products, triage,
                                replyDrafts, replyApprovals, itemAnalyses))));
        Channel ch = new Channel();
        ch.setCode("NAVER");
        ch.setNameKo("네이버 스마트스토어");
        ch.setStatus(ChannelStatus.AVAILABLE);
        ch.setSortOrder(0);
        channelId = channels.save(ch).getId();

        SellerAccount acc = new SellerAccount();
        acc.setOrgId(org);
        acc.setChannelId(channelId);
        acc.setConnectionStatus(ChannelStatus.CONNECTED);
        acc.setFileUpload(true);
        accountId = sellerAccounts.save(acc).getId();
    }

    /** A review with no analysis row — the coverage gap this surface must never hide. */
    private UUID seed(int rating, String receivedAt) {
        return seed(rating, receivedAt, ReviewReplyState.PENDING, org);
    }

    private UUID seed(int rating, String receivedAt, ReviewReplyState state, UUID ownerOrg) {
        Review r = new Review();
        r.setOrgId(ownerOrg);
        r.setChannelId(channelId);
        r.setRating(rating);
        r.setBody("합성 본문 " + rating + " " + receivedAt);
        r.setNegative(rating <= 2);
        r.setReceivedAt(Instant.parse(receivedAt));
        r.setReplyState(state);
        return reviews.save(r).getId();
    }

    /** A review WITH an analysis row carrying {@code category}. */
    private UUID seedClassified(int rating, String receivedAt, String category) {
        UUID reviewId = seed(rating, receivedAt);
        analyze(reviewId, category, org);
        return reviewId;
    }

    private void analyze(UUID reviewId, String category, UUID ownerOrg) {
        ItemAnalysis a = new ItemAnalysis();
        a.setOrgId(ownerOrg);
        a.setSourceType("REVIEW");
        a.setSourceId(reviewId);
        a.setSummary(category + " 관련 부정 리뷰");
        a.setCategory(category);
        a.setSentiment("NEGATIVE");
        a.setUrgency("HIGH");
        a.setRecommendedAction("확인 필요");
        a.setAnalyzerKind("RULE_BASED");
        a.setAnalyzerName("rule-based");
        a.setAnalyzerVersion("rules-v1");
        itemAnalyses.save(a);
    }

    private OperatorVocItemPage queue(String category) {
        return attention.attentionItems(org, accountId,
                AttentionSignalType.LOW_RATING_REVIEW.name(), FROM, TO, category, 0, 20);
    }

    // --- Ordering: the worklist rule ---

    @Test
    void theWorstReviewIsFirstEvenWhenItIsTheOldest() {
        // The whole point of the ordering change. Under the old date-desc order the 3★ from the 20th
        // outranked the 1★ from the 2nd, so an operator working top-down met their least urgent
        // review first. Seeded in the order that would PASS under date-desc if severity were ignored.
        seed(3, "2026-05-20T00:00:00Z");
        seed(1, "2026-05-02T00:00:00Z");
        seed(2, "2026-05-10T00:00:00Z");

        assertThat(queue(null).items()).extracting(OperatorVocItem::rating)
                .containsExactly(1, 2, 3);
    }

    @Test
    void withinOneRatingBandTheNewestIsStillFirst() {
        seed(1, "2026-05-02T00:00:00Z");
        seed(1, "2026-05-20T00:00:00Z");

        assertThat(queue(null).items()).extracting(OperatorVocItem::sourceCreatedDate)
                .containsExactly("2026-05-20", "2026-05-02");
    }

    @Test
    void theArrivalsLensStaysChronological() {
        // Arrivals are a RECORD of what came in, not a worklist. Re-ordering them by severity would
        // quietly turn "여기 새로 들어온 리뷰" into a second, differently-sorted queue.
        seed(3, "2026-05-20T00:00:00Z");
        seed(1, "2026-05-02T00:00:00Z");

        OperatorVocItemPage arrivals = attention.attentionItems(org, accountId,
                AttentionSignalType.NEW_REVIEW.name(), FROM, TO, null, 0, 20);

        assertThat(arrivals.items()).extracting(OperatorVocItem::rating).containsExactly(3, 1);
    }

    // --- The row's category, and the absence of one ---

    @Test
    void aClassifiedRowCarriesItsCategoryAndAnUnanalyzedRowCarriesNull() {
        seedClassified(1, "2026-05-05T00:00:00Z", ItemAnalysisCategories.DELIVERY);
        seed(2, "2026-05-06T00:00:00Z");   // nothing ever analyzed this one

        assertThat(queue(null).items())
                .extracting(OperatorVocItem::rating, OperatorVocItem::category)
                .containsExactly(tuple(1, "배송"), tuple(2, null));
    }

    @Test
    void anUnanalyzedRowIsStillFullyInTheQueue() {
        // FAIL OPEN. Analysis runs on newly-inserted ids only and swallows its own failures, so a
        // missing analysis says nothing about the review. Filtering these out would silently shrink
        // an operator's backlog in exactly the case where the system already failed once.
        seed(1, "2026-05-05T00:00:00Z");

        assertThat(queue(null).total()).isEqualTo(1);
        assertThat(queue(null).items()).singleElement()
                .satisfies(row -> assertThat(row.category()).isNull());
    }

    @Test
    void aCrossOrgAnalysisNeverColoursAReview() {
        // item_analyses.source_id is a bare polymorphic reference with no FK, so a same-id row from
        // another org is a real possibility rather than a hypothetical.
        UUID reviewId = seed(1, "2026-05-05T00:00:00Z");
        analyze(reviewId, ItemAnalysisCategories.QUALITY, UUID.randomUUID());

        assertThat(queue(null).items()).singleElement()
                .satisfies(row -> assertThat(row.category()).isNull());
        assertThat(queue(null).unclassifiedCount()).isEqualTo(1);
    }

    // --- The facet ---

    @Test
    void filteringByCategoryNarrowsTheListAndItsTotal() {
        seedClassified(1, "2026-05-05T00:00:00Z", ItemAnalysisCategories.DELIVERY);
        seedClassified(2, "2026-05-06T00:00:00Z", ItemAnalysisCategories.QUALITY);
        seed(3, "2026-05-07T00:00:00Z");

        OperatorVocItemPage delivery = queue(ItemAnalysisCategories.DELIVERY);

        assertThat(delivery.total()).isEqualTo(1);
        assertThat(delivery.items()).extracting(OperatorVocItem::category).containsExactly("배송");
    }

    @Test
    void theUnclassifiedSentinelSelectsExactlyTheRowsNothingAnalyzed() {
        seedClassified(1, "2026-05-05T00:00:00Z", ItemAnalysisCategories.DELIVERY);
        seed(2, "2026-05-06T00:00:00Z");

        OperatorVocItemPage unclassified = queue(ItemAnalysisCategories.UNCLASSIFIED);

        assertThat(unclassified.total()).isEqualTo(1);
        assertThat(unclassified.items()).singleElement()
                .satisfies(row -> assertThat(row.category()).isNull());
    }

    @Test
    void theFallbackCategoryIsNotTheSameAsUnclassified() {
        // 기타 is a VERDICT ("we looked; it fits nothing"); unclassified is a COVERAGE GAP ("we never
        // looked"). Collapsing them would report a system failure as a fact about the reviews.
        seedClassified(1, "2026-05-05T00:00:00Z", ItemAnalysisCategories.FALLBACK);
        seed(2, "2026-05-06T00:00:00Z");

        assertThat(queue(ItemAnalysisCategories.FALLBACK).total()).isEqualTo(1);
        assertThat(queue(ItemAnalysisCategories.UNCLASSIFIED).total()).isEqualTo(1);
        assertThat(queue(null).categoryCounts()).containsExactly(new CategoryCount("기타", 1L));
        assertThat(queue(null).unclassifiedCount()).isEqualTo(1);
    }

    @Test
    void theAnsweredExclusionStillAppliesInsideAFacet() {
        // The facet narrows the queue; it must not re-admit anyone to it.
        UUID answered = seed(1, "2026-05-05T00:00:00Z", ReviewReplyState.ANSWERED, org);
        analyze(answered, ItemAnalysisCategories.DELIVERY, org);
        seedClassified(2, "2026-05-06T00:00:00Z", ItemAnalysisCategories.DELIVERY);

        OperatorVocItemPage delivery = queue(ItemAnalysisCategories.DELIVERY);

        assertThat(delivery.total()).isEqualTo(1);
        assertThat(delivery.items()).singleElement()
                .satisfies(row -> assertThat(row.rating()).isEqualTo(2));
        assertThat(delivery.categoryCounts()).containsExactly(new CategoryCount("배송", 1L));
    }

    @Test
    void anUnrecognisedCategoryIsRejectedRatherThanRenderedAsAnEmptyResult() {
        // An empty page would read as "확인이 필요한 리뷰 중 그런 건 없습니다" — a claim about the seller's
        // reviews — when the truth is that the request named something that is not a category.
        seedClassified(1, "2026-05-05T00:00:00Z", ItemAnalysisCategories.DELIVERY);

        assertThatThrownBy(() -> queue("배송지연"))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("지원되지 않는 분류");
    }

    @Test
    void aBlankCategoryMeansNoFilterNotAnEmptyResult() {
        seedClassified(1, "2026-05-05T00:00:00Z", ItemAnalysisCategories.DELIVERY);

        assertThat(queue("   ").total()).isEqualTo(1);
    }

    // --- The counts, and the total they are comparable to ---

    @Test
    void theBreakdownIsUnfilteredWhileTheListTotalIsFiltered() {
        // THE invariant, asserted with a facet ACTIVE — which is the only way it can catch the
        // mistake it exists for. sum(categories) + unclassified must reconcile with unfilteredTotal,
        // never with total: the two totals are equal only when no facet is applied, so a test written
        // against `total` would pass here and be wrong the moment an operator clicks a facet.
        seedClassified(1, "2026-05-05T00:00:00Z", ItemAnalysisCategories.DELIVERY);
        seedClassified(2, "2026-05-06T00:00:00Z", ItemAnalysisCategories.DELIVERY);
        seedClassified(3, "2026-05-07T00:00:00Z", ItemAnalysisCategories.QUALITY);
        seed(3, "2026-05-08T00:00:00Z");                       // unclassified

        OperatorVocItemPage delivery = queue(ItemAnalysisCategories.DELIVERY);

        assertThat(delivery.total()).isEqualTo(2);             // narrows with the facet
        assertThat(delivery.unfilteredTotal()).isEqualTo(4);   // does not
        assertThat(delivery.categoryCounts())
                .containsExactly(new CategoryCount("배송", 2L), new CategoryCount("품질", 1L));
        assertThat(delivery.unclassifiedCount()).isEqualTo(1);

        long reconciled = delivery.categoryCounts().stream().mapToLong(CategoryCount::count).sum()
                + delivery.unclassifiedCount();
        assertThat(reconciled).isEqualTo(delivery.unfilteredTotal());
        assertThat(reconciled).isNotEqualTo(delivery.total());  // non-vacuous: the two differ here
    }

    @Test
    void theBreakdownIsOrderedByTheCanonicalVocabularyNotByCount() {
        // A facet list that reshuffles between reads is one an operator cannot build a habit around.
        // 품질 outnumbers 배송 here, so a count-ordered list would put it first.
        seedClassified(1, "2026-05-05T00:00:00Z", ItemAnalysisCategories.QUALITY);
        seedClassified(2, "2026-05-06T00:00:00Z", ItemAnalysisCategories.QUALITY);
        seedClassified(3, "2026-05-07T00:00:00Z", ItemAnalysisCategories.DELIVERY);

        assertThat(queue(null).categoryCounts()).extracting(CategoryCount::category)
                .containsExactly("배송", "품질");   // ItemAnalysisCategories.ORDERED order
    }

    @Test
    void aCategoryThisWindowHasNoneOfIsOmittedRatherThanShownAsZero() {
        seedClassified(1, "2026-05-05T00:00:00Z", ItemAnalysisCategories.DELIVERY);

        assertThat(queue(null).categoryCounts()).extracting(CategoryCount::category)
                .containsExactly("배송");
    }

    @Test
    void theBreakdownExcludesAnsweredRowsJustAsTheCountAndListDo() {
        UUID answered = seed(1, "2026-05-05T00:00:00Z", ReviewReplyState.ANSWERED, org);
        analyze(answered, ItemAnalysisCategories.DELIVERY, org);

        assertThat(queue(null).categoryCounts()).isEmpty();
        assertThat(queue(null).unfilteredTotal()).isZero();
    }

    @Test
    void aNonCanonicalStoredCategoryIsOmittedFromTheBreakdownButNeverHidesItsRow() {
        // Pins the ONE documented exception to the reconciliation identity, rather than assuming a
        // writer bug cannot happen. Such a category cannot be offered as a facet — the API answers
        // it with a 400 — so counting it would advertise an option that errors on click. But the
        // ROW is untouched: it stays in the queue carrying its category, because the operator's
        // backlog must not shrink over a defect in a field that only annotates it.
        UUID reviewId = seed(1, "2026-05-05T00:00:00Z");
        analyze(reviewId, "배송지연", org);          // not in ItemAnalysisCategories
        seedClassified(2, "2026-05-06T00:00:00Z", ItemAnalysisCategories.DELIVERY);

        OperatorVocItemPage page = queue(null);

        assertThat(page.items()).extracting(OperatorVocItem::category)
                .containsExactly("배송지연", "배송");
        assertThat(page.categoryCounts()).containsExactly(new CategoryCount("배송", 1L));
        assertThat(page.unclassifiedCount()).isZero();   // it HAS an analysis — just not a usable one
        assertThat(page.unfilteredTotal()).isEqualTo(2);

        // The identity falls short by exactly the unusable row — the documented deviation.
        long reconciled = page.categoryCounts().stream().mapToLong(CategoryCount::count).sum()
                + page.unclassifiedCount();
        assertThat(reconciled).isEqualTo(page.unfilteredTotal() - 1);
    }

    @Test
    void theArrivalsLensOffersNoBreakdown() {
        // The facet belongs to the worklist. Arrivals report what came in, and slicing that by
        // category would present a second, differently-scoped queue under the same window.
        seedClassified(1, "2026-05-05T00:00:00Z", ItemAnalysisCategories.DELIVERY);

        OperatorVocItemPage arrivals = attention.attentionItems(org, accountId,
                AttentionSignalType.NEW_REVIEW.name(), FROM, TO, null, 0, 20);

        assertThat(arrivals.categoryCounts()).isEmpty();
        assertThat(arrivals.unclassifiedCount()).isZero();
        assertThat(arrivals.unfilteredTotal()).isEqualTo(arrivals.total());
    }
}
