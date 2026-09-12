package com.sellerops.review.channel;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.common.ApiException;
import com.sellerops.itemanalysis.ItemAnalysisRepository;
import com.sellerops.product.ProductRepository;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewReplyState;
import com.sellerops.review.ReviewRepository;
import com.sellerops.review.channel.dto.ChannelReviewDetailView;
import com.sellerops.review.channel.dto.ChannelReviewItemView;
import com.sellerops.review.channel.dto.TriageFeedbackRequests;
import com.sellerops.review.triage.ReviewTriageTier;
import com.sellerops.review.triage.feedback.AiTriageCurrent;
import com.sellerops.review.triage.feedback.AiTriageCurrentRepository;
import com.sellerops.review.triage.feedback.CorrectionDispositionRepository;
import com.sellerops.review.triage.feedback.SellerCorrectionState;
import com.sellerops.review.triage.feedback.TriageActionRepository;
import com.sellerops.review.triage.feedback.TriageBehaviorEventRepository;
import com.sellerops.review.triage.feedback.TriageCorrection;
import com.sellerops.review.triage.feedback.TriageCorrectionAuditRepository;
import com.sellerops.review.triage.feedback.TriageCorrectionRepository;
import com.sellerops.review.triage.feedback.TriageFeedbackService;
import com.sellerops.review.triage.feedback.TriagePredictionRepository;
import com.sellerops.review.triage.feedback.TriageShownSource;
import com.sellerops.review.triage.pilot.AiTriagePilotService;
import com.sellerops.attention.reply.ReviewReplyApprovalRepository;
import com.sellerops.attention.reply.ReviewReplyDraftRepository;
import com.sellerops.attention.reply.ReviewReplyWorkLookup;
import com.sellerops.attention.triage.ReviewTriageRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncJobRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
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
 * Seller triage correction (T-07) against a real database — the seven product requirements, each as
 * the assertion that would have failed before V99.
 *
 * <p>These are the requirements, not the implementation: the seller can correct a review the AI has
 * never seen; they can say any of the three things the screen says; the system's judgment is still
 * there afterwards; a refresh does not lose the correction; changing it is recorded; and a correction
 * is Decision Data that never lands in the silver behaviour table.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class SellerTriageCorrectionIT {

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
    @Autowired ReviewReplyDraftRepository drafts;
    @Autowired ReviewReplyApprovalRepository approvals;

    private static final UUID SELLER = UUID.randomUUID();

    private final UUID org = UUID.randomUUID();
    private SellerAccount account;
    private UUID channelId;
    private ChannelReviewService read;
    private ChannelReviewFeedbackService write;

    @BeforeEach
    void setUp() {
        Channel ch = new Channel();
        ch.setCode("NAVER");
        ch.setNameKo("네이버");
        ch.setStatus(ChannelStatus.AVAILABLE);
        ch.setSupportsInquiry(true);
        ch.setSupportsReview(true);
        ch.setSupportsOrder(true);
        ch.setSupportsSales(true);
        ch.setSupportsProduct(true);
        ch.setSortOrder(0);
        channels.save(ch);
        channelId = ch.getId();

        SellerAccount acc = new SellerAccount();
        acc.setOrgId(org);
        acc.setChannelId(channelId);
        acc.setConnectionStatus(ChannelStatus.CONNECTED);
        acc.setFileUpload(false);
        account = accounts.save(acc);

        AiTriagePilotService pilotOff = ChannelReviewTriageIT.pilotOff();
        TriageFeedbackService feedback = new TriageFeedbackService(predictions, corrections, dispositions,
                aiCurrent, actions, behavior, correctionAudit);
        read = new ChannelReviewService(reviews, products, accounts, syncJobs, analyses, aiCurrent,
                pilotOff, channels, new ReviewReplyWorkLookup(triages, drafts, approvals),
                corrections, correctionAudit);
        write = new ChannelReviewFeedbackService(reviews, accounts, channels, feedback, pilotOff,
                corrections, actions, behavior);
    }

    // ── 1. the pilot is not permission ───────────────────────────────────────────────────────────

    @Test
    @DisplayName("the AI pilot is OFF and a rule-tiered review is still the seller's to correct — shownSource says RULES")
    void correctionIsNotGatedOnThePilot() {
        Review r = review(1, "설명과 완전히 다릅니다");   // rules tier: NEEDS_ATTENTION

        TriageFeedbackRequests.CorrectionView view = write.correct(org, account.getId(), r.getId(),
                new TriageFeedbackRequests.Correction("WATCH", null), SELLER);

        assertThat(view.correctedTier()).isEqualTo("WATCH");
        // The seller was disagreeing with the RATING RULE, and the row says which mechanism it was.
        // No prediction exists for this review at all — the pilot has never run here.
        assertThat(view.systemSource()).isEqualTo("RULES");
        assertThat(view.systemTier()).isEqualTo("NEEDS_ATTENTION");
        assertThat(predictions.findAll()).isEmpty();
    }

    // ── 2. three values, and WATCH is not FYI ────────────────────────────────────────────────────

    @Test
    @DisplayName("the seller can say any of the three, and 지켜보기 and 참고 are stored as different answers")
    void allThreeTiersAreTheSellersToChoose() {
        Review watch = review(1, "포장이 좀 아쉬웠어요");
        Review fyi = review(1, "쓸만합니다");

        write.correct(org, account.getId(), watch.getId(),
                new TriageFeedbackRequests.Correction("WATCH", null), SELLER);
        write.correct(org, account.getId(), fyi.getId(),
                new TriageFeedbackRequests.Correction("FYI", null), SELLER);

        // Before V99 both of these were one boolean — 필요 없음 — and both landed as WATCH, because
        // WATCH is what the RULE says for a 1★ row whose attention the seller declined. The seller's
        // two different answers were indistinguishable afterwards.
        assertThat(corrections.findByReviewId(watch.getId()).orElseThrow().getCorrectedTier())
                .isEqualTo(ReviewTriageTier.WATCH);
        assertThat(corrections.findByReviewId(fyi.getId()).orElseThrow().getCorrectedTier())
                .isEqualTo(ReviewTriageTier.FYI);
    }

    @Test
    @DisplayName("an unknown tier is a sentence, not a row")
    void anUnknownTierIsRefused() {
        Review r = review(3, "보통이에요");
        assertThatThrownBy(() -> write.correct(org, account.getId(), r.getId(),
                new TriageFeedbackRequests.Correction("PROBABLY", null), SELLER))
                .isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> write.correct(org, account.getId(), r.getId(),
                new TriageFeedbackRequests.Correction(null, null), SELLER))
                .isInstanceOf(ApiException.class);
        assertThat(corrections.findByReviewId(r.getId())).isEmpty();
        assertThat(correctionAudit.findByReviewIdOrderByDecidedAtAsc(r.getId())).isEmpty();
    }

    // ── 3 + 4. both judgments survive, and a refresh keeps them ─────────────────────────────────

    @Test
    @DisplayName("the system's judgment is not overwritten, and the correction is still there on the next read")
    void bothJudgmentsSurviveARefresh() {
        Review r = review(1, "접착이 하루만에 떨어졌어요");

        write.correct(org, account.getId(), r.getId(),
                new TriageFeedbackRequests.Correction("FYI", null), SELLER);

        // A FRESH read — the request a browser refresh makes. Nothing is carried in memory from the
        // write above; before T-07 this is exactly where the correction disappeared from the screen.
        ChannelReviewDetailView detail = read.detail(org, account.getId(), r.getId());
        assertThat(detail.sellerCorrection()).isNotNull();
        assertThat(detail.sellerCorrection().correctedTier()).isEqualTo("FYI");
        // ...and the system still says what it always said. Two answers, both readable, neither
        // replacing the other.
        assertThat(detail.triage().tier()).isEqualTo(ReviewTriageTier.NEEDS_ATTENTION);

        ChannelReviewItemView row = rowFor(r);
        assertThat(row.sellerCorrection()).isNotNull();
        assertThat(row.sellerCorrection().correctedTier()).isEqualTo("FYI");
        assertThat(row.triage().tier()).isEqualTo(ReviewTriageTier.NEEDS_ATTENTION);
    }

    @Test
    @DisplayName("a correction does not re-rank the queue — the corrected review sits where the system put it")
    void aCorrectionDoesNotMoveTheRow() {
        Review low = review(1, "떨어졌어요");       // NEEDS_ATTENTION
        Review high = review(5, "좋아요");           // FYI
        List<UUID> before = read.list(org, account.getId(), "attention", null, 0, 20)
                .items().stream().map(ChannelReviewItemView::id).toList();

        write.correct(org, account.getId(), low.getId(),
                new TriageFeedbackRequests.Correction("FYI", null), SELLER);
        write.correct(org, account.getId(), high.getId(),
                new TriageFeedbackRequests.Correction("NEEDS_ATTENTION", null), SELLER);

        List<UUID> after = read.list(org, account.getId(), "attention", null, 0, 20)
                .items().stream().map(ChannelReviewItemView::id).toList();
        // The seller said the opposite of the system about BOTH rows and the order did not move:
        // FINAL_TIER_RANK does not read the correction table. Overwriting the system's judgment is
        // exactly what requirement 3 forbids, and re-sorting is that overwrite wearing a different hat.
        assertThat(after).containsExactlyElementsOf(before);
        assertThat(before).containsExactly(low.getId(), high.getId());
    }

    // ── 5. a change of mind is recorded ─────────────────────────────────────────────────────────

    @Test
    @DisplayName("changing a correction keeps what it said before, and the trail names the real predecessor")
    void changingACorrectionIsRecorded() {
        Review r = review(3, "생각보다 얇네요");

        write.correct(org, account.getId(), r.getId(),
                new TriageFeedbackRequests.Correction("NEEDS_ATTENTION", null), SELLER);
        write.correct(org, account.getId(), r.getId(),
                new TriageFeedbackRequests.Correction("WATCH", null), SELLER);
        write.correct(org, account.getId(), r.getId(),
                new TriageFeedbackRequests.Correction("FYI", null), SELLER);

        // One live row — the seller's current word — and a trail that still knows the other two.
        assertThat(corrections.findByReviewId(r.getId()).orElseThrow().getCorrectedTier())
                .isEqualTo(ReviewTriageTier.FYI);
        assertThat(write.correctionHistory(org, account.getId(), r.getId()))
                .extracting(TriageFeedbackRequests.CorrectionHistoryView::kind,
                        TriageFeedbackRequests.CorrectionHistoryView::tierFrom,
                        TriageFeedbackRequests.CorrectionHistoryView::tierTo)
                .containsExactly(
                        tuple("SET", null, "NEEDS_ATTENTION"),
                        tuple("SET", "NEEDS_ATTENTION", "WATCH"),
                        tuple("SET", "WATCH", "FYI"));
    }

    // ── 6. 되돌리기 ──────────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("withdrawing returns the review to the system's judgment alone, and does not delete the history")
    void withdrawingIsNotDeleting() {
        Review r = review(1, "포장이 찢어져 왔어요");
        write.correct(org, account.getId(), r.getId(),
                new TriageFeedbackRequests.Correction("FYI", null), SELLER);

        write.withdraw(org, account.getId(), r.getId(), SELLER);

        // Nothing stands, so the screen reads as the system's judgment alone.
        assertThat(read.detail(org, account.getId(), r.getId()).sellerCorrection()).isNull();
        assertThat(rowFor(r).sellerCorrection()).isNull();
        // The row is still there — deleting it would cascade into review_correction_dispositions and
        // could take a row out of a FROZEN evaluation snapshot.
        TriageCorrection row = corrections.findByReviewId(r.getId()).orElseThrow();
        assertThat(row.getState()).isEqualTo(SellerCorrectionState.WITHDRAWN);
        assertThat(write.correctionHistory(org, account.getId(), r.getId()))
                .extracting(TriageFeedbackRequests.CorrectionHistoryView::kind,
                        TriageFeedbackRequests.CorrectionHistoryView::tierFrom,
                        TriageFeedbackRequests.CorrectionHistoryView::tierTo)
                .containsExactly(tuple("SET", null, "FYI"), tuple("WITHDRAWN", "FYI", null));

        // Correcting again after a withdrawal is a FIRST correction: nothing stood, so there was no
        // predecessor to leave, and claiming one would invent a transition the seller never made.
        write.correct(org, account.getId(), r.getId(),
                new TriageFeedbackRequests.Correction("WATCH", null), SELLER);
        assertThat(write.correctionHistory(org, account.getId(), r.getId()))
                .last()
                .extracting(TriageFeedbackRequests.CorrectionHistoryView::tierFrom)
                .isNull();
    }

    @Test
    @DisplayName("withdrawing twice writes no second row — a press that changed nothing is not a history")
    void withdrawingTwiceIsANoOp() {
        Review r = review(2, "그냥 그래요");
        write.correct(org, account.getId(), r.getId(),
                new TriageFeedbackRequests.Correction("FYI", null), SELLER);
        write.withdraw(org, account.getId(), r.getId(), SELLER);
        write.withdraw(org, account.getId(), r.getId(), SELLER);
        assertThat(correctionAudit.countByReviewId(r.getId())).isEqualTo(2);
    }

    // ── 7 + 8. Decision Data, and which mechanism was corrected ─────────────────────────────────

    @Test
    @DisplayName("a correction writes no behaviour event — Decision Data never lands in the silver table")
    void correctionsAreNotClickAnalytics() {
        Review r = review(4, "설치가 좀 어려웠습니다");
        write.correct(org, account.getId(), r.getId(),
                new TriageFeedbackRequests.Correction("WATCH", null), SELLER);
        write.withdraw(org, account.getId(), r.getId(), SELLER);

        // Silver is navigation; this is an answer to a question. Contract §3 keeps them in different
        // tables and §4.6 keeps their snapshots separate; a correction that also wrote a behaviour row
        // would let one press be counted twice at two different strengths.
        assertThat(behavior.findAll()).isEmpty();
        assertThat(actions.findAll()).isEmpty();
    }

    @Test
    @DisplayName("a correction of the pilot's mark and a correction of the rule stay distinguishable")
    void ruleAndPilotCorrectionsAreDistinguishable() {
        // The pilot marked one review; the other it never saw. Both are corrected identically.
        Review marked = review(5, "예쁜데 배송이 너무 늦었어요");
        Review unseen = review(5, "만족합니다");
        mark(marked);

        TriageFeedbackService feedback = new TriageFeedbackService(predictions, corrections, dispositions,
                aiCurrent, actions, behavior, correctionAudit);
        ChannelReviewFeedbackService pilotOn = new ChannelReviewFeedbackService(reviews, accounts, channels,
                feedback, alwaysOnPilot(), corrections, actions, behavior);

        pilotOn.correct(org, account.getId(), marked.getId(),
                new TriageFeedbackRequests.Correction("FYI", null), SELLER);
        pilotOn.correct(org, account.getId(), unseen.getId(),
                new TriageFeedbackRequests.Correction("FYI", null), SELLER);

        assertThat(corrections.findByReviewId(marked.getId()).orElseThrow().getShownSource())
                .isEqualTo(TriageShownSource.AI);
        assertThat(corrections.findByReviewId(unseen.getId()).orElseThrow().getShownSource())
                .isEqualTo(TriageShownSource.RULES);
        // And so does the trail, which is what makes the distinction answerable a year later — the
        // rule's tier is recomputed at read time and the pilot may have re-run since.
        assertThat(correctionAudit.findByReviewIdOrderByDecidedAtAsc(marked.getId()))
                .singleElement()
                .extracting(a -> a.getShownSource().name())
                .isEqualTo("AI");
    }

    // ── fixtures ────────────────────────────────────────────────────────────────────────────────

    private ChannelReviewItemView rowFor(Review r) {
        return read.list(org, account.getId(), "attention", null, 0, 50).items().stream()
                .filter(i -> i.id().equals(r.getId())).findFirst().orElseThrow();
    }

    /** A pilot whose surface is on for every org, with no classifier behind it — display only. */
    private AiTriagePilotService alwaysOnPilot() {
        return new AiTriagePilotService(
                new com.sellerops.review.triage.pilot.AiTriagePilotProperties(
                        true, "*", "OPENAI", "m", "k", true, 4000, "low", 100),
                reviews, accounts, channels, aiCurrent, null,
                new com.sellerops.review.triage.llm.ReviewTriageChannelGate(
                        new com.sellerops.review.triage.llm.ReviewTriageClassifier() {
                            @Override public String version() { return "test/v"; }
                            @Override public Result classify(Input input) {
                                throw new AssertionError("the display path must not classify");
                            }
                        }));
    }

    private void mark(Review r) {
        AiTriageCurrent c = new AiTriageCurrent();
        c.setOrgId(org);
        c.setReviewId(r.getId());
        c.setPredictionId(prediction(r));
        c.setAiAttention(true);
        c.setClassifierVersion("test/v");
        c.setPredictedAt(Instant.now());
        aiCurrent.save(c);
    }

    private UUID prediction(Review r) {
        com.sellerops.review.triage.feedback.TriagePrediction p =
                new com.sellerops.review.triage.feedback.TriagePrediction();
        p.setOrgId(org);
        p.setReviewId(r.getId());
        p.setStatus(com.sellerops.review.triage.llm.ReviewTriageClassifier.Status.OK);
        p.setTier(ReviewTriageTier.NEEDS_ATTENTION);
        p.setClassifierVersion("test/v");
        p.setModelId("m");
        p.setPromptHash("h");
        p.setPredictedAt(Instant.now());
        return predictions.save(p).getId();
    }

    private Review review(Integer rating, String body) {
        Review r = new Review();
        r.setOrgId(org);
        r.setChannelId(channelId);
        r.setBody(body);
        r.setRating(rating);
        r.setNegative(rating != null && rating <= 2);
        r.setReceivedAt(LocalDate.of(2026, 9, 1).atStartOfDay(ZoneOffset.UTC).toInstant());
        r.setContentHash(UUID.randomUUID().toString());
        r.setDedupKeyVersion(2);
        r.setReplyState(ReviewReplyState.UNKNOWN);
        r.setMediaCount(0);
        r.setCreatedAt(Instant.now());
        return reviews.save(r);
    }
}
