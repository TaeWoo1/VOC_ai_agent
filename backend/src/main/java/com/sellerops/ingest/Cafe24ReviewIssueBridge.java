package com.sellerops.ingest;

import com.sellerops.community.CommunitySourceKind;
import com.sellerops.ingest.canonical.CanonicalCommunityArticle;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewReplyState;
import com.sellerops.review.ReviewRepository;
import com.sellerops.reviewimport.ReviewSegmentIngestedEvent;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Bridges stored Cafe24 <b>public board-4 REVIEW</b> community articles into the existing
 * Issue-Memory pipeline, <b>without a new pipeline and without a new LangGraph</b>.
 *
 * <p><b>Why a projection, not an adapter.</b> Issue-Memory evidence is a NOT-NULL foreign key to
 * {@code reviews(id)} ({@code review_issue_evidence.review_id}, V31), and extraction consumes a
 * {@link Review}'s body via {@code ReviewRepository.findForIssueExtraction}. So the minimal seam that
 * lets a Cafe24 review reach the <b>unchanged</b> extraction → {@code review_issues} → {@code issue}
 * graph path is to promote each public article into a first-class {@link Review} row carrying its own
 * honest provenance — {@code channelId} = the CAFE24 channel and {@code externalId} = the article's
 * natural key {@code cafe24:b<board>:a<articleNo>}. This is <b>not</b> disguising it as a NAVER review:
 * {@code reviews} is the channel-neutral review store (it already serves NAVER and ESM+), and the row
 * is tagged with its true CAFE24 channel and a Cafe24 external id.
 *
 * <p><b>Package.</b> This lives in {@code com.sellerops.ingest} (the review-writing side), not
 * {@code reviewissue}, which is read-only over {@code reviews} by architectural rule.
 *
 * <p><b>Boundaries.</b> Only {@link CommunitySourceKind#REVIEW} articles are projected; 비밀글(secret)
 * reviews never reach this bridge because they are excluded fail-closed <b>before</b> storage (the
 * connector never persists a secret board-4 article), and board-6/9 inquiries are routed to the
 * inquiry path, not here. No external write/send; no channel API call. The projected review dedups by
 * {@code externalId}, so replaying the same article is a no-op (no duplicate {@link Review}); a Cafe24
 * article content edit updates only the community-article store — the promoted review is pinned to
 * first-seen content, matching the existing immutable-review dedup contract.
 *
 * <p><b>Trigger.</b> On ≥1 newly-promoted review this publishes the existing
 * {@link ReviewSegmentIngestedEvent}, which the existing {@code ReviewIssueImportRefreshListener}
 * consumes AFTER_COMMIT to run the existing {@code ReviewIssueRefreshService} — the same seam the NAVER
 * import uses. The method is {@code @Transactional} so the promoted rows and the event commit together
 * (the calling {@code SyncRunExecutor} is deliberately non-transactional). Existence is checked before
 * insert, so no unique-constraint violation is provoked inside the transaction.
 *
 * <p><b>Sanitized.</b> No review title/content, writer, member id, or {@code article_no} is ever logged
 * — only a projected count.
 *
 * <p><b>Known limitation — single-path per channel.</b> A Cafe24 review is expected to reach the review
 * store via <b>exactly one</b> path: this API-sync bridge. If the same real review were <em>also</em>
 * manually CSV-uploaded (which {@code /api/uploads} accepts for any channel), it would land as a second
 * {@code reviews} row keyed by content-hash rather than this external id, and issue extraction would
 * count its evidence twice. This is the same dual-store tension {@code IngestedReviewVocItemSource}
 * already fences off for the Attention surface (it excludes CAFE24 precisely because "both stores
 * serving CAFE24 would double-count"); the operating model for Cafe24 reviews is the board-4 API sync,
 * and mixing a manual CSV upload of the same Cafe24 reviews is unsupported.
 */
@Component
public class Cafe24ReviewIssueBridge {

    private static final Logger log = LoggerFactory.getLogger(Cafe24ReviewIssueBridge.class);

    private final ReviewRepository reviews;
    private final ApplicationEventPublisher events;

    public Cafe24ReviewIssueBridge(ReviewRepository reviews, ApplicationEventPublisher events) {
        this.reviews = reviews;
        this.events = events;
    }

    /**
     * Promote the public board-4 REVIEW articles in this page into canonical {@link Review} rows and,
     * when any were newly promoted, publish {@link ReviewSegmentIngestedEvent} to drive the existing
     * issue-memory refresh. Idempotent by {@code (orgId, channelId, externalId)}. Returns the number of
     * reviews newly promoted (0 on a pure replay).
     */
    @Transactional
    public int bridgePublicReviews(UUID orgId, UUID channelId, UUID sellerAccountId,
                                   List<CanonicalCommunityArticle> articles) {
        if (articles == null || articles.isEmpty()) {
            return 0;
        }
        int promoted = 0;
        for (CanonicalCommunityArticle article : articles) {
            // Defensive: only REVIEW articles are bridged. Inquiries (board 6/9) are routed elsewhere
            // and never reach the community-article store; secret reviews are excluded pre-storage.
            if (CommunitySourceKind.normalize(article.sourceKind()) != CommunitySourceKind.REVIEW) {
                continue;
            }
            // A rating-only 구매후기 can carry a null/blank body; reviews.body is NOT NULL and an
            // empty body carries no issue signal, so skip it (never let it fail the save).
            if (article.content() == null || article.content().isBlank()) {
                continue;
            }
            String externalId = "cafe24:b" + article.boardNo() + ":a" + article.articleNo();
            if (reviews.existsByOrgIdAndChannelIdAndExternalId(orgId, channelId, externalId)) {
                continue; // already promoted — idempotent no-op on replay
            }
            Review review = new Review();
            review.setOrgId(orgId);
            review.setChannelId(channelId);
            review.setProductId(null); // Cafe24 carries a source product_no, not our product UUID
            review.setBody(article.content());
            review.setRating(article.rating());
            review.setNegative(article.rating() != null && article.rating() <= 2);
            review.setReceivedAt(article.sourceCreatedAt() != null
                    ? article.sourceCreatedAt() : Instant.now());
            review.setExternalId(externalId);
            review.setContentHash(null); // dedup is by the stable external id, not a content hash
            // Cafe24 reviews dedup by their stable article_no external id; the content-hash formula
            // version is informational and matches the non-GMARKET default (v1).
            review.setDedupKeyVersion(ReviewDedupKey.V1);
            review.setReplyState(ReviewReplyState.UNKNOWN); // never inferred from the board reply_status
            reviews.save(review);
            promoted++;
        }
        if (promoted > 0) {
            // Reuse the existing decoupled seam: the AFTER_COMMIT listener runs issue-memory refresh.
            events.publishEvent(new ReviewSegmentIngestedEvent(
                    orgId, channelId, LocalDate.now(ZoneOffset.UTC)));
            log.info("카페24 REVIEW→이슈메모리 브리지: 신규 프로젝션={}", promoted);
        }
        return promoted;
    }
}
