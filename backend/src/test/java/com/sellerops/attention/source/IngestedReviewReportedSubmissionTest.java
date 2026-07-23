package com.sellerops.attention.source;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

import com.sellerops.attention.AttentionSignalType;
import com.sellerops.attention.OperatorAttentionService;
import com.sellerops.attention.dto.AttentionSignal;
import com.sellerops.attention.dto.OperatorVocItem;
import com.sellerops.attention.dto.OperatorVocItemPage;
import com.sellerops.attention.reply.OperatorOutcome;
import com.sellerops.attention.reply.ReviewReplyApproval;
import com.sellerops.attention.reply.ReviewReplyApprovalRepository;
import com.sellerops.attention.reply.ReviewReplyApprovalState;
import com.sellerops.attention.reply.ReviewReplyDraftRepository;
import com.sellerops.attention.reply.ReviewReplyOutcome;
import com.sellerops.attention.reply.ReviewReplyOutcomeRepository;
import com.sellerops.attention.reply.VerificationState;
import com.sellerops.attention.triage.ReviewTriageRepository;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import com.sellerops.itemanalysis.ItemAnalysisRepository;
import com.sellerops.product.ProductRepository;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewReplyState;
import com.sellerops.review.ReviewRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * The closing step of the loop: when the operator reports posting a reply, the worklist notices.
 *
 * <p>Before this, a seller could work through ten reviews, report every one posted, and watch the
 * headline still read 10건 with the same ten rows on top — SellerOps guided the reply, held a
 * fingerprinted record of it, and ignored it. Only the next export cleared them.
 *
 * <p>Every test here asserts the COUNT, the MARKER and the ORDER together on one seed. They are
 * three readings of one predicate, and a slice whose number, badge and ordering can disagree about
 * what "reported" means is worse than one that never shipped.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class IngestedReviewReportedSubmissionTest {

    @Autowired ReviewRepository reviews;
    @Autowired ChannelRepository channels;
    @Autowired SellerAccountRepository sellerAccounts;
    @Autowired ProductRepository products;
    @Autowired ReviewTriageRepository triage;
    @Autowired ReviewReplyDraftRepository replyDrafts;
    @Autowired ReviewReplyApprovalRepository replyApprovals;
    @Autowired ReviewReplyOutcomeRepository replyOutcomes;
    @Autowired ItemAnalysisRepository itemAnalyses;
    @Autowired Cafe24CommunityArticleRepository communityArticles;

    private OperatorAttentionService attention;
    private final UUID org = UUID.randomUUID();
    private final UUID otherOrg = UUID.randomUUID();
    private UUID channelId;
    private UUID accountId;

    private static final Instant WHEN = Instant.parse("2026-05-10T00:00:00Z");
    private static final java.time.LocalDate FROM = java.time.LocalDate.parse("2026-05-01");
    private static final java.time.LocalDate TO = java.time.LocalDate.parse("2026-05-31");

    @BeforeEach
    void setUp() {
        attention = new OperatorAttentionService(sellerAccounts, channels,
                new VocItemSourceRegistry(List.of(
                        new Cafe24VocItemSource(communityArticles),
                        new IngestedReviewVocItemSource(reviews, sellerAccounts, products, triage,
                                replyDrafts, replyApprovals, replyOutcomes, itemAnalyses))));
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

    private Review seed(int rating, Instant receivedAt) {
        Review r = new Review();
        r.setOrgId(org);
        r.setChannelId(channelId);
        r.setRating(rating);
        r.setBody("합성 본문 " + rating + " " + receivedAt);
        r.setNegative(rating <= 2);
        r.setReceivedAt(receivedAt);
        r.setReplyState(ReviewReplyState.PENDING);
        return reviews.save(r);
    }

    /** Approve version {@code version} of this review's reply. */
    private void approve(UUID reviewId, int version, UUID ownerOrg) {
        ReviewReplyApproval a = new ReviewReplyApproval();
        a.setOrgId(ownerOrg);
        a.setReviewId(reviewId);
        a.setState(ReviewReplyApprovalState.APPROVED);
        a.setApprovedVersion(version);
        a.setApprovedFingerprint("fp-" + version);
        a.setDecidedBy("operator@example.com");
        a.setDecidedAt(WHEN);
        replyApprovals.save(a);
    }

    /** Record an operator outcome against a version. */
    private void report(UUID reviewId, int version, OperatorOutcome outcome, UUID ownerOrg) {
        ReviewReplyOutcome o = new ReviewReplyOutcome();
        o.setOrgId(ownerOrg);
        o.setReviewId(reviewId);
        o.setSubmissionRef("ref" + UUID.randomUUID().toString().substring(0, 8));
        o.setRecordedVersion(version);
        o.setRecordedFingerprint("fp-" + version);
        o.setFingerprintAlgorithm("review-reply-v1");
        o.setOperatorOutcome(outcome);
        // Permanently UNVERIFIED — there is no read-back oracle for a public reply. It is why a
        // reported row may never vanish from the list.
        o.setVerification(VerificationState.UNVERIFIED);
        o.setAwRunRef("run_abc123");
        o.setCommandId(UUID.randomUUID().toString());
        o.setRecordedBy("SELLER:op");
        replyOutcomes.save(o);
    }

    private void reportPosted(UUID reviewId, int version) {
        approve(reviewId, version, org);
        report(reviewId, version, OperatorOutcome.OPERATOR_REPORTED_SUBMITTED, org);
    }

    private List<AttentionSignal> signals() {
        return attention.attention(org, accountId, FROM, TO).items();
    }

    private OperatorVocItemPage worklist() {
        return attention.attentionItems(org, accountId,
                AttentionSignalType.LOW_RATING_REVIEW.name(), FROM, TO, null, 0, 20);
    }

    @Test
    void aReportedReplyLeavesTheCOUNT_butStaysInTheLIST_marked() {
        // The whole slice, in one assertion set. Count, marker and presence together — three
        // readings of one predicate that must not be able to disagree.
        Review handled = seed(1, WHEN);
        seed(2, WHEN);
        reportPosted(handled.getId(), 1);

        assertThat(signals())
                .extracting(AttentionSignal::type, AttentionSignal::severity, AttentionSignal::count)
                .containsExactly(
                        tuple("LOW_RATING_REVIEW", "HIGH", 1L),   // the reported 1★ is not counted…
                        tuple("NEW_REVIEW", "LOW", 2L));          // …but both still arrived

        OperatorVocItemPage page = worklist();
        assertThat(page.total()).isEqualTo(2);                    // …and it is still listed
        assertThat(page.items())
                .extracting(OperatorVocItem::rating, OperatorVocItem::hasReportedSubmission)
                .containsExactly(tuple(2, false), tuple(1, true));
    }

    @Test
    void reportedRowsSINK_belowEveryRowThatStillNeedsDoing() {
        // Without this the worst-first order would hold a finished 1★ at the top of the worklist and
        // a seller working top-down would keep re-reading what they just completed.
        Review reportedWorst = seed(1, WHEN);
        seed(3, WHEN);
        seed(2, WHEN);
        reportPosted(reportedWorst.getId(), 1);

        assertThat(worklist().items())
                .extracting(OperatorVocItem::rating, OperatorVocItem::hasReportedSubmission)
                .containsExactly(tuple(2, false), tuple(3, false), tuple(1, true));
    }

    @Test
    void worstFirstStillHoldsWITHIN_eachGroup() {
        Review reportedA = seed(1, WHEN);
        Review reportedB = seed(3, WHEN);
        seed(3, WHEN);
        seed(1, WHEN);
        reportPosted(reportedA.getId(), 1);
        reportPosted(reportedB.getId(), 1);

        assertThat(worklist().items())
                .extracting(OperatorVocItem::rating, OperatorVocItem::hasReportedSubmission)
                .containsExactly(
                        tuple(1, false), tuple(3, false),   // actionable, worst-first
                        tuple(1, true), tuple(3, true));    // reported, worst-first
    }

    @Test
    void anABORTED_reportChangesNothing() {
        // "I did not post it" is a normal ending, not a completion. The review must stay fully in
        // the worklist — counted, unmarked, and in its rating position.
        Review aborted = seed(1, WHEN);
        approve(aborted.getId(), 1, org);
        report(aborted.getId(), 1, OperatorOutcome.SUBMISSION_ABORTED, org);

        assertThat(signals())
                .extracting(AttentionSignal::type, AttentionSignal::count)
                .contains(tuple("LOW_RATING_REVIEW", 1L));
        assertThat(worklist().items()).singleElement()
                .satisfies(row -> assertThat(row.hasReportedSubmission()).isFalse());
    }

    @Test
    void aReportAgainstAnOLD_versionDoesNotCoverAReApprovedReply() {
        // Version-scoping earns its keep here: the operator posted v1, then edited and re-approved.
        // The text that now stands was never posted, so the review returns to the count on its own.
        Review r = seed(1, WHEN);
        report(r.getId(), 1, OperatorOutcome.OPERATOR_REPORTED_SUBMITTED, org);
        approve(r.getId(), 2, org);   // the approval that STANDS is v2

        assertThat(signals())
                .extracting(AttentionSignal::type, AttentionSignal::count)
                .contains(tuple("LOW_RATING_REVIEW", 1L));
        assertThat(worklist().items()).singleElement()
                .satisfies(row -> assertThat(row.hasReportedSubmission()).isFalse());
    }

    @Test
    void aLaterABORT_doesNotUnPostAnEarlierReportedPost() {
        // Deliberate divergence from the panel's "latest outcome" reading: the panel describes where
        // the current ATTEMPT stands; the queue asks whether a post was ever reported for the reply
        // that stands. Starting a second run and abandoning it does not un-post the first.
        Review r = seed(1, WHEN);
        reportPosted(r.getId(), 1);
        report(r.getId(), 1, OperatorOutcome.SUBMISSION_ABORTED, org);

        assertThat(signals()).extracting(AttentionSignal::type).doesNotContain("LOW_RATING_REVIEW");
        assertThat(worklist().items()).singleElement()
                .satisfies(row -> assertThat(row.hasReportedSubmission()).isTrue());
    }

    @Test
    void anotherOrgsReportNeverCoversThisOrgsReview() {
        // review_reply_outcomes.review_id is a bare reference with no org constraint, so a same-id
        // row in another org is a real possibility rather than a hypothetical.
        Review r = seed(1, WHEN);
        approve(r.getId(), 1, otherOrg);
        report(r.getId(), 1, OperatorOutcome.OPERATOR_REPORTED_SUBMITTED, otherOrg);

        assertThat(signals())
                .extracting(AttentionSignal::type, AttentionSignal::count)
                .contains(tuple("LOW_RATING_REVIEW", 1L));
        assertThat(worklist().items()).singleElement()
                .satisfies(row -> assertThat(row.hasReportedSubmission()).isFalse());
    }

    @Test
    void anUNAPPROVED_reportCoversNothing() {
        // An outcome with no standing approval describes a reply that is not the one on the record.
        Review r = seed(1, WHEN);
        report(r.getId(), 1, OperatorOutcome.OPERATOR_REPORTED_SUBMITTED, org);

        assertThat(signals())
                .extracting(AttentionSignal::type, AttentionSignal::count)
                .contains(tuple("LOW_RATING_REVIEW", 1L));
        assertThat(worklist().items()).singleElement()
                .satisfies(row -> assertThat(row.hasReportedSubmission()).isFalse());
    }

    @Test
    void arrivalsStayWholeAndChronological() {
        // A reported reply is not an un-arrival, and the arrivals lens is a record, not a worklist.
        Review reported = seed(1, WHEN);
        seed(5, WHEN.plusSeconds(60));
        reportPosted(reported.getId(), 1);

        OperatorVocItemPage arrivals = attention.attentionItems(org, accountId,
                AttentionSignalType.NEW_REVIEW.name(), FROM, TO, null, 0, 20);

        assertThat(arrivals.total()).isEqualTo(2);
        assertThat(arrivals.items()).extracting(OperatorVocItem::rating).containsExactly(5, 1);
    }

    @Test
    void theFacetCountsStillReconcileToTheListTotal() {
        // The classification slice's invariant describes the LIST, and reported rows stay listed —
        // so it must hold unchanged, including the reported ones.
        Review reported = seed(1, WHEN);
        seed(2, WHEN);
        reportPosted(reported.getId(), 1);

        OperatorVocItemPage page = worklist();

        long reconciled = page.categoryCounts().stream().mapToLong(c -> c.count()).sum()
                + page.unclassifiedCount();
        assertThat(reconciled).isEqualTo(page.unfilteredTotal());
        assertThat(page.unfilteredTotal()).isEqualTo(2);
    }
}
