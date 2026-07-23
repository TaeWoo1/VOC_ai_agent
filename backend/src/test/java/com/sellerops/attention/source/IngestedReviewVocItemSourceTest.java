package com.sellerops.attention.source;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

import com.sellerops.attention.AttentionSignalType;
import com.sellerops.attention.OperatorAttentionService;
import com.sellerops.attention.dto.AttentionSignal;
import com.sellerops.attention.dto.OperatorAttentionSummary;
import com.sellerops.attention.dto.OperatorVocItem;
import com.sellerops.attention.dto.OperatorVocItemPage;
import com.sellerops.attention.reply.ReviewReplyApproval;
import com.sellerops.attention.reply.ReviewReplyApprovalRepository;
import com.sellerops.attention.reply.ReviewReplyApprovalState;
import com.sellerops.attention.reply.ReviewReplyDraft;
import com.sellerops.attention.reply.ReviewReplyDraftRepository;
import com.sellerops.attention.triage.ReviewTriageRepository;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import com.sellerops.product.Product;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.ProductService;
import com.sellerops.review.Review;
import com.sellerops.itemanalysis.ItemAnalysisRepository;
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
 * Ingested NAVER/ESM+ reviews reaching the operator attention surface through the
 * existing seam — driven end-to-end via the real {@link OperatorAttentionService} on
 * a real (H2) DB, so the registry routing, the shared rules, and the shared sanitizer
 * are all exercised rather than mocked.
 *
 * <p>Both sources are registered in every test, because the interesting failures are
 * about which source answers: CAFE24 must keep reaching the community-article store
 * (double-counting a Cafe24 review across both stores is the hazard this adapter's
 * channel allow-list exists to prevent), and NAVER must reach this one. GMARKET must
 * reach neither — it keeps its existing no-adapter empty state, covered here and by
 * {@code EsmAttentionEmptyStateTest}.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class IngestedReviewVocItemSourceTest {

    @Autowired SellerAccountRepository sellerAccounts;
    @Autowired ChannelRepository channels;
    @Autowired ReviewRepository reviews;
    @Autowired Cafe24CommunityArticleRepository articles;
    @Autowired ProductRepository products;
    @Autowired ReviewTriageRepository triage;
    @Autowired ReviewReplyDraftRepository replyDrafts;
    @Autowired ReviewReplyApprovalRepository replyApprovals;
    @Autowired ItemAnalysisRepository itemAnalyses;

    private OperatorAttentionService service;
    private VocItemSourceRegistry registry;
    private final UUID org = UUID.randomUUID();

    private static final LocalDate FROM = LocalDate.parse("2026-05-01");
    private static final LocalDate TO = LocalDate.parse("2026-05-31");

    // Synthetic review bodies — never captured content.
    private static final String BODY_LOW = "합성-리뷰-본문-불만";
    private static final String BODY_MID = "합성-리뷰-본문-보통";
    // Zone-discriminating markers: each falls inside exactly one of the KST/UTC windows.
    private static final String ONLY_IN_KST_WINDOW = "합성-리뷰-KST창에만";
    private static final String ONLY_IN_UTC_WINDOW = "합성-리뷰-UTC창에만";

    @BeforeEach
    void setUp() {
        registry = new VocItemSourceRegistry(List.of(
                new Cafe24VocItemSource(articles),
                new IngestedReviewVocItemSource(reviews, sellerAccounts, products, triage,
                        replyDrafts, replyApprovals, itemAnalyses)));
        service = new OperatorAttentionService(sellerAccounts, channels, registry);
    }

    // --- registry routing -------------------------------------------------------

    @Test
    void registryRoutesNaverHereAndLeavesEveryOtherChannelAlone() {
        assertThat(registry.forChannel("NAVER")).containsInstanceOf(IngestedReviewVocItemSource.class);
        // Load-bearing: /api/uploads accepts any channel, so a Cafe24 review can exist in
        // BOTH stores. If this source ever claimed CAFE24 it would double-count.
        assertThat(registry.forChannel("CAFE24")).containsInstanceOf(Cafe24VocItemSource.class);
        // GMARKET keeps its EXISTING no-adapter empty state, and that is deliberate: it is
        // the one channel shared by both ESM+ marketplaces (EsmMarketplace: GMARKET +
        // AUCTION), and each selling id onboards its own account, so an ESM+ seller
        // routinely holds two accounts on it — exactly the shape the ambiguity guard
        // declines. Claiming the channel would make this surface silently unsupported for
        // the ESM+ sellers it appeared to serve, and would shadow ESM+'s real,
        // account-scoped inquiry store behind this source's hard-zero inquiry counts.
        assertThat(registry.forChannel("GMARKET")).isEmpty();
        // Channels with no export contract stay on the honest empty state.
        assertThat(registry.forChannel("COUPANG")).isEmpty();
        assertThat(registry.forChannel(null)).isEmpty();
    }

    @Test
    void cafe24RoutingHoldsWhateverOrderTheSourcesAreRegisteredIn() {
        // VocItemSourceRegistry is first-wins over an injected List, and Spring does not
        // guarantee bean order — so asserting CAFE24 routing with the Cafe24 source listed
        // first proves only the ordering, not the exclusion. Register this source FIRST:
        // CAFE24 must still reach the community store, because this one declines it.
        VocItemSourceRegistry reversed = new VocItemSourceRegistry(List.of(
                new IngestedReviewVocItemSource(reviews, sellerAccounts, products, triage,
                        replyDrafts, replyApprovals, itemAnalyses),
                new Cafe24VocItemSource(articles)));

        assertThat(reversed.forChannel("CAFE24")).containsInstanceOf(Cafe24VocItemSource.class);
        assertThat(reversed.forChannel("NAVER")).containsInstanceOf(IngestedReviewVocItemSource.class);
    }

    @Test
    void supportsIsExactAndNullSafe() {
        IngestedReviewVocItemSource source = new IngestedReviewVocItemSource(reviews, sellerAccounts, products, triage,
                        replyDrafts, replyApprovals, itemAnalyses);
        assertThat(source.supports("NAVER")).isTrue();
        assertThat(source.supports("CAFE24")).isFalse();
        assertThat(source.supports("GMARKET")).isFalse();
        assertThat(source.supports("COUPANG")).isFalse();
        assertThat(source.supports(null)).isFalse();
        assertThat(source.supports("naver")).isFalse();
    }

    // --- rating bands + unrated exclusion ---------------------------------------

    @Test
    void ratingBandsBecomeRankedSignalsThroughTheSharedRules() {
        UUID channelId = seedChannel("NAVER", "네이버 스마트스토어");
        UUID accountId = seedAccount(channelId);

        review(channelId, "2026-05-05T03:00:00Z", 1, BODY_LOW);   // low  (1-2)
        review(channelId, "2026-05-06T03:00:00Z", 2, BODY_LOW);   // low
        review(channelId, "2026-05-07T03:00:00Z", 3, BODY_MID);   // mid  (3)
        review(channelId, "2026-05-08T03:00:00Z", 5, BODY_MID);   // neither, still "new"
        review(channelId, "2026-04-01T03:00:00Z", 1, BODY_LOW);   // before window

        OperatorAttentionSummary s = service.attention(org, accountId, FROM, TO);

        assertThat(s.channel()).isEqualTo("네이버 스마트스토어");
        // newReviews=4, low(1-2)=2, mid(3)=1 — and NO inquiry signals: this store has none.
        assertThat(s.items()).extracting(AttentionSignal::type, AttentionSignal::severity, AttentionSignal::count)
                .containsExactly(
                        tuple("LOW_RATING_REVIEW", "HIGH", 2L),
                        tuple("LOW_RATING_REVIEW", "MEDIUM", 1L),
                        tuple("NEW_REVIEW", "LOW", 4L));
    }

    @Test
    void unratedReviewsCountAsNewButNeverAsLowOrMidRating() {
        UUID channelId = seedChannel("NAVER", "네이버 스마트스토어");
        UUID accountId = seedAccount(channelId);

        review(channelId, "2026-05-05T03:00:00Z", null, BODY_MID);
        review(channelId, "2026-05-06T03:00:00Z", null, BODY_MID);

        OperatorAttentionSummary s = service.attention(org, accountId, FROM, TO);

        // A null rating is unknown, not bad — it must never manufacture a HIGH signal.
        assertThat(s.items()).extracting(AttentionSignal::type, AttentionSignal::count)
                .containsExactly(tuple("NEW_REVIEW", 2L));

        // Nor may it appear behind the low-rating drill-down (minRating=1 excludes it).
        OperatorVocItemPage page = service.attentionItems(
                org, accountId, "LOW_RATING_REVIEW", FROM, TO, null, 0, 20);
        assertThat(page.total()).isZero();
        assertThat(page.items()).isEmpty();
    }

    // --- hasReplyPreparation ----------------------------------------------------

    /**
     * The flag exists so reply work cannot be stranded, so the case that matters is the one
     * where the disposition alone would hide it: a draft exists, and the operator has since
     * re-triaged the review away from RESPONSE_NEEDED. The client mounts its panel on
     * {@code RESPONSE_NEEDED || hasReplyPreparation}, and without this the draft would be
     * unreachable and any approval unwithdrawable.
     */
    @Test
    void aRowReportsItsReplyWorkEvenAfterTheReviewIsRetriagedAway() {
        UUID channelId = seedChannel("NAVER", "네이버 스마트스토어");
        UUID accountId = seedAccount(channelId);
        Review r = review(channelId, "2026-05-06T03:00:00Z", 1, BODY_LOW);
        seedDraft(r.getId());
        // No triage row at all — the harshest version of the case: nothing says
        // RESPONSE_NEEDED, so only this flag can reveal the work.

        OperatorVocItemPage page = service.attentionItems(
                org, accountId, "LOW_RATING_REVIEW", FROM, TO, null, 0, 20);

        assertThat(page.items()).singleElement().satisfies(i -> {
            assertThat(i.triageDisposition()).isNull();
            assertThat(i.hasReplyPreparation()).isTrue();
        });
    }

    @Test
    void aRowWithNoReplyWorkReportsFalse() {
        UUID channelId = seedChannel("NAVER", "네이버 스마트스토어");
        UUID accountId = seedAccount(channelId);
        review(channelId, "2026-05-06T03:00:00Z", 1, BODY_LOW);

        OperatorVocItemPage page = service.attentionItems(
                org, accountId, "LOW_RATING_REVIEW", FROM, TO, null, 0, 20);

        assertThat(page.items()).singleElement()
                .satisfies(i -> assertThat(i.hasReplyPreparation()).isFalse());
    }

    /** One review's work must not bleed onto its neighbours on the same page. */
    @Test
    void replyWorkDoesNotBleedOntoNeighbouringRows() {
        UUID channelId = seedChannel("NAVER", "네이버 스마트스토어");
        UUID accountId = seedAccount(channelId);
        Review prepared = review(channelId, "2026-05-06T03:00:00Z", 1, ONLY_IN_KST_WINDOW);
        review(channelId, "2026-05-07T03:00:00Z", 1, BODY_LOW);
        seedDraft(prepared.getId());

        OperatorVocItemPage page = service.attentionItems(
                org, accountId, "LOW_RATING_REVIEW", FROM, TO, null, 0, 20);

        assertThat(page.items()).hasSize(2);
        assertThat(page.items())
                .filteredOn(i -> ONLY_IN_KST_WINDOW.equals(i.safePreview()))
                .singleElement()
                .satisfies(i -> assertThat(i.hasReplyPreparation()).isTrue());
        assertThat(page.items())
                .filteredOn(i -> BODY_LOW.equals(i.safePreview()))
                .singleElement()
                .satisfies(i -> assertThat(i.hasReplyPreparation()).isFalse());
    }

    /**
     * Org-scoped at the query boundary. A review id is not proof of ownership, so another
     * org's draft on the same review id must be invisible — the same rule the disposition
     * batch read follows.
     */
    @Test
    void anotherOrgsReplyWorkOnTheSameReviewIdIsInvisibleHere() {
        UUID channelId = seedChannel("NAVER", "네이버 스마트스토어");
        UUID accountId = seedAccount(channelId);
        Review r = review(channelId, "2026-05-06T03:00:00Z", 1, BODY_LOW);

        ReviewReplyDraft foreign = new ReviewReplyDraft();
        foreign.setOrgId(UUID.randomUUID()); // not this org
        foreign.setReviewId(r.getId());
        foreign.setVersion(1);
        foreign.setBody("합성-남의-초안");
        foreign.setContentFingerprint("f".repeat(64));
        foreign.setFingerprintAlgorithm("review-reply-v1");
        foreign.setCreatedBy("SELLER:" + UUID.randomUUID());
        replyDrafts.save(foreign);

        OperatorVocItemPage page = service.attentionItems(
                org, accountId, "LOW_RATING_REVIEW", FROM, TO, null, 0, 20);

        assertThat(page.items()).singleElement()
                .satisfies(i -> assertThat(i.hasReplyPreparation()).isFalse());
    }

    /**
     * The approval half of the union, which the draft cases never reach.
     *
     * <p>The repository's own note argues that an approval implies a draft — so the draft
     * query "should" already cover every approved review, and this branch would be dead. That
     * implication rests on a rule in a service, not on the schema, which is exactly why the
     * union does not derive one from the other. An approval row with no draft is unreachable
     * through the product today; if it ever becomes reachable, the flag must still find it,
     * and only this test says so.
     */
    @Test
    void aRowWithAnApprovalButNoDraftStillReportsReplyWork() {
        UUID channelId = seedChannel("NAVER", "네이버 스마트스토어");
        UUID accountId = seedAccount(channelId);
        Review r = review(channelId, "2026-05-06T03:00:00Z", 1, BODY_LOW);

        ReviewReplyApproval a = new ReviewReplyApproval();
        a.setOrgId(org);
        a.setReviewId(r.getId());
        a.setState(ReviewReplyApprovalState.WITHDRAWN);
        a.setDecidedBy("SELLER:" + UUID.randomUUID());
        a.setDecidedAt(Instant.parse("2026-05-07T03:00:00Z"));
        replyApprovals.save(a);

        OperatorVocItemPage page = service.attentionItems(
                org, accountId, "LOW_RATING_REVIEW", FROM, TO, null, 0, 20);

        assertThat(page.items()).singleElement()
                .satisfies(i -> assertThat(i.hasReplyPreparation()).isTrue());
    }

    /** Minimal draft row — the flag only cares that work EXISTS, not what it says. */
    private void seedDraft(UUID reviewId) {
        ReviewReplyDraft d = new ReviewReplyDraft();
        d.setOrgId(org);
        d.setReviewId(reviewId);
        d.setVersion(1);
        d.setBody("합성-답변-초안");
        d.setContentFingerprint("a".repeat(64));
        d.setFingerprintAlgorithm("review-reply-v1");
        d.setCreatedBy("SELLER:" + UUID.randomUUID());
        replyDrafts.save(d);
    }

    // --- KST window boundaries --------------------------------------------------

    @Test
    void windowDayBoundariesAreInterpretedInKst() {
        UUID channelId = seedChannel("NAVER", "네이버 스마트스토어");
        UUID accountId = seedAccount(channelId);

        // KST window [2026-05-01, 2026-05-31] = [2026-04-30T15:00Z, 2026-05-31T15:00Z).
        // UTC window would be                 = [2026-05-01T00:00Z, 2026-06-01T00:00Z).
        // These two rows sit in exactly one window each, and in DIFFERENT ones — so the
        // pair discriminates the zone by identity. Asserting a COUNT here would not: both
        // zones admit exactly one of them, and a count-only assertion passes under either.
        review(channelId, "2026-04-30T15:00:00Z", 1, ONLY_IN_KST_WINDOW);   // 2026-05-01 KST
        review(channelId, "2026-05-31T15:00:00Z", 1, ONLY_IN_UTC_WINDOW);   // 2026-06-01 KST

        OperatorVocItemPage page = service.attentionItems(
                org, accountId, "LOW_RATING_REVIEW", FROM, TO, null, 0, 20);

        assertThat(page.total()).isEqualTo(1);
        assertThat(page.items()).singleElement().satisfies(i -> {
            assertThat(i.safePreview()).isEqualTo(ONLY_IN_KST_WINDOW);
            assertThat(i.safePreview()).isNotEqualTo(ONLY_IN_UTC_WINDOW);
            assertThat(i.sourceCreatedDate()).isEqualTo("2026-05-01");   // KST calendar day
        });
    }

    @Test
    void theInstantBeforeTheKstWindowOpensIsExcluded() {
        UUID channelId = seedChannel("NAVER", "네이버 스마트스토어");
        UUID accountId = seedAccount(channelId);

        review(channelId, "2026-04-30T14:59:59Z", 1, BODY_LOW);   // 1s before open -> out
        review(channelId, "2026-04-30T15:00:00Z", 2, BODY_LOW);   // first instant  -> in
        review(channelId, "2026-05-31T14:59:59Z", 2, BODY_LOW);   // last instant   -> in

        OperatorAttentionSummary s = service.attention(org, accountId, FROM, TO);

        // Half-open [from, toExclusive): the open edge is inclusive, so 2 of 3 land.
        assertThat(s.items()).extracting(AttentionSignal::type, AttentionSignal::count)
                .contains(tuple("LOW_RATING_REVIEW", 2L));
    }

    @Test
    void aDateOnlyExportRowLandsInItsOwnCalendarDay() {
        UUID channelId = seedChannel("NAVER", "네이버 스마트스토어");
        UUID accountId = seedAccount(channelId);

        // DateParse.instantAtStartOfDay stamps an export's "2026.05.01." at UTC midnight,
        // while this window is KST. UTC midnight on D is 09:00 KST on D — a +9 shift that
        // lands mid-day — so a date-only export row falls in its own calendar day with 9h
        // of slack either side. That is the property pinned here, and it holds under both
        // zones by construction; the zone itself is pinned by
        // windowDayBoundariesAreInterpretedInKst, not by this test.
        review(channelId, "2026-05-01T00:00:00Z", 1, BODY_LOW);   // first day of window
        review(channelId, "2026-05-31T00:00:00Z", 1, BODY_LOW);   // last day of window
        review(channelId, "2026-04-30T00:00:00Z", 1, BODY_LOW);   // day before -> out

        OperatorAttentionSummary s = service.attention(org, accountId, FROM, TO);

        assertThat(s.items()).extracting(AttentionSignal::type, AttentionSignal::count)
                .contains(tuple("LOW_RATING_REVIEW", 2L));
    }

    // --- cross-org isolation ----------------------------------------------------

    @Test
    void anotherOrgsReviewsOnTheSameChannelAreNeverCounted() {
        UUID channelId = seedChannel("NAVER", "네이버 스마트스토어");
        UUID accountId = seedAccount(channelId);
        review(channelId, "2026-05-05T03:00:00Z", 1, BODY_LOW);

        // Same channel, different tenant — reviews are scoped org+channel, so a missing
        // org predicate anywhere would leak these into our counts.
        UUID otherOrg = UUID.randomUUID();
        Review foreign = new Review();
        foreign.setOrgId(otherOrg);
        foreign.setChannelId(channelId);
        foreign.setRating(1);
        foreign.setBody("합성-타사-리뷰-본문");
        foreign.setNegative(true);
        foreign.setReceivedAt(Instant.parse("2026-05-06T03:00:00Z"));
        reviews.save(foreign);

        // containsExactly, not contains: every count must be pinned. A leak in the plain
        // window count (NEW_REVIEW) and a leak in the rating-bucket count
        // (LOW_RATING_REVIEW) are separate queries, and a `contains` assertion on one of
        // them lets the other's leak through unnoticed.
        OperatorAttentionSummary s = service.attention(org, accountId, FROM, TO);
        assertThat(s.items()).extracting(AttentionSignal::type, AttentionSignal::severity, AttentionSignal::count)
                .containsExactly(
                        tuple("LOW_RATING_REVIEW", "HIGH", 1L),
                        tuple("NEW_REVIEW", "LOW", 1L));

        OperatorVocItemPage page = service.attentionItems(
                org, accountId, "LOW_RATING_REVIEW", FROM, TO, null, 0, 20);
        assertThat(page.total()).isEqualTo(1);
        assertThat(page.items()).extracting(OperatorVocItem::safePreview)
                .doesNotContain("합성-타사-리뷰-본문");
    }

    // --- evidence exposed by the DTO (incl. the product DISPLAY name, never identity) --

    @Test
    void drillDownExposesSanitizedReviewEvidenceOnly() {
        UUID channelId = seedChannel("NAVER", "네이버 스마트스토어");
        UUID accountId = seedAccount(channelId);
        UUID productId = seedProduct("합성-상품명-머그컵", "SKU-1001");
        Review r = review(channelId, "2026-05-05T03:00:00Z", 1, BODY_LOW);
        r.setProductId(productId);
        reviews.save(r);

        OperatorVocItemPage page = service.attentionItems(
                org, accountId, "LOW_RATING_REVIEW", FROM, TO, null, 0, 20);

        assertThat(page.signalType()).isEqualTo("LOW_RATING_REVIEW");
        assertThat(page.total()).isEqualTo(1);
        OperatorVocItem item = page.items().get(0);
        assertThat(item.channelCode()).isEqualTo("NAVER");
        assertThat(item.channelNameKo()).isEqualTo("네이버 스마트스토어");
        assertThat(item.sourceType()).isEqualTo("REVIEW");
        assertThat(item.rating()).isEqualTo(1);
        assertThat(item.sourceCreatedDate()).isEqualTo("2026-05-05");   // KST calendar day
        assertThat(item.collectedDate()).isNotNull();                   // when SellerOps ingested it
        assertThat(item.signalType()).isEqualTo("LOW_RATING_REVIEW");
        assertThat(item.safePreview()).isEqualTo(BODY_LOW);             // sanitized evidence
        // The CHANNEL's own statement, from the import's 답글여부. This row was seeded without one,
        // so it reads UNKNOWN — honestly "not known", never guessed into an answer (a guess would
        // silently drop the row out of the operator's queue).
        assertThat(item.replyStatus()).isEqualTo("UNKNOWN");

        // The product DISPLAY name is now evidence the operator sees; its IDENTITY is not.
        assertThat(item.productName()).isEqualTo("합성-상품명-머그컵");
        // The review→product link still holds underneath — the name is resolved through it,
        // not stamped onto the row.
        assertThat(reviews.findAllByOrgId(org)).singleElement()
                .satisfies(saved -> assertThat(saved.getProductId()).isEqualTo(productId));
    }

    @Test
    void aNameDistinctFromItsSkuSurfacesWhileTheSkuAndProductIdStayHidden() {
        UUID channelId = seedChannel("NAVER", "네이버 스마트스토어");
        UUID accountId = seedAccount(channelId);
        // The ordinary case: a real 상품명 alongside its 상품번호. The name surfaces; the SKU
        // and the internal product id must not, anywhere on the row.
        //
        // NOTE this test cannot prove "the SKU never surfaces" in general — on this fixture
        // name != sku, so that assertion cannot fail. It once carried that name and that claim,
        // which is exactly how the name==sku leak survived. The real evidence for the SKU rule
        // is aSkuNamedProductIsWithheldBecauseItsNameIsItsIdentity below (the unit rule) and
        // ExportToAttentionChainTest (the state ingest actually produces).
        UUID productId = seedProduct("합성-상품명-머그컵", "SKU-9876543");
        Review r = review(channelId, "2026-05-05T03:00:00Z", 1, BODY_LOW);
        r.setProductId(productId);
        reviews.save(r);

        OperatorVocItemPage page = service.attentionItems(
                org, accountId, "LOW_RATING_REVIEW", FROM, TO, null, 0, 20);

        OperatorVocItem item = page.items().get(0);
        assertThat(item.productName()).isEqualTo("합성-상품명-머그컵");
        assertThat(item.toString()).doesNotContain("SKU-9876543").doesNotContain("9876543")
                .doesNotContain(productId.toString());
    }

    @Test
    void aSkuNamedProductIsWithheldBecauseItsNameIsItsIdentity() {
        UUID channelId = seedChannel("NAVER", "네이버 스마트스토어");
        UUID accountId = seedAccount(channelId);
        // The cell the original test matrix missed. ProductService stores the SKU AS the name
        // when an ingested row has a 상품번호 but no 상품명, so name == sku is a state normal
        // operation produces — and then the "display name" IS the identifier. Withheld.
        // ExportToAttentionChainTest proves ingest really mints this; this pins the rule.
        UUID productId = seedProduct("2938471056", "2938471056");
        Review r = review(channelId, "2026-05-05T03:00:00Z", 1, BODY_LOW);
        r.setProductId(productId);
        reviews.save(r);

        OperatorVocItemPage page = service.attentionItems(
                org, accountId, "LOW_RATING_REVIEW", FROM, TO, null, 0, 20);

        assertThat(page.total()).isEqualTo(1);                   // the row still surfaces
        OperatorVocItem item = page.items().get(0);
        assertThat(item.productName()).isNull();                 // only its "name" is withheld
        assertThat(item.toString()).doesNotContain("2938471056");
    }

    @Test
    void aNameThatMatchesItsSkuOnlyAfterTrimmingIsAlsoWithheld() {
        UUID channelId = seedChannel("NAVER", "네이버 스마트스토어");
        UUID accountId = seedAccount(channelId);
        // Ingest strips on the way in (HeaderAliases.pick), but a legacy or connector-written
        // row may not have. Padding must not be a way to smuggle the identifier through.
        UUID productId = seedProduct("  2938471056  ", "2938471056");
        Review r = review(channelId, "2026-05-05T03:00:00Z", 1, BODY_LOW);
        r.setProductId(productId);
        reviews.save(r);

        OperatorVocItemPage page = service.attentionItems(
                org, accountId, "LOW_RATING_REVIEW", FROM, TO, null, 0, 20);

        assertThat(page.items().get(0).productName()).isNull();
    }

    @Test
    void aLegacyReviewWithNoProductLinkHasANullNameNotAPlaceholder() {
        UUID channelId = seedChannel("NAVER", "네이버 스마트스토어");
        UUID accountId = seedAccount(channelId);
        // reviews.product_id is nullable and predates the ingest path that always sets it,
        // so a legacy row can carry none. Null, never an invented "-" the UI must decode.
        review(channelId, "2026-05-05T03:00:00Z", 1, BODY_LOW);

        OperatorVocItemPage page = service.attentionItems(
                org, accountId, "LOW_RATING_REVIEW", FROM, TO, null, 0, 20);

        assertThat(page.total()).isEqualTo(1);
        assertThat(page.items().get(0).productName()).isNull();
    }

    @Test
    void anUnresolvableProductIdIsToleratedDefensivelyThoughProductionsFkForbidsIt() {
        UUID channelId = seedChannel("NAVER", "네이버 스마트스토어");
        UUID accountId = seedAccount(channelId);
        // SCOPE, stated honestly: this is a DEFENSIVE pin, not a production guarantee.
        // Production DDL has `product_id uuid references products (id)` (V1__init.sql), so a
        // dangling id cannot be inserted there. It is only constructible here because the test
        // schema comes from the entities (ddl-auto, Flyway disabled) and Review.productId is a
        // bare UUID column with no @ManyToOne — Hibernate therefore emits no FK. All this pins
        // is that a map miss yields null instead of an NPE; the reachable miss (cross-org) is
        // covered separately below and is where the real guarantee lives.
        Review r = review(channelId, "2026-05-05T03:00:00Z", 1, BODY_LOW);
        r.setProductId(UUID.randomUUID());
        reviews.save(r);

        OperatorVocItemPage page = service.attentionItems(
                org, accountId, "LOW_RATING_REVIEW", FROM, TO, null, 0, 20);

        assertThat(page.total()).isEqualTo(1);
        assertThat(page.items().get(0).productName()).isNull();
    }

    @Test
    void aCrossOrgProductLinkNeverLeaksTheOtherTenantsCatalogName() {
        UUID channelId = seedChannel("NAVER", "네이버 스마트스토어");
        UUID accountId = seedAccount(channelId);
        // reviews.product_id is a bare FK to products(id) with NO org constraint, so a row
        // can physically point at another tenant's product. The read is org-scoped precisely
        // so that resolves to nothing instead of leaking their catalog.
        UUID otherOrg = UUID.randomUUID();
        Product theirs = new Product();
        theirs.setOrgId(otherOrg);
        theirs.setName("타사-비공개-상품명");
        theirs.setStatus("ACTIVE");
        products.save(theirs);

        Review r = review(channelId, "2026-05-05T03:00:00Z", 1, BODY_LOW);
        r.setProductId(theirs.getId());
        reviews.save(r);

        OperatorVocItemPage page = service.attentionItems(
                org, accountId, "LOW_RATING_REVIEW", FROM, TO, null, 0, 20);

        assertThat(page.total()).isEqualTo(1);
        OperatorVocItem item = page.items().get(0);
        assertThat(item.productName()).isNull();
        assertThat(item.toString()).doesNotContain("타사-비공개-상품명");

        // Non-vacuity — without this the test would still pass if the fixture were broken or
        // the row never reached the page, and it would keep passing after someone dropped the
        // org filter's teeth. The row IS in the page (asserted above) and the product IS live
        // and reachable by its id (below), so the null name above can only be the org scope
        // doing its job.
        assertThat(products.findById(theirs.getId()))
                .isPresent()
                .get().extracting(Product::getName).isEqualTo("타사-비공개-상품명");
    }

    @Test
    void aProductWithNoSkuStillSurfacesItsName() {
        UUID channelId = seedChannel("NAVER", "네이버 스마트스토어");
        UUID accountId = seedAccount(channelId);
        // An export row with 상품명 but no 상품번호 resolves a product by name alone (sku null).
        // The name is the display value, so it surfaces regardless of whether identity exists.
        UUID productId = seedProduct("합성-상품명-노트", null);
        Review r = review(channelId, "2026-05-05T03:00:00Z", 1, BODY_LOW);
        r.setProductId(productId);
        reviews.save(r);

        OperatorVocItemPage page = service.attentionItems(
                org, accountId, "LOW_RATING_REVIEW", FROM, TO, null, 0, 20);

        assertThat(page.items().get(0).productName()).isEqualTo("합성-상품명-노트");
    }

    @Test
    void aProductServiceMintedPlaceholderIsFilteredOut() {
        UUID channelId = seedChannel("NAVER", "네이버 스마트스토어");
        UUID accountId = seedAccount(channelId);
        // Drives ProductService's OWN placeholder fallback (ProductService:53) — a DEFENSIVE
        // branch that NO production mapper currently reaches. It needs (name null, sku null),
        // and every mapper mints the placeholder itself first: ReviewRowMapper/InquiryRowMapper
        // pass it as a non-null name, while Cafe24InquiryArticleMapper/EsmInquiryParser/
        // EsmInquiryRowMapper pass a null name only when a sku EXISTS — which routes to the sku
        // branch instead. resolveOrCreate is public API, so the branch is reachable in
        // principle; this pins that the filter catches its literal too, nothing more.
        //
        // It is therefore NOT evidence for the export path. There the stored literal is
        // ReviewRowMapper's, and ExportToAttentionChainTest is what pins it. Kept separate
        // because the two literals can drift independently.
        Product minted = new ProductService(products).resolveOrCreate(org, null, null);
        assertThat(minted.getName()).isEqualTo(IngestedReviewVocItemSource.UNSPECIFIED_PRODUCT_NAME);

        Review r = review(channelId, "2026-05-05T03:00:00Z", 1, BODY_LOW);
        r.setProductId(minted.getId());
        reviews.save(r);

        OperatorVocItemPage page = service.attentionItems(
                org, accountId, "LOW_RATING_REVIEW", FROM, TO, null, 0, 20);

        // The row still surfaces — only its "name" is withheld, because the placeholder is an
        // ingest artifact (every nameless row in the org shares this ONE product), not a product.
        assertThat(page.total()).isEqualTo(1);
        OperatorVocItem item = page.items().get(0);
        assertThat(item.productName()).isNull();
        assertThat(item.safePreview()).isEqualTo(BODY_LOW);
        assertThat(item.toString()).doesNotContain("미지정");
    }

    @Test
    void twoNamelessRowsShareOneProductAndNeitherShowsIt() {
        UUID channelId = seedChannel("NAVER", "네이버 스마트스토어");
        UUID accountId = seedAccount(channelId);
        // The reason the placeholder must not surface: ProductService resolves it BY NAME, so
        // unrelated reviews collapse onto a single row. Showing it would present a bucket as
        // if it were one product.
        ProductService ingestProducts = new ProductService(products);
        Product first = ingestProducts.resolveOrCreate(org, null, null);
        Product second = ingestProducts.resolveOrCreate(org, null, null);
        assertThat(second.getId()).isEqualTo(first.getId());   // one shared bucket, not two products

        for (int i = 0; i < 2; i++) {
            Review r = review(channelId, "2026-05-05T03:00:00Z", 1, BODY_LOW + "-" + i);
            r.setProductId(first.getId());
            reviews.save(r);
        }

        OperatorVocItemPage page = service.attentionItems(
                org, accountId, "LOW_RATING_REVIEW", FROM, TO, null, 0, 20);

        assertThat(page.total()).isEqualTo(2);
        assertThat(page.items()).extracting(OperatorVocItem::productName).containsOnlyNulls();
    }

    @Test
    void aRealProductNamedLikeThePlaceholderIsStillWithheld() {
        UUID channelId = seedChannel("NAVER", "네이버 스마트스토어");
        UUID accountId = seedAccount(channelId);
        // A genuine catalog product that happens to carry the placeholder as its name is
        // indistinguishable from the artifact on read — the filter is by name, which is all
        // this store has. Withholding is the safe direction: a missing name is honest, a
        // meaningless one is not. Pinned so the ambiguity is a known choice, not a surprise.
        UUID productId = seedProduct(IngestedReviewVocItemSource.UNSPECIFIED_PRODUCT_NAME, "SKU-1003");
        Review r = review(channelId, "2026-05-05T03:00:00Z", 1, BODY_LOW);
        r.setProductId(productId);
        reviews.save(r);

        OperatorVocItemPage page = service.attentionItems(
                org, accountId, "LOW_RATING_REVIEW", FROM, TO, null, 0, 20);

        assertThat(page.items().get(0).productName()).isNull();
    }

    @Test
    void aBlankProductNameResolvesToNullNotAnEmptyString() {
        UUID channelId = seedChannel("NAVER", "네이버 스마트스토어");
        UUID accountId = seedAccount(channelId);
        UUID productId = seedProduct("   ", "SKU-1002");
        Review r = review(channelId, "2026-05-05T03:00:00Z", 1, BODY_LOW);
        r.setProductId(productId);
        reviews.save(r);

        OperatorVocItemPage page = service.attentionItems(
                org, accountId, "LOW_RATING_REVIEW", FROM, TO, null, 0, 20);

        assertThat(page.items().get(0).productName()).isNull();
    }

    @Test
    void aPageSpanningManyProductsResolvesEveryNameThroughOneBatchNotPerRow() {
        UUID channelId = seedChannel("NAVER", "네이버 스마트스토어");
        UUID accountId = seedAccount(channelId);
        // A full page where every row has a DISTINCT product — the worst case for a per-row
        // lookup. Two rows deliberately share one product, so the batch must dedupe ids and
        // still name both. Asserting the RESULT (every row named correctly at page scale)
        // rather than a query count: the repo has no query-counting harness, and inventing
        // one here would be new test infrastructure with no precedent.
        int rows = 30;
        for (int i = 0; i < rows; i++) {
            UUID productId = seedProduct("합성-상품명-" + i, "SKU-B" + i);
            Review r = review(channelId, "2026-05-05T03:00:00Z", 1, BODY_LOW + "-" + i);
            r.setProductId(productId);
            reviews.save(r);
        }
        UUID shared = seedProduct("합성-상품명-공유", "SKU-SHARED");
        for (int i = 0; i < 2; i++) {
            Review r = review(channelId, "2026-05-05T03:00:00Z", 1, BODY_LOW + "-공유-" + i);
            r.setProductId(shared);
            reviews.save(r);
        }

        OperatorVocItemPage page = service.attentionItems(
                org, accountId, "LOW_RATING_REVIEW", FROM, TO, null, 0, 50);

        assertThat(page.total()).isEqualTo(rows + 2);
        assertThat(page.items()).hasSize(rows + 2);
        assertThat(page.items()).extracting(OperatorVocItem::productName).doesNotContainNull();
        assertThat(page.items()).extracting(OperatorVocItem::productName)
                .filteredOn("합성-상품명-공유"::equals).hasSize(2);
    }

    @Test
    void previewIsSanitizedAtReadTimeAndNeverEchoesRawContact() {
        UUID channelId = seedChannel("NAVER", "네이버 스마트스토어");
        UUID accountId = seedAccount(channelId);
        // Synthetic PII shaped like a phone number — the shared sanitizer must mask it.
        review(channelId, "2026-05-05T03:00:00Z", 1, "연락처 010-1234-5678 로 연락주세요");

        OperatorVocItemPage page = service.attentionItems(
                org, accountId, "LOW_RATING_REVIEW", FROM, TO, null, 0, 20);

        assertThat(page.items()).singleElement()
                .satisfies(i -> assertThat(i.safePreview()).doesNotContain("010-1234-5678"));
    }

    // --- multi-account ambiguity guard ------------------------------------------

    @Test
    void twoAccountsOnOneChannelYieldAnUnsupportedAmbiguousStateNotAConfirmedZero() {
        UUID channelId = seedChannel("NAVER", "네이버 스마트스토어");
        UUID accountA = seedAccount(channelId);
        UUID accountB = seedAccount(channelId);   // a second NAVER store in the same org
        review(channelId, "2026-05-05T03:00:00Z", 1, BODY_LOW);
        review(channelId, "2026-05-06T03:00:00Z", 2, BODY_LOW);

        // reviews are org+channel scoped, so neither account can claim these rows, and
        // showing them under both would misattribute. The read therefore declines.
        //
        // Note what this asserts and what it does NOT: the response is empty, but that
        // empty is an UNSUPPORTED AMBIGUOUS STATE, not a confirmed zero — two negative
        // reviews demonstrably exist. The DTO carries no status field to say so, which is
        // exactly why the source logs a WARN here; an operator reading only the dashboard
        // cannot tell this apart from a quiet account. Resolving that properly needs
        // account-scoped ingest (product decision), not a change to this assertion.
        for (UUID accountId : List.of(accountA, accountB)) {
            OperatorAttentionSummary s = service.attention(org, accountId, FROM, TO);
            assertThat(s.items()).isEmpty();
            assertThat(s.channel()).isEqualTo("네이버 스마트스토어");   // channel identity still resolves

            OperatorVocItemPage page = service.attentionItems(
                    org, accountId, "LOW_RATING_REVIEW", FROM, TO, null, 0, 20);
            assertThat(page.total()).isZero();
            assertThat(page.items()).isEmpty();
        }
    }

    @Test
    void aSecondAccountOnADifferentChannelDoesNotTriggerTheGuard() {
        UUID naver = seedChannel("NAVER", "네이버 스마트스토어");
        UUID gmarket = seedChannel("GMARKET", "G마켓/옥션");
        UUID naverAccount = seedAccount(naver);
        seedAccount(gmarket);   // same org, different channel — still unambiguous
        review(naver, "2026-05-05T03:00:00Z", 1, BODY_LOW);

        OperatorAttentionSummary s = service.attention(org, naverAccount, FROM, TO);
        assertThat(s.items()).extracting(AttentionSignal::type, AttentionSignal::count)
                .contains(tuple("LOW_RATING_REVIEW", 1L));
    }

    @Test
    void anotherOrgsAccountOnTheSameChannelDoesNotTriggerTheGuard() {
        UUID channelId = seedChannel("NAVER", "네이버 스마트스토어");
        UUID accountId = seedAccount(channelId);
        // A different tenant's account on the same channel must not make OUR org ambiguous.
        SellerAccount foreign = new SellerAccount();
        foreign.setOrgId(UUID.randomUUID());
        foreign.setChannelId(channelId);
        foreign.setConnectionStatus(ChannelStatus.CONNECTED);
        foreign.setFileUpload(true);
        sellerAccounts.save(foreign);
        review(channelId, "2026-05-05T03:00:00Z", 1, BODY_LOW);

        OperatorAttentionSummary s = service.attention(org, accountId, FROM, TO);
        assertThat(s.items()).extracting(AttentionSignal::type, AttentionSignal::count)
                .contains(tuple("LOW_RATING_REVIEW", 1L));
    }

    // --- inquiry lenses are not this store's to serve ---------------------------

    @Test
    void anInquiryDrillDownOverAReviewOnlyStoreIsEmptyNotMisfiled() {
        UUID channelId = seedChannel("NAVER", "네이버 스마트스토어");
        UUID accountId = seedAccount(channelId);
        review(channelId, "2026-05-05T03:00:00Z", 1, BODY_LOW);

        // The snapshot's inquiry counts are hard zeros, so this signal can never have been
        // raised here; drilling it must not list reviews under an inquiry lens.
        OperatorVocItemPage page = service.attentionItems(
                org, accountId, AttentionSignalType.UNANSWERED_INQUIRY.name(), FROM, TO, null, 0, 20);
        assertThat(page.total()).isZero();
        assertThat(page.items()).isEmpty();
    }

    // --- fixtures ---------------------------------------------------------------

    private UUID seedChannel(String code, String nameKo) {
        Channel ch = new Channel();
        ch.setCode(code);
        ch.setNameKo(nameKo);
        ch.setStatus(ChannelStatus.AVAILABLE);
        ch.setSupportsInquiry(true);
        ch.setSupportsReview(true);
        ch.setSupportsOrder(true);
        ch.setSupportsSales(true);
        ch.setSupportsProduct(true);
        ch.setSortOrder(0);
        return channels.save(ch).getId();
    }

    private UUID seedAccount(UUID channelId) {
        SellerAccount acc = new SellerAccount();
        acc.setOrgId(org);
        acc.setChannelId(channelId);
        acc.setConnectionStatus(ChannelStatus.CONNECTED);
        acc.setFileUpload(true);   // this store's reviews arrive by seller-center export
        return sellerAccounts.save(acc).getId();
    }

    /** A synthetic ingested review; {@code receivedAt} is an explicit instant, never a clock read. */
    private Review review(UUID channelId, String receivedAt, Integer rating, String body) {
        Review r = new Review();
        r.setOrgId(org);
        r.setChannelId(channelId);
        r.setRating(rating);
        r.setBody(body);
        r.setNegative(rating != null && rating <= 2);
        r.setReceivedAt(Instant.parse(receivedAt));
        return reviews.save(r);
    }

    /** A synthetic in-org product; every name/sku here is fabricated, never catalog data. */
    private UUID seedProduct(String name, String sku) {
        Product p = new Product();
        p.setOrgId(org);
        p.setName(name);
        p.setSku(sku);
        p.setStatus("ACTIVE");
        return products.save(p).getId();
    }
}
