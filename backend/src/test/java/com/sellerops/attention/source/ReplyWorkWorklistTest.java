package com.sellerops.attention.source;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.attention.AttentionCoverage;
import com.sellerops.attention.OperatorAttentionService;
import com.sellerops.attention.dto.OperatorReplyWorkView;
import com.sellerops.attention.dto.OperatorVocItem;
import com.sellerops.attention.reply.OperatorOutcome;
import com.sellerops.attention.reply.ReviewReplyApproval;
import com.sellerops.attention.reply.ReviewReplyApprovalRepository;
import com.sellerops.attention.reply.ReviewReplyApprovalState;
import com.sellerops.attention.reply.ReviewReplyDraft;
import com.sellerops.attention.reply.ReviewReplyDraftRepository;
import com.sellerops.attention.reply.ReviewReplyOutcome;
import com.sellerops.attention.reply.ReviewReplyOutcomeRepository;
import com.sellerops.attention.reply.VerificationState;
import com.sellerops.attention.triage.ReviewTriage;
import com.sellerops.attention.triage.ReviewTriageRepository;
import com.sellerops.attention.triage.TriageDisposition;
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
 * 내 답변 작업 — the operator's OWN committed reply work, with a home that survives a reload.
 *
 * <p>Before this, a 대응 필요 decision and a saved draft were reachable only by re-entering the exact
 * arrival-signal drill-down that raised the row — window-, signal- and page-scoped, reset by any
 * window or account change. An interrupted draft was effectively lost. These tests pin the
 * membership rule, the ordering, the reported-item exclusion, and the honest presentation of the
 * bounded recently-reported section.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class ReplyWorkWorklistTest {

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

    private OperatorAttentionService service;
    private final UUID org = UUID.randomUUID();
    private final UUID otherOrg = UUID.randomUUID();
    private UUID channelId;
    private UUID accountId;

    private static final Instant WHEN = Instant.parse("2026-05-10T00:00:00Z");

    @BeforeEach
    void setUp() {
        service = new OperatorAttentionService(sellerAccounts, channels,
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

    private Review review(int rating, Instant receivedAt) {
        Review r = new Review();
        r.setOrgId(org);
        r.setChannelId(channelId);
        r.setRating(rating);
        r.setBody("합성 리뷰 " + rating + " " + receivedAt);
        r.setNegative(rating <= 2);
        r.setReceivedAt(receivedAt);
        r.setReplyState(ReviewReplyState.PENDING);
        return reviews.save(r);
    }

    private void triage(UUID reviewId, TriageDisposition disposition, UUID ownerOrg) {
        ReviewTriage t = new ReviewTriage();
        t.setOrgId(ownerOrg);
        t.setReviewId(reviewId);
        t.setChannelId(channelId);
        t.setDisposition(disposition);
        t.setDecidedBy("operator@example.com");
        t.setDecidedAt(WHEN);
        triage.save(t);
    }

    private void draft(UUID reviewId, UUID ownerOrg) {
        ReviewReplyDraft d = new ReviewReplyDraft();
        d.setId(UUID.randomUUID());
        d.setOrgId(ownerOrg);
        d.setReviewId(reviewId);
        d.setVersion(1);
        d.setBody("합성 초안");
        d.setContentFingerprint("fp-draft-1");
        d.setFingerprintAlgorithm("review-reply-v1");
        d.setCreatedBy("operator@example.com");
        d.setCreatedAt(WHEN);
        replyDrafts.save(d);
    }

    private void approve(UUID reviewId, int version) {
        ReviewReplyApproval a = new ReviewReplyApproval();
        a.setOrgId(org);
        a.setReviewId(reviewId);
        a.setState(ReviewReplyApprovalState.APPROVED);
        a.setApprovedVersion(version);
        a.setApprovedFingerprint("fp-" + version);
        a.setDecidedBy("operator@example.com");
        a.setDecidedAt(WHEN);
        replyApprovals.save(a);
    }

    /** Report a posted reply against the standing approved version — what makes a row "done". */
    private void report(UUID reviewId, int version, Instant reportedAt) {
        approve(reviewId, version);
        ReviewReplyOutcome o = new ReviewReplyOutcome();
        o.setOrgId(org);
        o.setReviewId(reviewId);
        o.setSubmissionRef("ref" + UUID.randomUUID().toString().substring(0, 8));
        o.setRecordedVersion(version);
        o.setRecordedFingerprint("fp-" + version);
        o.setFingerprintAlgorithm("review-reply-v1");
        o.setOperatorOutcome(OperatorOutcome.OPERATOR_REPORTED_SUBMITTED);
        // Permanently UNVERIFIED — no read-back oracle for a public reply.
        o.setVerification(VerificationState.UNVERIFIED);
        o.setCommandId(UUID.randomUUID().toString());
        o.setRecordedBy("SELLER:op");
        o.setCreatedAt(reportedAt);
        replyOutcomes.save(o);
    }

    private OperatorReplyWorkView work() {
        return service.replyWork(org, accountId, 50, 5);
    }

    private static List<String> refs(List<OperatorVocItem> rows) {
        return rows.stream().map(OperatorVocItem::actionRef).toList();
    }

    @Test
    void membership_isResponseNeededOrAStandingDraft_andNothingElse() {
        Review needed = review(3, WHEN);
        triage(needed.getId(), TriageDisposition.RESPONSE_NEEDED, org);
        Review drafted = review(4, WHEN);            // no triage, but work exists
        draft(drafted.getId(), org);
        Review monitored = review(2, WHEN);          // a decision, but NOT a commitment to reply
        triage(monitored.getId(), TriageDisposition.MONITOR, org);
        Review untouched = review(1, WHEN);          // a 1★ review nobody committed to yet

        List<String> todo = refs(work().todo());

        assertThat(todo).hasSize(2);
        assertThat(todo).contains("review:" + needed.getId(), "review:" + drafted.getId());
        // MONITOR is a decision, not a commitment; an untouched review belongs to the arrival queue.
        assertThat(todo).doesNotContain("review:" + monitored.getId(), "review:" + untouched.getId());
    }

    @Test
    void ordering_isWorstFirst_thenNewest() {
        Review low = review(1, WHEN);
        Review mid = review(3, WHEN);
        Review olderLow = review(1, WHEN.minusSeconds(86_400));
        for (Review r : List.of(low, mid, olderLow)) {
            triage(r.getId(), TriageDisposition.RESPONSE_NEEDED, org);
        }

        assertThat(refs(work().todo())).containsExactly(
                "review:" + low.getId(),        // 1★, newest
                "review:" + olderLow.getId(),   // 1★, older
                "review:" + mid.getId());       // 3★
    }

    @Test
    void aReportedReplyLeavesTheToDoAndAppearsUnderRecentlyReported() {
        Review done = review(1, WHEN);
        triage(done.getId(), TriageDisposition.RESPONSE_NEEDED, org);
        draft(done.getId(), org);
        report(done.getId(), 1, WHEN);
        Review stillMine = review(2, WHEN);
        triage(stillMine.getId(), TriageDisposition.RESPONSE_NEEDED, org);

        OperatorReplyWorkView v = work();

        // Excluded from the to-do (not merely sunk): finished work must not crowd out what remains.
        assertThat(refs(v.todo())).containsExactly("review:" + stillMine.getId());
        // …and it is still visible, in its own honest section.
        assertThat(refs(v.recentlyReported())).containsExactly("review:" + done.getId());
    }

    @Test
    void recentlyReported_isMostRecentlyReportedFirst_andBounded() {
        for (int i = 0; i < 7; i++) {
            Review r = review(3, WHEN);
            // Report time ascending, so the LAST one reported must come first.
            report(r.getId(), 1, WHEN.plusSeconds(i * 60L));
        }

        OperatorReplyWorkView v = service.replyWork(org, accountId, 50, 5);

        assertThat(v.recentlyReported()).hasSize(5);       // bounded by the caller's limit
        assertThat(v.todo()).isEmpty();                    // all reported → nothing left to do
    }

    @Test
    void everyRecentlyReportedRowIsUnverified_neverACompletionClaim() {
        Review done = review(1, WHEN);
        report(done.getId(), 1, WHEN);

        OperatorVocItem row = work().recentlyReported().get(0);

        // The channel never confirmed anything: reply_state is what the last import said, and the
        // operator's report is UNVERIFIED by construction. Nothing here may read as 완료.
        assertThat(row.replyStatus()).isEqualTo(ReviewReplyState.PENDING.name());
        assertThat(row.hasReportedSubmission()).isTrue();
    }

    @Test
    void scopingIsOrgAndAccount_anotherOrgsCommitmentIsInvisible() {
        Review mine = review(1, WHEN);
        triage(mine.getId(), TriageDisposition.RESPONSE_NEEDED, org);
        Review theirs = review(1, WHEN);
        // Same review row, but the commitment belongs to a DIFFERENT org — it must not leak in.
        triage(theirs.getId(), TriageDisposition.RESPONSE_NEEDED, otherOrg);
        draft(theirs.getId(), otherOrg);

        assertThat(refs(work().todo())).containsExactly("review:" + mine.getId());
    }

    @Test
    void anAmbiguousMultiAccountScopeListsNothingAndSaysWhy() {
        Review r = review(1, WHEN);
        triage(r.getId(), TriageDisposition.RESPONSE_NEEDED, org);
        SellerAccount second = new SellerAccount();   // a SECOND account on the same channel
        second.setOrgId(org);
        second.setChannelId(channelId);
        second.setConnectionStatus(ChannelStatus.CONNECTED);
        second.setFileUpload(true);
        sellerAccounts.save(second);

        OperatorReplyWorkView v = work();

        // Reply work read from a scope we cannot attribute would be work shown under the wrong
        // account — so it lists nothing, and the coverage verdict says why (never "no work").
        assertThat(v.coverage()).isEqualTo(AttentionCoverage.UNCERTAIN_MULTI_ACCOUNT);
        assertThat(v.todo()).isEmpty();
        assertThat(v.recentlyReported()).isEmpty();
    }
}
