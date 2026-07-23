package com.sellerops.attention.triage;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

import com.sellerops.attention.AttentionSignalType;
import com.sellerops.attention.OperatorAttentionService;
import com.sellerops.attention.VocItemRef;
import com.sellerops.attention.dto.AttentionSignal;
import com.sellerops.attention.dto.OperatorAttentionSummary;
import com.sellerops.attention.dto.OperatorVocItem;
import com.sellerops.attention.dto.OperatorVocItemPage;
import com.sellerops.attention.source.Cafe24VocItemSource;
import com.sellerops.attention.reply.ReviewReplyApprovalRepository;
import com.sellerops.attention.reply.ReviewReplyDraftRepository;
import com.sellerops.attention.source.IngestedReviewVocItemSource;
import com.sellerops.attention.source.VocItemSourceRegistry;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.community.Cafe24CommunityArticle;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import com.sellerops.community.CommunityReplyStatus;
import com.sellerops.product.ProductRepository;
import com.sellerops.review.Review;
import com.sellerops.itemanalysis.ItemAnalysisRepository;
import com.sellerops.review.ReviewRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * The round trip: decide on a row, then drill down again and see the decision — driven
 * through the real {@link OperatorAttentionService} and {@link ReviewTriageService} over a
 * real (H2) DB, so the ref the read side mints is the ref the write side resolves. That
 * join is the whole feature, and it is exactly what a mock on either side would assume
 * rather than prove.
 *
 * <p>Both sources are registered in every test, because the interesting failures are about
 * which source answers and what each one may claim: the ingested-review store is the triage
 * anchor and mints refs, the Cafe24 store has no anchor and must keep saying so.
 *
 * <p>{@code NOT_SUPPORTED} and a dedicated database, for the same reasons as
 * {@code ReviewTriageServiceTest}: {@link ReviewTriageWriter} is {@code REQUIRES_NEW}, so it
 * commits regardless of any ambient test transaction, and a committing class must not sit on
 * the shared JVM-wide instance every other {@code @DataJpaTest} rolls back into — this class
 * seeds both NAVER and CAFE24, and {@code channel.code} is globally UNIQUE. Same pattern as
 * {@code InquiryWorkItemDismissalRollbackTest}. {@link #cleanUp} replaces the rollback, and
 * is now a within-class concern.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
@Transactional(propagation = Propagation.NOT_SUPPORTED)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class ReviewTriageAttentionFlowTest {

    @DynamicPropertySource
    static void isolatedDatabase(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () ->
                "jdbc:h2:mem:sellerops_review_triage_flow;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1");
        registry.add("sellerops.seed.enabled", () -> "false");
    }

    @Autowired SellerAccountRepository sellerAccounts;
    @Autowired ChannelRepository channels;
    @Autowired ReviewRepository reviews;
    @Autowired Cafe24CommunityArticleRepository articles;
    @Autowired ProductRepository products;
    @Autowired ReviewTriageRepository triages;
    @Autowired ReviewReplyDraftRepository replyDrafts;
    @Autowired ReviewReplyApprovalRepository replyApprovals;
    @Autowired ItemAnalysisRepository itemAnalyses;
    @Autowired ReviewTriageAuditRepository audits;
    @Autowired PlatformTransactionManager txManager;

    private OperatorAttentionService attention;
    private ReviewTriageService triage;

    private final UUID org = UUID.randomUUID();
    private final UUID user = UUID.randomUUID();
    private long nextArticleNo = 1000L;

    private static final LocalDate FROM = LocalDate.parse("2026-05-01");
    private static final LocalDate TO = LocalDate.parse("2026-05-31");
    /** Synthetic review bodies — never captured content. */
    private static final String BODY = "합성-리뷰-본문-불만";

    @BeforeEach
    void setUp() {
        VocItemSourceRegistry registry = new VocItemSourceRegistry(List.of(
                new Cafe24VocItemSource(articles),
                new IngestedReviewVocItemSource(reviews, sellerAccounts, products, triages,
                        replyDrafts, replyApprovals, itemAnalyses)));
        attention = new OperatorAttentionService(sellerAccounts, channels, registry);
        triage = new ReviewTriageService(triages, audits, reviews, sellerAccounts,
                new ReviewTriageWriter(triages, audits, txManager));
    }

    @AfterEach
    void cleanUp() {
        // Everything here commits (see the class note) — this replaces @DataJpaTest's
        // rollback. channels.code is UNIQUE and this class seeds both NAVER and CAFE24, so
        // residue would fail its own next test. Deliberately does NOT touch `products`: this
        // class only READS it (the source resolves display names), so deleting it would be
        // truncating a table nobody here wrote.
        audits.deleteAll();
        triages.deleteAll();
        reviews.deleteAll();
        articles.deleteAll();
        sellerAccounts.deleteAll();
        channels.deleteAll();
    }

    // --- the round trip ---------------------------------------------------------

    @Test
    void theRefTheDrillDownHandsOutIsTheRefTheDecisionEndpointResolves() {
        UUID channel = seedChannel("NAVER", "네이버 스마트스토어");
        UUID account = seedAccount(channel);
        seedReview(channel, 2);

        // Take the ref exactly as a client would: off the wire, never reconstructed from
        // the row we happen to hold. A test that rebuilt it locally would pass even if the
        // read side minted something the write side cannot parse.
        OperatorVocItem row = drill(account, AttentionSignalType.LOW_RATING_REVIEW).items().get(0);
        assertThat(row.actionRef()).isNotNull();
        assertThat(row.triageDisposition()).isNull(); // nobody has decided yet

        triage.decide(org, account, row.actionRef(), "RESPONSE_NEEDED", "cmd-1", user);

        OperatorVocItem after = drill(account, AttentionSignalType.LOW_RATING_REVIEW).items().get(0);
        assertThat(after.actionRef()).isEqualTo(row.actionRef()); // stable across reads
        assertThat(after.triageDisposition()).isEqualTo("RESPONSE_NEEDED");
    }

    @Test
    void theRefAddressesTheRowItWasMintedForAndCarriesNoChannelSideIdentifier() {
        UUID channel = seedChannel("NAVER", "네이버 스마트스토어");
        UUID account = seedAccount(channel);
        Review r = seedReview(channel, 2);

        OperatorVocItem row = drill(account, AttentionSignalType.LOW_RATING_REVIEW).items().get(0);

        // It resolves back to THIS review — the ref names the row, not the page position.
        assertThat(VocItemRef.parseReviewId(row.actionRef())).isEqualTo(r.getId());
        // And it is built from SellerOps' own row id. The id inside is the one thing that
        // could smuggle a channel-side identifier onto this surface, so it is pinned to the
        // internal UUID rather than merely asserted to "look opaque".
        assertThat(row.actionRef()).isEqualTo("review:" + r.getId());
    }

    @Test
    void aDecisionIsSharedAcrossEverySignalThatSurfacesTheSameReview() {
        UUID channel = seedChannel("NAVER", "네이버 스마트스토어");
        UUID account = seedAccount(channel);
        Review r = seedReview(channel, 2);

        // A 2-star review is in BOTH lenses by construction: LOW_RATING_REVIEW drills 1-3,
        // NEW_REVIEW drills everything. The ranges overlap on purpose.
        OperatorVocItem viaLowRating = drill(account, AttentionSignalType.LOW_RATING_REVIEW).items().get(0);
        OperatorVocItem viaNewReview = drill(account, AttentionSignalType.NEW_REVIEW).items().get(0);
        assertThat(viaLowRating.actionRef()).isEqualTo(viaNewReview.actionRef());

        // Decide from one lens...
        triage.decide(org, account, viaLowRating.actionRef(), "MONITOR", "cmd-1", user);

        // ...and the other lens shows it too. The decision is keyed on the review, not on
        // the signal, so an operator cannot record two contradictory conclusions about one
        // review by entering through different cards — and cannot lose a decision by
        // leaving through a different one.
        assertThat(drill(account, AttentionSignalType.LOW_RATING_REVIEW).items().get(0).triageDisposition())
                .isEqualTo("MONITOR");
        assertThat(drill(account, AttentionSignalType.NEW_REVIEW).items().get(0).triageDisposition())
                .isEqualTo("MONITOR");
        assertThat(triages.findAll()).hasSize(1);
        assertThat(VocItemRef.parseReviewId(viaNewReview.actionRef())).isEqualTo(r.getId());
    }

    @Test
    void oneReviewsDecisionDoesNotBleedOntoItsNeighboursOnTheSamePage() {
        UUID channel = seedChannel("NAVER", "네이버 스마트스토어");
        UUID account = seedAccount(channel);
        seedReview(channel, 1);
        seedReview(channel, 2);
        seedReview(channel, 3);

        List<OperatorVocItem> before = drill(account, AttentionSignalType.LOW_RATING_REVIEW).items();
        assertThat(before).hasSize(3);
        triage.decide(org, account, before.get(1).actionRef(), "NO_ACTION", "cmd-1", user);

        // Exactly one row carries the decision; the batch lookup maps per review id rather
        // than smearing one entry across the page.
        assertThat(drill(account, AttentionSignalType.LOW_RATING_REVIEW).items())
                .extracting(OperatorVocItem::actionRef, OperatorVocItem::triageDisposition)
                .containsExactly(
                        tuple(before.get(0).actionRef(), null),
                        tuple(before.get(1).actionRef(), "NO_ACTION"),
                        tuple(before.get(2).actionRef(), null));
    }

    @Test
    void anotherOrgsDecisionOnTheSameReviewIdIsInvisibleHere() {
        UUID channel = seedChannel("NAVER", "네이버 스마트스토어");
        UUID account = seedAccount(channel);
        Review mine = seedReview(channel, 2);

        // A triage row for MY review id, stamped with someone else's org. The read side
        // filters by org, so it must not surface — the org filter on the batch lookup is
        // authorization, not tidiness.
        ReviewTriage foreign = new ReviewTriage();
        foreign.setOrgId(UUID.randomUUID());
        foreign.setReviewId(mine.getId());
        foreign.setChannelId(channel);
        foreign.setDisposition(TriageDisposition.NO_ACTION);
        foreign.setDecidedBy("SELLER:" + UUID.randomUUID());
        foreign.setDecidedAt(Instant.parse("2026-05-11T03:00:00Z"));
        triages.save(foreign);

        assertThat(drill(account, AttentionSignalType.LOW_RATING_REVIEW).items().get(0).triageDisposition())
                .isNull();
    }

    // --- Cafe24 stays honest ----------------------------------------------------

    @Test
    void aCafe24RowIsReadableButNotDecidableAndSaysSoWithNulls() {
        UUID channel = seedChannel("CAFE24", "카페24");
        UUID account = seedAccount(channel);
        seedArticle(account, channel, 2);

        OperatorVocItem row = drill(account, AttentionSignalType.LOW_RATING_REVIEW).items().get(0);

        // The row is fully readable — this is not a degraded or empty state...
        assertThat(row.channelCode()).isEqualTo("CAFE24");
        assertThat(row.rating()).isEqualTo(2);
        assertThat(row.safePreview()).isNotNull();
        // ...it simply cannot be decided: triage is anchored on `reviews`, and a community
        // article is not a review row. Null ref = no affordance, not a missing row.
        assertThat(row.actionRef()).isNull();
        assertThat(row.triageDisposition()).isNull();
        // Nor can it carry reply work, for the same reason. False here is a capability
        // limit, not a claim that nobody prepared anything — the row simply has no anchor
        // for a draft to attach to.
        assertThat(row.hasReplyPreparation()).isFalse();
    }

    @Test
    void aCafe24ArticleIdIsNotAddressableEvenWhenDressedAsAReviewRef() {
        // The article's id, wrapped in the review prefix. The stores have independent UUID
        // spaces, so this is a well-formed ref for a row that is not in the anchor table —
        // and it must fail as unaddressable rather than resolve to anything.
        UUID channel = seedChannel("CAFE24", "카페24");
        UUID account = seedAccount(channel);
        Cafe24CommunityArticle a = seedArticle(account, channel, 2);

        assertThat(catchDecide(account, VocItemRef.forReview(a.getId()))).isNotNull();
        assertThat(triages.findAll()).isEmpty();
    }

    // --- the read surface is otherwise untouched --------------------------------

    @Test
    void recordingADecisionChangesNoSignalCountOrSeverity() {
        UUID channel = seedChannel("NAVER", "네이버 스마트스토어");
        UUID account = seedAccount(channel);
        seedReview(channel, 1);
        seedReview(channel, 2);
        seedReview(channel, 3);

        OperatorAttentionSummary before = attention.attention(org, account, FROM, TO);
        OperatorVocItem row = drill(account, AttentionSignalType.LOW_RATING_REVIEW).items().get(0);
        triage.decide(org, account, row.actionRef(), "NO_ACTION", "cmd-1", user);
        OperatorAttentionSummary after = attention.attention(org, account, FROM, TO);

        // Triage is a record, not a filter. Deciding NO_ACTION on a review does not make it
        // stop being a low-rating review — the summary counts collected rows, and quietly
        // hiding triaged ones would make the count mean something it does not say. Whether
        // an operator WANTS a triaged-row filter is a product decision, not a side effect
        // this slice should smuggle in.
        assertThat(summarize(after)).isEqualTo(summarize(before));
        assertThat(drill(account, AttentionSignalType.LOW_RATING_REVIEW).total()).isEqualTo(3);
    }

    @Test
    void aDecisionDoesNotDisturbTheRestOfTheRow() {
        UUID channel = seedChannel("NAVER", "네이버 스마트스토어");
        UUID account = seedAccount(channel);
        seedReview(channel, 2);

        OperatorVocItem before = drill(account, AttentionSignalType.LOW_RATING_REVIEW).items().get(0);
        triage.decide(org, account, before.actionRef(), "RESPONSE_NEEDED", "cmd-1", user);
        OperatorVocItem after = drill(account, AttentionSignalType.LOW_RATING_REVIEW).items().get(0);

        // Everything that was on the row still is, unchanged — the two new fields are
        // additive, and the decision writes its own table, never the review.
        assertThat(after.channelCode()).isEqualTo(before.channelCode());
        assertThat(after.channelNameKo()).isEqualTo(before.channelNameKo());
        assertThat(after.sourceType()).isEqualTo(before.sourceType());
        assertThat(after.productName()).isEqualTo(before.productName());
        assertThat(after.rating()).isEqualTo(before.rating());
        assertThat(after.replyStatus()).isEqualTo(before.replyStatus());
        assertThat(after.sourceCreatedDate()).isEqualTo(before.sourceCreatedDate());
        assertThat(after.collectedDate()).isEqualTo(before.collectedDate());
        assertThat(after.signalType()).isEqualTo(before.signalType());
        assertThat(after.safePreview()).isEqualTo(before.safePreview());
    }

    // --- helpers ----------------------------------------------------------------

    private OperatorVocItemPage drill(UUID account, AttentionSignalType type) {
        return attention.attentionItems(org, account, type.name(), FROM, TO, null, 0, 20);
    }

    private static List<Object> summarize(OperatorAttentionSummary s) {
        return s.items().stream()
                .map(i -> (Object) List.of(i.type(), i.severity(), i.count()))
                .toList();
    }

    private Throwable catchDecide(UUID account, String ref) {
        try {
            triage.decide(org, account, ref, "MONITOR", "cmd-" + UUID.randomUUID(), user);
            return null;
        } catch (Throwable t) {
            return t;
        }
    }

    private UUID seedChannel(String code, String nameKo) {
        Channel ch = new Channel();
        ch.setCode(code);
        ch.setNameKo(nameKo);
        ch.setStatus(ChannelStatus.AVAILABLE);
        ch.setSupportsReview(true);
        ch.setSupportsInquiry(true);
        ch.setSortOrder(0);
        return channels.save(ch).getId();
    }

    private UUID seedAccount(UUID channelId) {
        SellerAccount acc = new SellerAccount();
        acc.setOrgId(org);
        acc.setChannelId(channelId);
        acc.setConnectionStatus(ChannelStatus.CONNECTED);
        acc.setFileUpload(true);
        return sellerAccounts.save(acc).getId();
    }

    /** A synthetic ingested review; every instant is explicit, never a clock read. */
    private Review seedReview(UUID channelId, Integer rating) {
        Review r = new Review();
        r.setOrgId(org);
        r.setChannelId(channelId);
        r.setRating(rating);
        r.setBody(BODY);
        r.setNegative(rating != null && rating <= 2);
        // Distinct instants keep the page order total and the assertions stable.
        r.setReceivedAt(Instant.parse("2026-05-10T03:00:00Z").plusSeconds(reviews.count()));
        return reviews.save(r);
    }

    /** A synthetic Cafe24 community article — never captured content. */
    private Cafe24CommunityArticle seedArticle(UUID accountId, UUID channelId, Integer rating) {
        Cafe24CommunityArticle a = new Cafe24CommunityArticle();
        a.setOrgId(org);
        a.setSellerAccountId(accountId);
        a.setChannelId(channelId);
        a.setBoardNo(4);
        a.setArticleNo(nextArticleNo++);
        a.setSourceKind("REVIEW");
        a.setRating(rating);
        a.setContent("합성-카페24-게시글-본문");
        a.setReplyStatus(CommunityReplyStatus.PENDING.name());
        a.setSourceCreatedAt(Instant.parse("2026-05-10T03:00:00Z"));
        a.setSourceHash("h-" + a.getArticleNo());
        a.setCollectedAt(Instant.parse("2026-05-11T03:00:00Z"));
        return articles.save(a);
    }
}
