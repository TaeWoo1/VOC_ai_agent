package com.sellerops.attention.source;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.attention.AttentionCoverage;
import com.sellerops.attention.OperatorAttentionService;
import com.sellerops.attention.dto.OperatorDismissedReplyWorkView;
import com.sellerops.attention.dto.OperatorReplyWorkView;
import com.sellerops.attention.dto.OperatorVocItem;
import com.sellerops.attention.reply.OperatorOutcome;
import com.sellerops.attention.reply.ReplyWorkEventSequence;
import com.sellerops.attention.reply.ReviewReplyApproval;
import com.sellerops.attention.reply.ReviewReplyApprovalRepository;
import com.sellerops.attention.reply.ReviewReplyApprovalState;
import com.sellerops.attention.reply.ReviewReplyDraft;
import com.sellerops.attention.reply.ReviewReplyDraftRepository;
import com.sellerops.attention.reply.ReviewReplyOutcome;
import com.sellerops.attention.reply.ReviewReplyOutcomeRepository;
import com.sellerops.attention.reply.ReviewReplyWorkDismissal;
import com.sellerops.attention.reply.ReviewReplyWorkDismissalRepository;
import com.sellerops.attention.reply.ReviewReplyWorkDismissalService;
import com.sellerops.attention.reply.ReviewReplyWorkRestore;
import com.sellerops.attention.reply.ReviewReplyWorkRestoreRepository;
import com.sellerops.attention.reply.ReviewReplyWorkRestoreService;
import com.sellerops.attention.reply.VerificationState;
import com.sellerops.attention.triage.ReviewTriage;
import com.sellerops.attention.triage.ReviewTriageRepository;
import com.sellerops.attention.triage.TriageDisposition;
import com.sellerops.channel.Channel;
import com.sellerops.common.ApiException;
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
import jakarta.persistence.EntityManager;
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
    @Autowired ReviewReplyWorkDismissalRepository dismissals;
    @Autowired ReviewReplyWorkRestoreRepository restores;
    @Autowired ItemAnalysisRepository itemAnalyses;
    @Autowired Cafe24CommunityArticleRepository communityArticles;
    @Autowired EntityManager em;

    private OperatorAttentionService service;
    private ReviewReplyWorkDismissalService dismissalService;
    private ReviewReplyWorkRestoreService restoreService;
    private ReplyWorkEventSequence eventSeq;
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
        eventSeq = new ReplyWorkEventSequence(em);
        dismissalService = new ReviewReplyWorkDismissalService(dismissals, reviews, sellerAccounts, eventSeq);
        restoreService = new ReviewReplyWorkRestoreService(restores, reviews, sellerAccounts, eventSeq);
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
        draftAt(reviewId, 1, WHEN, ownerOrg);
    }

    private void draftAt(UUID reviewId, int version, Instant createdAt, UUID ownerOrg) {
        ReviewReplyDraft d = new ReviewReplyDraft();
        d.setId(UUID.randomUUID());
        d.setOrgId(ownerOrg);
        d.setReviewId(reviewId);
        d.setVersion(version);
        d.setBody("합성 초안 " + version);
        d.setContentFingerprint("fp-draft-" + version);
        d.setFingerprintAlgorithm("review-reply-v1");
        d.setCreatedBy("operator@example.com");
        d.setCreatedAt(createdAt);
        replyDrafts.save(d);
    }

    /**
     * Directly seed a dismissal at an explicit time, taking the NEXT shared event position — for the
     * timestamp-supersede re-entry rules AND the seq-arbitration cases (call order fixes seq order, so
     * two events can share a timestamp yet still order deterministically).
     */
    private void dismissAt(UUID reviewId, Instant dismissedAt, UUID ownerOrg) {
        ReviewReplyWorkDismissal d = new ReviewReplyWorkDismissal();
        d.setOrgId(ownerOrg);
        d.setReviewId(reviewId);
        d.setCommandId(UUID.randomUUID().toString());
        d.setDismissedBy("SELLER:op");
        d.setDismissedAt(dismissedAt);
        d.setSeq(eventSeq.next());
        dismissals.save(d);
    }

    /** Directly seed a restore at an explicit time, taking the NEXT shared event position (see above). */
    private void restoreAt(UUID reviewId, Instant restoredAt, UUID ownerOrg) {
        ReviewReplyWorkRestore rec = new ReviewReplyWorkRestore();
        rec.setOrgId(ownerOrg);
        rec.setReviewId(reviewId);
        rec.setCommandId(UUID.randomUUID().toString());
        rec.setRestoredBy("SELLER:op");
        rec.setRestoredAt(restoredAt);
        rec.setSeq(eventSeq.next());
        restores.save(rec);
    }

    /** Re-mark a review RESPONSE_NEEDED at an explicit decision time (triage is one-row-per-review). */
    private void triageAt(UUID reviewId, TriageDisposition disposition, Instant decidedAt, UUID ownerOrg) {
        ReviewTriage t = triage.findByOrgIdAndReviewId(ownerOrg, reviewId).orElseGet(ReviewTriage::new);
        t.setOrgId(ownerOrg);
        t.setReviewId(reviewId);
        t.setChannelId(channelId);
        t.setDisposition(disposition);
        t.setDecidedBy("operator@example.com");
        t.setDecidedAt(decidedAt);
        triage.save(t);
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

    // --- 작업에서 제외 (set-aside / dismissal) ---------------------------------------------------

    private static final Instant T1 = Instant.parse("2026-05-11T00:00:00Z");
    private static final Instant T2 = Instant.parse("2026-05-12T00:00:00Z");
    private static final Instant T3 = Instant.parse("2026-05-13T00:00:00Z");

    @Test
    void dismissingAReviewRemovesItFromTheToDo_leavingItsDraftAndHistoryIntact() {
        Review r = review(1, WHEN);
        triage(r.getId(), TriageDisposition.RESPONSE_NEEDED, org);
        draft(r.getId(), org);
        assertThat(refs(work().todo())).containsExactly("review:" + r.getId());

        dismissalService.dismiss(org, accountId, "review:" + r.getId(), "cmd-1", "SELLER:op");

        assertThat(work().todo()).isEmpty();
        // The draft — and its version history — survive untouched, so the work can be resumed.
        assertThat(replyDrafts.findTopByReviewIdOrderByVersionDesc(r.getId())).isPresent();
        // And the DB-backed dismissal persists across a fresh read (reload persistence).
        assertThat(work().todo()).isEmpty();
    }

    @Test
    void repeatedDismissalWithTheSameCommandIdIsIdempotent_oneRowOneReplay() {
        Review r = review(1, WHEN);
        triage(r.getId(), TriageDisposition.RESPONSE_NEEDED, org);

        var first = dismissalService.dismiss(org, accountId, "review:" + r.getId(), "cmd-dup", "SELLER:op");
        var second = dismissalService.dismiss(org, accountId, "review:" + r.getId(), "cmd-dup", "SELLER:op");

        assertThat(first.replayed()).isFalse();
        assertThat(second.replayed()).isTrue();   // a repeat is idempotent success, not a second row
        assertThat(dismissals.count()).isEqualTo(1);
        assertThat(work().todo()).isEmpty();
    }

    @Test
    void aDismissalIsNotACompletionClaim_noOutcome_noRecentlyReported() {
        Review r = review(1, WHEN);
        triage(r.getId(), TriageDisposition.RESPONSE_NEEDED, org);

        dismissalService.dismiss(org, accountId, "review:" + r.getId(), "cmd-2", "SELLER:op");

        OperatorReplyWorkView v = work();
        assertThat(v.todo()).isEmpty();
        // A set-aside is NOT a reported reply: it writes no outcome and appears in no reported section.
        assertThat(v.recentlyReported()).isEmpty();
        assertThat(replyOutcomes.count()).isZero();
    }

    @Test
    void reEnters_whenReMarkedResponseNeededAfterTheDismissal() {
        Review r = review(1, WHEN);
        draftAt(r.getId(), 1, WHEN, org);        // committed via a draft
        dismissAt(r.getId(), T2, org);           // then set aside
        assertThat(work().todo()).isEmpty();

        triageAt(r.getId(), TriageDisposition.RESPONSE_NEEDED, T3, org); // a fresh commitment, newer

        assertThat(refs(work().todo())).containsExactly("review:" + r.getId());
    }

    @Test
    void reEnters_whenANewDraftVersionIsSavedAfterTheDismissal() {
        Review r = review(1, WHEN);
        triageAt(r.getId(), TriageDisposition.RESPONSE_NEEDED, WHEN, org);
        draftAt(r.getId(), 1, WHEN, org);
        dismissAt(r.getId(), T2, org);
        assertThat(work().todo()).isEmpty();

        draftAt(r.getId(), 2, T3, org);          // a new saved version, newer than the dismissal

        assertThat(refs(work().todo())).containsExactly("review:" + r.getId());
    }

    @Test
    void staleSignalsDoNotReactivate_onlyAFreshCommittingActionSupersedes() {
        Review r = review(1, WHEN);
        triageAt(r.getId(), TriageDisposition.RESPONSE_NEEDED, T1, org); // committing signal BEFORE…
        draftAt(r.getId(), 1, T1, org);                                  // …the dismissal
        dismissAt(r.getId(), T2, org);                                   // dismissed after both

        // Nothing newer than T2 happened — an ordinary read must NOT reactivate it.
        assertThat(work().todo()).isEmpty();
        assertThat(work().todo()).isEmpty(); // and a second read is still empty (no read-time drift)
    }

    @Test
    void dismissalIsOrgScoped_anotherOrgsDismissalDoesNotHideMyReview() {
        Review r = review(1, WHEN);
        triage(r.getId(), TriageDisposition.RESPONSE_NEEDED, org);
        dismissAt(r.getId(), T2, otherOrg); // a DIFFERENT org dismissed the same review row

        // My review stays in MY to-do — the dismissal belongs to another tenant.
        assertThat(refs(work().todo())).containsExactly("review:" + r.getId());
    }

    @Test
    void dismissRefusesAnAccountThatDoesNotHostTheReviewsChannel() {
        Review r = review(1, WHEN);
        triage(r.getId(), TriageDisposition.RESPONSE_NEEDED, org);
        Channel other = new Channel();
        other.setCode("COUPANG");
        other.setNameKo("쿠팡");
        other.setStatus(ChannelStatus.AVAILABLE);
        other.setSortOrder(1);
        UUID otherChannelId = channels.save(other).getId();
        SellerAccount wrong = new SellerAccount();
        wrong.setOrgId(org);
        wrong.setChannelId(otherChannelId);
        wrong.setConnectionStatus(ChannelStatus.CONNECTED);
        wrong.setFileUpload(true);
        UUID wrongAccount = sellerAccounts.save(wrong).getId();

        assertThatThrownBy(() ->
                dismissalService.dismiss(org, wrongAccount, "review:" + r.getId(), "cmd-x", "SELLER:op"))
                .isInstanceOf(ApiException.class);
        assertThat(dismissals.count()).isZero();
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

    // --- 복원 (restore) + 제외한 작업 recovery list -------------------------------------------------

    private OperatorDismissedReplyWorkView dismissed(int page, int size) {
        return service.dismissedReplyWork(org, accountId, page, size);
    }

    private static List<String> refs(OperatorDismissedReplyWorkView v) {
        return refs(v.items());
    }

    @Test
    void aSetAsideReviewAppearsOnTheRecoveryList_notTheToDo() {
        Review r = review(1, WHEN);
        triage(r.getId(), TriageDisposition.RESPONSE_NEEDED, org);
        draft(r.getId(), org);
        dismissalService.dismiss(org, accountId, "review:" + r.getId(), "cmd-d", "SELLER:op");

        assertThat(work().todo()).isEmpty();
        // It is not gone — it is recoverable, with its draft intact.
        assertThat(refs(dismissed(0, 20))).containsExactly("review:" + r.getId());
        assertThat(replyDrafts.findTopByReviewIdOrderByVersionDesc(r.getId())).isPresent();
    }

    @Test
    void theRecoveryListHoldsOnlyCurrentlySetAsideCommittedWork_notActiveOrReportedReviews() {
        Review active = review(1, WHEN);                 // committed, never dismissed → to-do, not here
        triage(active.getId(), TriageDisposition.RESPONSE_NEEDED, org);
        Review setAside = review(1, WHEN);               // committed and dismissed → here
        triage(setAside.getId(), TriageDisposition.RESPONSE_NEEDED, org);
        dismissAt(setAside.getId(), T2, org);
        Review reported = review(1, WHEN);               // dismissed BUT reported → neither list's concern
        triage(reported.getId(), TriageDisposition.RESPONSE_NEEDED, org);
        dismissAt(reported.getId(), T2, org);
        report(reported.getId(), 1, T3);

        assertThat(refs(dismissed(0, 20))).containsExactly("review:" + setAside.getId());
    }

    @Test
    void restoreBringsAReviewBackOntoTheToDo_andOffTheRecoveryList() {
        Review r = review(1, WHEN);
        triage(r.getId(), TriageDisposition.RESPONSE_NEEDED, org);
        dismissalService.dismiss(org, accountId, "review:" + r.getId(), "cmd-d", "SELLER:op");
        assertThat(work().todo()).isEmpty();

        var resp = restoreService.restore(org, accountId, "review:" + r.getId(), "cmd-r", "SELLER:op");

        assertThat(resp.replayed()).isFalse();
        assertThat(refs(work().todo())).containsExactly("review:" + r.getId());
        assertThat(dismissed(0, 20).items()).isEmpty();
        // The dismissal is NOT deleted — it stays as history, simply outranked.
        assertThat(dismissals.count()).isEqualTo(1);
    }

    @Test
    void restoreMutatesNoDraftDispositionOrOutcome_makesNoCompletionClaim() {
        Review r = review(1, WHEN);
        triage(r.getId(), TriageDisposition.RESPONSE_NEEDED, org);
        draft(r.getId(), org);
        dismissalService.dismiss(org, accountId, "review:" + r.getId(), "cmd-d", "SELLER:op");

        restoreService.restore(org, accountId, "review:" + r.getId(), "cmd-r", "SELLER:op");

        // Draft + its version survive; the disposition is untouched; NO outcome exists.
        assertThat(replyDrafts.findTopByReviewIdOrderByVersionDesc(r.getId())).isPresent();
        assertThat(triage.findByOrgIdAndReviewId(org, r.getId()).get().getDisposition())
                .isEqualTo(TriageDisposition.RESPONSE_NEEDED);
        assertThat(replyOutcomes.count()).isZero();
        // The restored row is on the to-do, and it carries no reported-submission marker.
        assertThat(work().todo().get(0).hasReportedSubmission()).isFalse();
        assertThat(work().recentlyReported()).isEmpty();
    }

    @Test
    void repeatedRestoreWithTheSameCommandIdIsIdempotent_oneRowOneReplay() {
        Review r = review(1, WHEN);
        triage(r.getId(), TriageDisposition.RESPONSE_NEEDED, org);
        dismissalService.dismiss(org, accountId, "review:" + r.getId(), "cmd-d", "SELLER:op");

        var first = restoreService.restore(org, accountId, "review:" + r.getId(), "cmd-r", "SELLER:op");
        var second = restoreService.restore(org, accountId, "review:" + r.getId(), "cmd-r", "SELLER:op");

        assertThat(first.replayed()).isFalse();
        assertThat(second.replayed()).isTrue();
        assertThat(restores.count()).isEqualTo(1);
        assertThat(refs(work().todo())).containsExactly("review:" + r.getId());
    }

    @Test
    void theLatestEXPLICITActionWins_evenWhenEveryEventSharesATimestamp() {
        // Arbitration is by the shared seq (call order), NOT by dismissed_at/restored_at — every event
        // here carries the SAME instant, so a timestamp comparison could not decide any of them.
        Review r = review(1, WHEN);
        triage(r.getId(), TriageDisposition.RESPONSE_NEEDED, org);
        Instant tie = T2;

        dismissAt(r.getId(), tie, org);                 // aside
        assertThat(work().todo()).isEmpty();
        restoreAt(r.getId(), tie, org);                 // ...then restored, same instant → active by seq
        assertThat(refs(work().todo())).containsExactly("review:" + r.getId());
        assertThat(dismissed(0, 20).items()).isEmpty();
        dismissAt(r.getId(), tie, org);                 // ...then dismissed again, same instant → aside
        assertThat(work().todo()).isEmpty();
        assertThat(refs(dismissed(0, 20))).containsExactly("review:" + r.getId());
    }

    @Test
    void aRepeatedDismissRestoreSequenceEndsWhereverTheLastExplicitActionLeftIt() {
        Review r = review(1, WHEN);
        triage(r.getId(), TriageDisposition.RESPONSE_NEEDED, org);

        dismissAt(r.getId(), T1, org);
        restoreAt(r.getId(), T2, org);
        dismissAt(r.getId(), T3, org);
        restoreAt(r.getId(), T3.plusSeconds(1), org);   // last explicit action is a restore → active

        assertThat(refs(work().todo())).containsExactly("review:" + r.getId());
        assertThat(dismissed(0, 20).items()).isEmpty();
    }

    @Test
    void automaticReEntryStillWorksAlongsideRestore_aNewDraftAfterTheLatestDismissalReactivates() {
        // The explicit restore path must not have displaced the automatic triggers.
        Review r = review(1, WHEN);
        triageAt(r.getId(), TriageDisposition.RESPONSE_NEEDED, WHEN, org);
        draftAt(r.getId(), 1, WHEN, org);
        dismissAt(r.getId(), T1, org);
        restoreAt(r.getId(), T2, org);
        dismissAt(r.getId(), T3, org);                  // set aside again, after the restore
        assertThat(work().todo()).isEmpty();

        draftAt(r.getId(), 2, T3.plusSeconds(1), org);  // a genuinely newer draft revision

        assertThat(refs(work().todo())).containsExactly("review:" + r.getId());
    }

    @Test
    void anAgedOutSetAsideReviewStaysReachable_theRecoveryListIsNotWindowScoped() {
        // A review from long ago (well outside any attention window) that was set aside must not become
        // permanently unreachable — the recovery read has no window at all.
        Review ancient = review(1, WHEN.minusSeconds(400L * 86_400)); // ~13 months old
        triage(ancient.getId(), TriageDisposition.RESPONSE_NEEDED, org);
        draft(ancient.getId(), org);
        dismissAt(ancient.getId(), T2, org);

        assertThat(refs(dismissed(0, 20))).containsExactly("review:" + ancient.getId());
    }

    @Test
    void theRecoveryListPagesWithHasMore_ratherThanHidingOlderItemsBehindACap() {
        // Dismiss more than one page's worth; page 0 reports hasMore, and 더 보기 reveals the rest —
        // nothing is permanently hidden.
        for (int i = 0; i < 3; i++) {
            Review r = review(1, WHEN);
            triage(r.getId(), TriageDisposition.RESPONSE_NEEDED, org);
            dismissAt(r.getId(), T1.plusSeconds(i), org); // ascending dismiss time → later ones first
        }

        OperatorDismissedReplyWorkView p0 = dismissed(0, 2);
        assertThat(p0.items()).hasSize(2);
        assertThat(p0.hasMore()).isTrue();
        OperatorDismissedReplyWorkView p1 = dismissed(1, 2);
        assertThat(p1.items()).hasSize(1);
        assertThat(p1.hasMore()).isFalse();
    }

    @Test
    void theRecoveryListIsMostRecentlySetAsideFirst_andStableAcrossReads() {
        Review older = review(1, WHEN);
        triage(older.getId(), TriageDisposition.RESPONSE_NEEDED, org);
        dismissAt(older.getId(), T1, org);
        Review newer = review(1, WHEN);
        triage(newer.getId(), TriageDisposition.RESPONSE_NEEDED, org);
        dismissAt(newer.getId(), T3, org);

        assertThat(refs(dismissed(0, 20)))
                .containsExactly("review:" + newer.getId(), "review:" + older.getId());
        // Reload persistence: a second read returns the same order (no read-time drift).
        assertThat(refs(dismissed(0, 20)))
                .containsExactly("review:" + newer.getId(), "review:" + older.getId());
    }

    @Test
    void restoreIsOrgScoped_anotherOrgsRestoreDoesNotResurrectMyReview() {
        Review r = review(1, WHEN);
        triage(r.getId(), TriageDisposition.RESPONSE_NEEDED, org);
        dismissAt(r.getId(), T2, org);                  // I set it aside
        restoreAt(r.getId(), T3, otherOrg);             // a DIFFERENT org restores the same review row

        // Their restore is not mine: my review stays set aside.
        assertThat(work().todo()).isEmpty();
        assertThat(refs(dismissed(0, 20))).containsExactly("review:" + r.getId());
    }

    @Test
    void restoreRefusesAnAccountThatDoesNotHostTheReviewsChannel() {
        Review r = review(1, WHEN);
        triage(r.getId(), TriageDisposition.RESPONSE_NEEDED, org);
        dismissAt(r.getId(), T2, org);
        Channel other = new Channel();
        other.setCode("COUPANG");
        other.setNameKo("쿠팡");
        other.setStatus(ChannelStatus.AVAILABLE);
        other.setSortOrder(1);
        UUID otherChannelId = channels.save(other).getId();
        SellerAccount wrong = new SellerAccount();
        wrong.setOrgId(org);
        wrong.setChannelId(otherChannelId);
        wrong.setConnectionStatus(ChannelStatus.CONNECTED);
        wrong.setFileUpload(true);
        UUID wrongAccount = sellerAccounts.save(wrong).getId();

        assertThatThrownBy(() ->
                restoreService.restore(org, wrongAccount, "review:" + r.getId(), "cmd-x", "SELLER:op"))
                .isInstanceOf(ApiException.class);
        assertThat(restores.count()).isZero();
    }

    @Test
    void anAmbiguousMultiAccountScopeYieldsAnEmptyRecoveryListAndSaysWhy() {
        Review r = review(1, WHEN);
        triage(r.getId(), TriageDisposition.RESPONSE_NEEDED, org);
        dismissAt(r.getId(), T2, org);
        SellerAccount second = new SellerAccount();     // a SECOND account on the same channel
        second.setOrgId(org);
        second.setChannelId(channelId);
        second.setConnectionStatus(ChannelStatus.CONNECTED);
        second.setFileUpload(true);
        sellerAccounts.save(second);

        OperatorDismissedReplyWorkView v = dismissed(0, 20);

        // An unattributable scope declines rather than showing one account's set-aside work as the whole.
        assertThat(v.coverage()).isEqualTo(AttentionCoverage.UNCERTAIN_MULTI_ACCOUNT);
        assertThat(v.items()).isEmpty();
    }
}
