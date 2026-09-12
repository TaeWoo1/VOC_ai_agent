package com.sellerops.review.workspace;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.attention.reply.ReviewReplyApprovalAuditRepository;
import com.sellerops.attention.reply.ReviewReplyApprovalRepository;
import com.sellerops.attention.reply.ReviewReplyDraftRepository;
import com.sellerops.attention.reply.ReviewReplyOutcomeRepository;
import com.sellerops.attention.reply.ReviewReplyWorkLookup;
import com.sellerops.attention.triage.ReviewTriageAuditRepository;
import com.sellerops.attention.triage.ReviewTriageRepository;
import com.sellerops.attention.triage.ReviewTriageService;
import com.sellerops.attention.triage.ReviewTriageWriter;
import com.sellerops.attention.triage.TriageDisposition;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.common.ApiException;
import com.sellerops.itemanalysis.ItemAnalysisRepository;
import com.sellerops.knowledge.candidate.KnowledgeCandidateRepository;
import com.sellerops.knowledge.org.OrgKnowledgeSourceRepository;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.library.ProductKnowledgeSourceRepository;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewReplyState;
import com.sellerops.review.ReviewRepository;
import com.sellerops.review.channel.ChannelReviewFeedbackService;
import com.sellerops.review.channel.ChannelReviewService;
import com.sellerops.review.channel.dto.ChannelReviewDetailView;
import com.sellerops.review.channel.dto.TriageFeedbackRequests;
import com.sellerops.review.decision.ReviewDecisionWorkspaceService;
import com.sellerops.review.decision.dto.ReviewDecisionLogKind;
import com.sellerops.review.triage.feedback.AiTriageCurrentRepository;
import com.sellerops.review.triage.feedback.CorrectionDispositionRepository;
import com.sellerops.review.triage.feedback.TriageActionKind;
import com.sellerops.review.triage.feedback.TriageActionRepository;
import com.sellerops.review.triage.feedback.TriageBehaviorEventRepository;
import com.sellerops.review.triage.feedback.TriageCorrectionAuditRepository;
import com.sellerops.review.triage.feedback.TriageCorrectionRepository;
import com.sellerops.review.triage.feedback.TriageFeedbackService;
import com.sellerops.review.triage.feedback.TriagePredictionRepository;
import com.sellerops.review.triage.pilot.AiTriagePilotProperties;
import com.sellerops.review.triage.pilot.AiTriagePilotService;
import com.sellerops.reviewissue.ReviewIssueEvidenceRepository;
import com.sellerops.reviewissue.ReviewIssueRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncJobRepository;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.PlatformTransactionManager;

/**
 * <b>Agent-native Core Boundary v1 — Review is an account-independent Core object.</b>
 *
 * <p>Every assertion here is about a review on a channel this org has <b>no seller account on at
 * all</b> — the shape a manual CSV upload and a seller-center export land in, because
 * {@code POST /api/uploads} is addressed by channel and never by account. Before this package that
 * review could be listed on the Home and then opened nowhere: the read that opens the workspace, the
 * two reads behind it, the seller's own judgment, the response decision and the record of having
 * acted were all addressed through {@code /api/seller-accounts/\{id\}}, and there was no id to put
 * there.
 *
 * <p><b>What the account contributed was one predicate</b> — «this account's channel equals the
 * review's channel» — against a channel the review already carries. So the tests below are the same
 * behaviours as before with the segment removed, plus the two that could not be written before: the
 * account-less review decides, and the org boundary still holds without it.
 *
 * <p><b>And the boundary that is real is asserted too</b>: with no account there is no reply work, and
 * the reason says which absence it is. Replying is something an account does.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class AccountIndependentReviewCoreIT {

    @Autowired ReviewRepository reviews;
    @Autowired ProductRepository products;
    @Autowired SellerAccountRepository accounts;
    @Autowired ChannelRepository channels;
    @Autowired SyncJobRepository syncJobs;
    @Autowired ItemAnalysisRepository analyses;
    @Autowired AiTriageCurrentRepository aiCurrent;
    @Autowired TriagePredictionRepository predictions;
    @Autowired TriageCorrectionRepository corrections;
    @Autowired TriageCorrectionAuditRepository correctionAudit;
    @Autowired CorrectionDispositionRepository dispositions;
    @Autowired TriageActionRepository actions;
    @Autowired TriageBehaviorEventRepository behavior;
    @Autowired ReviewTriageRepository triages;
    @Autowired ReviewTriageAuditRepository triageAudit;
    @Autowired ReviewReplyDraftRepository drafts;
    @Autowired ReviewReplyApprovalRepository approvals;
    @Autowired ReviewReplyApprovalAuditRepository approvalAudit;
    @Autowired ReviewReplyOutcomeRepository outcomes;
    @Autowired ReviewIssueRepository issues;
    @Autowired ReviewIssueEvidenceRepository issueEvidence;
    @Autowired ProductKnowledgeSourceRepository productKnowledge;
    @Autowired OrgKnowledgeSourceRepository orgKnowledge;
    @Autowired KnowledgeCandidateRepository candidates;
    @Autowired PlatformTransactionManager txManager;

    private static final UUID SELLER = UUID.randomUUID();

    private final UUID org = UUID.randomUUID();
    /** CAFE24 — a channel with a reply flow, so «no reply work» can only be about the missing account. */
    private UUID uploadedChannel;
    /** COUPANG — a channel with no reply flow at all, and this org has an account on it. */
    private UUID connectedChannel;
    private SellerAccount connectedAccount;

    private ChannelReviewService read;
    private ChannelReviewFeedbackService write;
    private ReviewTriageService decide;
    private ReviewDecisionWorkspaceService workspace;

    @BeforeEach
    void setUp() {
        uploadedChannel = channel("CAFE24", "카페24").getId();
        Channel coupang = channel("COUPANG", "쿠팡");
        connectedChannel = coupang.getId();

        SellerAccount acc = new SellerAccount();
        acc.setOrgId(org);
        acc.setChannelId(connectedChannel);
        acc.setConnectionStatus(ChannelStatus.CONNECTED);
        acc.setFileUpload(false);
        connectedAccount = accounts.save(acc);

        AiTriagePilotService pilotOff = pilotOff();
        TriageFeedbackService feedback = new TriageFeedbackService(predictions, corrections, dispositions,
                aiCurrent, actions, behavior, correctionAudit);
        read = new ChannelReviewService(reviews, products, accounts, syncJobs, analyses, aiCurrent,
                pilotOff, channels, new ReviewReplyWorkLookup(triages, drafts, approvals),
                corrections, correctionAudit);
        write = new ChannelReviewFeedbackService(reviews, accounts, channels, feedback, pilotOff,
                corrections, actions, behavior);
        decide = new ReviewTriageService(triages, triageAudit, reviews, accounts,
                new ReviewTriageWriter(triages, triageAudit, txManager));
        workspace = new ReviewDecisionWorkspaceService(reviews, channels, products, issueEvidence, issues,
                productKnowledge, orgKnowledge, candidates, correctionAudit, actions, triages,
                triageAudit, approvals, approvalAudit, outcomes);
    }

    // ── the whole loop, on a review no account acquired ──────────────────────────────────────────

    @Test
    @DisplayName("a review uploaded to a channel with no account opens, judges, decides and records")
    void theAccountLessReviewRunsTheWholeDecisionLoop() {
        Review uploaded = review(uploadedChannel, 2, "설치하고 이틀만에 떨어졌습니다");
        assertThat(accounts.findAllByOrgIdAndChannelId(org, uploadedChannel)).isEmpty();

        // 1 — it opens.
        ChannelReviewDetailView view = read.detail(org, uploaded.getId());
        assertThat(view.id()).isEqualTo(uploaded.getId());
        assertThat(view.body()).isEqualTo("설치하고 이틀만에 떨어졌습니다");

        // 2 — the two reads behind it answer.
        assertThat(workspace.context(org, uploaded.getId()).decisionRef())
                .isEqualTo("review:" + uploaded.getId());
        assertThat(workspace.log(org, uploaded.getId())).isEmpty();

        // 3 — the seller's own judgment.
        TriageFeedbackRequests.CorrectionView correction = write.correct(org, uploaded.getId(),
                new TriageFeedbackRequests.Correction("WATCH", null), SELLER);
        assertThat(correction.correctedTier()).isEqualTo("WATCH");

        // 4 — the response decision, through the same writer, lock and idempotency key.
        assertThat(decide.decide(org, uploaded.getId(), "RESPONSE_NEEDED",
                        "cmd-" + UUID.randomUUID(), SELLER).disposition())
                .isEqualTo(TriageDisposition.RESPONSE_NEEDED.name());

        // 5 — and the record that they acted.
        write.act(org, uploaded.getId(), TriageActionKind.ACTION_COMPLETED, SELLER);

        // 6 — the trail reads all three back, newest first, from the stores that already held them.
        assertThat(workspace.log(org, uploaded.getId()))
                .extracting(e -> ReviewDecisionLogKind.valueOf(e.kind()))
                .containsExactlyInAnyOrder(ReviewDecisionLogKind.SELLER_JUDGMENT_SET,
                        ReviewDecisionLogKind.ACTION_CHOSEN,
                        ReviewDecisionLogKind.ACTION_RECORDED);
    }

    @Test
    @DisplayName("the decision is idempotent on the account-less address too — a replayed command writes nothing")
    void theCommandIdStillGuardsTheAccountLessDecision() {
        Review uploaded = review(uploadedChannel, 1, "본문");
        String command = "cmd-" + UUID.randomUUID();

        decide.decide(org, uploaded.getId(), "RESPONSE_NEEDED", command, SELLER);
        var replay = decide.decide(org, uploaded.getId(), "RESPONSE_NEEDED", command, SELLER);

        assertThat(replay.replayed()).isTrue();
        // Scoped to THIS review's decision row: the writer commits in its own transaction
        // (`REQUIRES_NEW`), so its rows outlive the test's rollback and a global count would be
        // counting the suite rather than this command.
        UUID decision = triages.findByOrgIdAndReviewId(org, uploaded.getId()).orElseThrow().getId();
        assertThat(triageAudit.findAllByReviewTriageIdOrderByCreatedAtAsc(decision)).hasSize(1);
    }

    // ── the org boundary, which is the authorization that was always doing the work ──────────────

    @Test
    @DisplayName("another org's review is indistinguishable from one that does not exist, with no account in sight")
    void theOrgBoundaryHoldsWithoutAnAccount() {
        Review uploaded = review(uploadedChannel, 1, "본문");
        UUID stranger = UUID.randomUUID();

        assertThatThrownBy(() -> read.detail(stranger, uploaded.getId())).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> workspace.context(stranger, uploaded.getId())).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> workspace.log(stranger, uploaded.getId())).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> write.correct(stranger, uploaded.getId(),
                new TriageFeedbackRequests.Correction("WATCH", null), SELLER)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> write.act(stranger, uploaded.getId(), TriageActionKind.ACTION_STARTED, SELLER))
                .isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> decide.decide(stranger, uploaded.getId(), "MONITOR",
                "cmd-" + UUID.randomUUID(), SELLER)).isInstanceOf(ApiException.class);
        // Nothing was written for this review, by this org OR by the stranger — asserted per review,
        // because the decision writer commits outside the test transaction.
        assertThat(triages.findByOrgIdAndReviewId(org, uploaded.getId())).isEmpty();
        assertThat(triages.findByOrgIdAndReviewId(stranger, uploaded.getId())).isEmpty();
        assertThat(corrections.findByReviewId(uploaded.getId())).isEmpty();
        assertThat(actions.findByReviewIdOrderByActedAtDesc(uploaded.getId())).isEmpty();
    }

    // ── the boundary that did NOT move: replying is something an account does ────────────────────

    @Test
    @DisplayName("with no account there is no reply work, and the reason says it is the account and not the channel")
    void theReplyLaneStaysAccountBound() {
        Review uploaded = review(uploadedChannel, 2, "본문");

        ChannelReviewDetailView view = read.detail(org, uploaded.getId());

        assertThat(view.sellerAccountId()).isNull();
        assertThat(view.replyWork()).isNull();
        // CAFE24 has a reply lane built; what is missing is somebody for the reply to be from.
        assertThat(view.replyUnavailableReason()).isEqualTo("NO_SELLER_ACCOUNT");
    }

    @Test
    @DisplayName("a channel that gives sellers no way to answer says THAT, even with an account connected")
    void theChannelWithNoReplyFlowSaysSo() {
        Review acquired = review(connectedChannel, 2, "본문");

        ChannelReviewDetailView view = read.detail(org, acquired.getId());

        assertThat(view.sellerAccountId()).isEqualTo(connectedAccount.getId());
        assertThat(view.replyWork()).isNull();
        assertThat(view.replyUnavailableReason()).isEqualTo("CHANNEL_HAS_NO_REPLY_FLOW");
    }

    @Test
    @DisplayName("two accounts on one channel name none — a review id cannot say which would reply")
    void anAmbiguousChannelNamesNoAccount() {
        SellerAccount second = new SellerAccount();
        second.setOrgId(org);
        second.setChannelId(connectedChannel);
        second.setConnectionStatus(ChannelStatus.CONNECTED);
        second.setFileUpload(true);
        accounts.save(second);
        Review acquired = review(connectedChannel, 2, "본문");

        assertThat(read.detail(org, acquired.getId()).sellerAccountId()).isNull();
    }

    // ── the old address still answers exactly as it did ──────────────────────────────────────────

    @Test
    @DisplayName("the account-addressed entries still refuse a review from another of the org's channels")
    void theCompatibilityAddressKeepsItsOwnRefusal() {
        Review elsewhere = review(uploadedChannel, 1, "본문");

        assertThatThrownBy(() -> read.detail(org, connectedAccount.getId(), elsewhere.getId()))
                .isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> write.correct(org, connectedAccount.getId(), elsewhere.getId(),
                new TriageFeedbackRequests.Correction("WATCH", null), SELLER))
                .isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> write.act(org, connectedAccount.getId(), elsewhere.getId(),
                TriageActionKind.ACTION_STARTED, SELLER)).isInstanceOf(ApiException.class);
        assertThat(corrections.findByReviewId(elsewhere.getId())).isEmpty();
        assertThat(actions.findByReviewIdOrderByActedAtDesc(elsewhere.getId())).isEmpty();
    }

    // ── fixtures ────────────────────────────────────────────────────────────────────────────────

    /** The pilot, off — the same shape {@code ChannelReviewTriageIT} wires, which is package-private there. */
    private static AiTriagePilotService pilotOff() {
        return new AiTriagePilotService(
                new AiTriagePilotProperties(false, "", "OPENAI", "m", "", true, 4000, "low", 100),
                null, null, null, null, null, null);
    }

    private Channel channel(String code, String nameKo) {
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
        return channels.save(ch);
    }

    private Review review(UUID channelId, int rating, String body) {
        Review r = new Review();
        r.setOrgId(org);
        r.setChannelId(channelId);
        r.setBody(body);
        r.setRating(rating);
        r.setNegative(rating <= 2);
        r.setReceivedAt(Instant.parse("2026-09-01T00:00:00Z"));
        r.setContentHash(UUID.randomUUID().toString());
        r.setDedupKeyVersion(2);
        r.setReplyState(ReviewReplyState.UNKNOWN);
        return reviews.save(r);
    }
}
