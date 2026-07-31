package com.sellerops.reviewissue;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.community.Cafe24CommunityArticle;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import com.sellerops.ingest.Cafe24ReviewIssueBridge;
import com.sellerops.ingest.Cafe24ReviewPromoter;
import com.sellerops.ingest.Cafe24ReviewPromotionReconciler;
import com.sellerops.ingest.canonical.CanonicalCommunityArticle;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import com.sellerops.reviewimport.ReviewSegmentIngestedEvent;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.PageRequest;
import org.springframework.test.context.ActiveProfiles;

/**
 * The Cafe24 REVIEW → Issue-Memory bridge over a real (H2) DB: a stored public board-4 review article
 * is promoted into a canonical {@link Review} (honest CAFE24 provenance, not a NAVER disguise) and
 * reaches the EXISTING extraction → {@code review_issues} path, with the source article traceable to
 * the issue evidence. Idempotent by external id; secret/inquiry articles never bridge; tenant-isolated.
 *
 * <p>⚠ Validates the JPA mapping + bridge logic, not the migration (H2, Flyway off).
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class Cafe24ReviewIssueBridgeTest {

    @Autowired ReviewRepository reviews;
    @Autowired ReviewIssueRepository issues;
    @Autowired ReviewIssueEvidenceRepository evidence;
    @Autowired ReviewIssueUnknownUnitRepository unknowns;
    @Autowired ReviewIssueStateEventRepository stateEvents;
    @Autowired Cafe24CommunityArticleRepository communityArticles;

    private static final LocalDate REF = LocalDate.of(2026, 6, 29);
    private static final String CAFE24_LATE_DELIVERY = "배송이 너무 늦었어요";

    private final UUID org = UUID.randomUUID();
    private final UUID channel = UUID.randomUUID(); // the CAFE24 channel
    private final UUID account = UUID.randomUUID();

    private final List<Object> published = new ArrayList<>();
    private final ApplicationEventPublisher publisher = published::add;

    private Cafe24ReviewIssueBridge bridge;
    private Cafe24ReviewPromotionReconciler reconciler;
    private ReviewIssueExtractionService extraction;

    @BeforeEach
    void setUp() {
        Cafe24ReviewPromoter promoter = new Cafe24ReviewPromoter(reviews);
        bridge = new Cafe24ReviewIssueBridge(promoter, publisher);
        reconciler = new Cafe24ReviewPromotionReconciler(communityArticles, promoter, publisher);
        extraction = new ReviewIssueExtractionService(
                new RuleBasedIssueSignatureExtractor(false), issues, evidence, unknowns, stateEvents);
    }

    /** Seed an ALREADY-STORED Cafe24 community article (as a prior sync would have persisted it). */
    private Cafe24CommunityArticle storeArticle(long articleNo, String content, int boardNo,
                                                String sourceKind, LocalDate onKst) {
        Cafe24CommunityArticle a = new Cafe24CommunityArticle();
        a.setOrgId(org);
        a.setSellerAccountId(account);
        a.setChannelId(channel);
        a.setBoardNo(boardNo);
        a.setArticleNo(articleNo);
        a.setProductNo(77L);
        a.setSourceKind(sourceKind);
        a.setReplyStatus("UNKNOWN");
        a.setTitle("제목");
        a.setContent(content);
        a.setRating(5);
        a.setSourceCreatedAt(onKst.atStartOfDay(ZoneOffset.UTC).toInstant());
        a.setSourceHash("h" + articleNo);
        a.setCollectedAt(onKst.atStartOfDay(ZoneOffset.UTC).toInstant());
        return communityArticles.save(a);
    }

    private CanonicalCommunityArticle reviewArticle(long articleNo, String content) {
        return new CanonicalCommunityArticle(4, articleNo, "REVIEW", 77L, "제목", content, 5, "N",
                REF.atStartOfDay(ZoneOffset.UTC).toInstant(), null, 1);
    }

    private void extractAll(UUID orgId) {
        for (Review r : reviews.findForIssueExtraction(orgId, PageRequest.of(0, 2000))) {
            extraction.extract(r);
        }
    }

    @Test
    void publicReviewBecomesIssueMemoryCandidateTraceableToTheSourceArticle() {
        int promoted = bridge.bridgePublicReviews(org, channel, account,
                List.of(reviewArticle(3670L, CAFE24_LATE_DELIVERY)));

        assertThat(promoted).isEqualTo(1);
        // Promoted with honest CAFE24 provenance: channel + article-natural-key external id, v1 dedup.
        Review r = reviews.findByOrgIdAndChannelIdAndExternalId(org, channel, "cafe24:b4:a3670")
                .orElseThrow();
        assertThat(r.getChannelId()).isEqualTo(channel);
        assertThat(r.getBody()).isEqualTo(CAFE24_LATE_DELIVERY);
        assertThat(r.getDedupKeyVersion()).isEqualTo(1);
        assertThat(r.getReceivedAt()).isEqualTo(REF.atStartOfDay(ZoneOffset.UTC).toInstant());
        // Honest CAFE24 provenance (not a NAVER disguise): no product mapping, board reply_status
        // never inferred into a reply state, positive rating so not flagged negative.
        assertThat(r.getProductId()).isNull();
        assertThat(r.getReplyState()).isEqualTo(com.sellerops.review.ReviewReplyState.UNKNOWN);
        assertThat(r.isNegative()).isFalse();

        // The existing decoupled seam is used: a ReviewSegmentIngestedEvent for (org, CAFE24 channel).
        assertThat(published).hasSize(1);
        assertThat(published.get(0)).isInstanceOf(ReviewSegmentIngestedEvent.class);
        ReviewSegmentIngestedEvent e = (ReviewSegmentIngestedEvent) published.get(0);
        assertThat(e.orgId()).isEqualTo(org);
        assertThat(e.channelId()).isEqualTo(channel);

        // The existing extraction path turns it into an issue whose evidence FKs back to THIS review.
        extractAll(org);
        ReviewIssue issue = issues.findByOrgIdAndSignatureKey(org, "배송:지연").orElseThrow();
        assertThat(evidence.countByOrgIdAndIssueId(org, issue.getId())).isEqualTo(1);
        assertThat(evidence.findAll())
                .singleElement()
                .satisfies(ev -> assertThat(ev.getReviewId()).isEqualTo(r.getId()));
    }

    @Test
    void replayingTheSameArticleCreatesNoDuplicateReviewIssueOrEvent() {
        List<CanonicalCommunityArticle> page = List.of(reviewArticle(3670L, CAFE24_LATE_DELIVERY));

        assertThat(bridge.bridgePublicReviews(org, channel, account, page)).isEqualTo(1);
        extractAll(org);
        // Replay the identical article (source_hash unchanged → connector re-emits the same row).
        assertThat(bridge.bridgePublicReviews(org, channel, account, page)).isZero();
        extractAll(org);

        assertThat(reviews.findForIssueExtraction(org, PageRequest.of(0, 100))).hasSize(1);
        assertThat(issues.findByOrgIdAndDismissedFalse(org)).hasSize(1);
        assertThat(evidence.count()).isEqualTo(1);
        // The event fired only on the first, review-promoting call.
        assertThat(published).hasSize(1);
    }

    @Test
    void aContentEditKeepsTheFirstSeenReviewPerTheImmutableReviewContract() {
        assertThat(bridge.bridgePublicReviews(org, channel, account,
                List.of(reviewArticle(3670L, CAFE24_LATE_DELIVERY)))).isEqualTo(1);
        // Same article_no, edited content: the review store dedups by external id, so the promoted
        // review is pinned to first-seen content (matches the existing immutable-review contract).
        assertThat(bridge.bridgePublicReviews(org, channel, account,
                List.of(reviewArticle(3670L, "포장이 찌그러져 왔어요")))).isZero();

        Review r = reviews.findByOrgIdAndChannelIdAndExternalId(org, channel, "cafe24:b4:a3670")
                .orElseThrow();
        assertThat(r.getBody()).isEqualTo(CAFE24_LATE_DELIVERY);
        assertThat(reviews.findForIssueExtraction(org, PageRequest.of(0, 100))).hasSize(1);
        assertThat(published).hasSize(1);
    }

    @Test
    void aNonReviewArticleIsNeverBridged() {
        // board-6 문의(PRODUCT_INQUIRY) can never reach the community-article store (inquiries are
        // routed elsewhere), but the bridge also gates defensively on source kind.
        CanonicalCommunityArticle inquiry = new CanonicalCommunityArticle(
                6, 8801L, "PRODUCT_INQUIRY", 88L, "제목", "곡면 가능?", null, "N",
                REF.atStartOfDay(ZoneOffset.UTC).toInstant(), null, 1);

        assertThat(bridge.bridgePublicReviews(org, channel, account, List.of(inquiry))).isZero();
        assertThat(reviews.findForIssueExtraction(org, PageRequest.of(0, 100))).isEmpty();
        assertThat(published).isEmpty();
    }

    @Test
    void aRatingOnlyReviewWithNoBodyIsSkippedNotFailed() {
        // reviews.body is NOT NULL; a rating-only 구매후기 (null/blank content) carries no issue
        // signal and must be skipped, never promoted (and never wedge the sync with a failed save).
        CanonicalCommunityArticle noBody = new CanonicalCommunityArticle(
                4, 3671L, "REVIEW", 77L, "제목", null, 5, "N",
                REF.atStartOfDay(ZoneOffset.UTC).toInstant(), null, 1);
        CanonicalCommunityArticle blankBody = new CanonicalCommunityArticle(
                4, 3672L, "REVIEW", 77L, "제목", "   ", 5, "N",
                REF.atStartOfDay(ZoneOffset.UTC).toInstant(), null, 1);

        int promoted = bridge.bridgePublicReviews(org, channel, account, List.of(noBody, blankBody));

        assertThat(promoted).isZero();
        assertThat(reviews.findForIssueExtraction(org, PageRequest.of(0, 100))).isEmpty();
        assertThat(published).isEmpty();
    }

    @Test
    void anEmptyOrAllExcludedPageProducesNoCandidates() {
        // Secret 비밀글 reviews are excluded fail-closed BEFORE storage, so they never appear in the
        // articles the bridge sees — an all-secret window reaches the bridge as an empty list.
        assertThat(bridge.bridgePublicReviews(org, channel, account, List.of())).isZero();
        assertThat(reviews.findForIssueExtraction(org, PageRequest.of(0, 100))).isEmpty();
        assertThat(issues.findByOrgIdAndDismissedFalse(org)).isEmpty();
        assertThat(published).isEmpty();
    }

    @Test
    void reviewsAndIssuesAreTenantIsolated() {
        UUID otherOrg = UUID.randomUUID();
        bridge.bridgePublicReviews(org, channel, account,
                List.of(reviewArticle(3670L, CAFE24_LATE_DELIVERY)));
        extractAll(org);

        // A different org sees neither the promoted review nor any issue derived from it.
        assertThat(reviews.findByOrgIdAndChannelIdAndExternalId(otherOrg, channel, "cafe24:b4:a3670"))
                .isEmpty();
        assertThat(reviews.findForIssueExtraction(otherOrg, PageRequest.of(0, 100))).isEmpty();
        assertThat(issues.findByOrgIdAndDismissedFalse(otherOrg)).isEmpty();
    }

    // ---- reconciler: historical stored articles, no Cafe24 API call --------------------------

    @Test
    void reconcilerPromotesAStoredPreBridgeReviewIntoIssueMemory() {
        // A review stored by a prior sync (before the bridge existed): a REVIEW sync replay would
        // skip it at ingestion, so only the reconciler (reading storage, no API) can promote it.
        storeArticle(3670L, CAFE24_LATE_DELIVERY, 4, "REVIEW", REF);

        Cafe24ReviewPromotionReconciler.ReconcileResult r =
                reconciler.reconcile(org, account, REF, REF);

        assertThat(r.eligible()).isEqualTo(1);
        assertThat(r.promoted()).isEqualTo(1);
        assertThat(r.alreadyPromoted()).isZero();
        assertThat(r.refreshTriggered()).isTrue();
        assertThat(published).hasSize(1);

        Review promotedReview = reviews
                .findByOrgIdAndChannelIdAndExternalId(org, channel, "cafe24:b4:a3670").orElseThrow();
        extractAll(org);
        ReviewIssue issue = issues.findByOrgIdAndSignatureKey(org, "배송:지연").orElseThrow();
        assertThat(evidence.findAll())
                .singleElement()
                .satisfies(ev -> assertThat(ev.getReviewId()).isEqualTo(promotedReview.getId()));
    }

    @Test
    void secondReconcileOfSameWindowPromotesNothing() {
        storeArticle(3670L, CAFE24_LATE_DELIVERY, 4, "REVIEW", REF);

        reconciler.reconcile(org, account, REF, REF);
        extractAll(org);
        Cafe24ReviewPromotionReconciler.ReconcileResult second =
                reconciler.reconcile(org, account, REF, REF);
        extractAll(org);

        assertThat(second.eligible()).isEqualTo(1);
        assertThat(second.promoted()).isZero();
        assertThat(second.alreadyPromoted()).isEqualTo(1);
        assertThat(second.refreshTriggered()).isFalse();
        assertThat(reviews.findForIssueExtraction(org, PageRequest.of(0, 100))).hasSize(1);
        assertThat(issues.findByOrgIdAndDismissedFalse(org)).hasSize(1);
        assertThat(evidence.count()).isEqualTo(1);
        assertThat(published).hasSize(1); // only the first reconcile published a refresh
    }

    @Test
    void reconcileAfterTheBridgeAlreadyPromotedFindsNoNewWork() {
        storeArticle(3670L, CAFE24_LATE_DELIVERY, 4, "REVIEW", REF);
        // Fresh-ingest bridge already promoted the same article this run.
        bridge.bridgePublicReviews(org, channel, account,
                List.of(reviewArticle(3670L, CAFE24_LATE_DELIVERY)));

        Cafe24ReviewPromotionReconciler.ReconcileResult r =
                reconciler.reconcile(org, account, REF, REF);

        assertThat(r.promoted()).isZero();
        assertThat(r.alreadyPromoted()).isEqualTo(1);
        assertThat(reviews.findForIssueExtraction(org, PageRequest.of(0, 100))).hasSize(1);
    }

    @Test
    void reconcileExcludesOtherAccountWindowAndBoard6() {
        storeArticle(3670L, CAFE24_LATE_DELIVERY, 4, "REVIEW", REF);
        // board-6 inquiry in the same window must never be a target (filtered by source kind).
        storeArticle(8801L, "곡면 가능?", 6, "PRODUCT_INQUIRY", REF);

        // A window that does not contain the review's KST date promotes nothing.
        assertThat(reconciler.reconcile(org, account, REF.plusDays(1), REF.plusDays(1)).promoted())
                .isZero();
        // A different account promotes nothing.
        assertThat(reconciler.reconcile(org, UUID.randomUUID(), REF, REF).eligible()).isZero();

        // The in-window reconcile sees only the REVIEW (board 6 excluded → eligible=1).
        Cafe24ReviewPromotionReconciler.ReconcileResult r = reconciler.reconcile(org, account, REF, REF);
        assertThat(r.eligible()).isEqualTo(1);
        assertThat(r.promoted()).isEqualTo(1);
    }

    @Test
    void reconcileSkipsEmptyBodyButStillPromotesTheRest() {
        storeArticle(3670L, CAFE24_LATE_DELIVERY, 4, "REVIEW", REF);
        storeArticle(3671L, "   ", 4, "REVIEW", REF); // rating-only, blank body

        Cafe24ReviewPromotionReconciler.ReconcileResult r =
                reconciler.reconcile(org, account, REF, REF);

        assertThat(r.eligible()).isEqualTo(2);
        assertThat(r.promoted()).isEqualTo(1);
        assertThat(r.skippedEmptyBody()).isEqualTo(1);
        assertThat(reviews.findForIssueExtraction(org, PageRequest.of(0, 100))).hasSize(1);
    }
}
