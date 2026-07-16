package com.sellerops.attention.source;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

import com.sellerops.attention.AttentionSignalType;
import com.sellerops.attention.OperatorAttentionService;
import com.sellerops.attention.dto.AttentionSignal;
import com.sellerops.attention.dto.OperatorAttentionSummary;
import com.sellerops.attention.dto.OperatorVocItem;
import com.sellerops.attention.dto.OperatorVocItemPage;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import com.sellerops.review.Review;
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
                new IngestedReviewVocItemSource(reviews, sellerAccounts)));
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
                new IngestedReviewVocItemSource(reviews, sellerAccounts),
                new Cafe24VocItemSource(articles)));

        assertThat(reversed.forChannel("CAFE24")).containsInstanceOf(Cafe24VocItemSource.class);
        assertThat(reversed.forChannel("NAVER")).containsInstanceOf(IngestedReviewVocItemSource.class);
    }

    @Test
    void supportsIsExactAndNullSafe() {
        IngestedReviewVocItemSource source = new IngestedReviewVocItemSource(reviews, sellerAccounts);
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
                org, accountId, "LOW_RATING_REVIEW", FROM, TO, 0, 20);
        assertThat(page.total()).isZero();
        assertThat(page.items()).isEmpty();
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
                org, accountId, "LOW_RATING_REVIEW", FROM, TO, 0, 20);

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
                org, accountId, "LOW_RATING_REVIEW", FROM, TO, 0, 20);
        assertThat(page.total()).isEqualTo(1);
        assertThat(page.items()).extracting(OperatorVocItem::safePreview)
                .doesNotContain("합성-타사-리뷰-본문");
    }

    // --- evidence exposed by the DTO (product linkage is NOT part of it) --------

    @Test
    void drillDownExposesSanitizedReviewEvidenceOnly() {
        UUID channelId = seedChannel("NAVER", "네이버 스마트스토어");
        UUID accountId = seedAccount(channelId);
        UUID productId = UUID.randomUUID();
        Review r = review(channelId, "2026-05-05T03:00:00Z", 1, BODY_LOW);
        r.setProductId(productId);
        reviews.save(r);

        OperatorVocItemPage page = service.attentionItems(
                org, accountId, "LOW_RATING_REVIEW", FROM, TO, 0, 20);

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
        // An export carries no reply state — the field is honestly empty, not guessed.
        assertThat(item.replyStatus()).isNull();

        // Product linkage is a BACKEND INVARIANT ONLY — it is deliberately not evidence
        // the operator sees. OperatorVocItem has no product field, and adding one would
        // be a DTO/API contract change. This asserts only that ingest's review→product
        // link survives underneath a drill-down read; it makes no claim that this surface
        // exposes the product, and no assertion above reads one.
        assertThat(reviews.findAllByOrgId(org)).singleElement()
                .satisfies(saved -> assertThat(saved.getProductId()).isEqualTo(productId));
    }

    @Test
    void previewIsSanitizedAtReadTimeAndNeverEchoesRawContact() {
        UUID channelId = seedChannel("NAVER", "네이버 스마트스토어");
        UUID accountId = seedAccount(channelId);
        // Synthetic PII shaped like a phone number — the shared sanitizer must mask it.
        review(channelId, "2026-05-05T03:00:00Z", 1, "연락처 010-1234-5678 로 연락주세요");

        OperatorVocItemPage page = service.attentionItems(
                org, accountId, "LOW_RATING_REVIEW", FROM, TO, 0, 20);

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
                    org, accountId, "LOW_RATING_REVIEW", FROM, TO, 0, 20);
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
                org, accountId, AttentionSignalType.UNANSWERED_INQUIRY.name(), FROM, TO, 0, 20);
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
}
