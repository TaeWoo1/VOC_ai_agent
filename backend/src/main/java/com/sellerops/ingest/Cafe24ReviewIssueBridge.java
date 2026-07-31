package com.sellerops.ingest;

import com.sellerops.ingest.canonical.CanonicalCommunityArticle;
import com.sellerops.reviewimport.ReviewSegmentIngestedEvent;
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
 * Fresh-ingest side of the Cafe24 REVIEW → Issue-Memory bridge: as a board-4 review sync ingests a
 * page, promote its <b>public REVIEW</b> articles into canonical {@link com.sellerops.review.Review}
 * rows (via the shared {@link Cafe24ReviewPromoter}) so they reach the EXISTING Issue-Memory pipeline
 * — <b>no new pipeline, no new LangGraph, no migration</b>. The historical counterpart (articles
 * stored before this bridge existed) is {@code Cafe24ReviewPromotionReconciler}, which promotes from
 * storage with no Cafe24 API call.
 *
 * <p><b>Why a projection.</b> Issue-Memory evidence is a NOT-NULL FK to {@code reviews(id)} (V31) and
 * extraction consumes a {@code Review} body, so a review must exist as a first-class row. The promoted
 * row carries honest CAFE24 provenance (channel + {@code cafe24:b<board>:a<no>} external id) — it is a
 * genuine review in the channel-neutral store, not a NAVER disguise. See {@link Cafe24ReviewPromoter}.
 *
 * <p><b>Boundaries.</b> Only REVIEW articles promote; 비밀글(secret) reviews are excluded fail-closed
 * <b>before</b> storage so they never reach here; board-6/9 inquiries route elsewhere. Idempotent by
 * external id (replay promotes 0, no duplicate). No external write/send; the log carries only a count.
 *
 * <p><b>Trigger.</b> On ≥1 newly-promoted review, publish the existing {@link ReviewSegmentIngestedEvent}
 * to drive the existing AFTER_COMMIT refresh — the same seam the NAVER import uses. {@code @Transactional}
 * so promoted rows + event commit together (the calling {@code SyncRunExecutor} is non-transactional).
 *
 * <p><b>Known limitation — single-path per channel.</b> A Cafe24 review is expected to reach the review
 * store via exactly one path: this API-sync bridge (or the reconciler). If the same real review were
 * also manually CSV-uploaded (which {@code /api/uploads} accepts for any channel), it would land as a
 * second {@code reviews} row keyed by content-hash and its issue evidence would count twice. This is
 * the same dual-store tension {@code IngestedReviewVocItemSource} already fences off for the Attention
 * surface; the operating model for Cafe24 reviews is the board-4 API sync, and mixing a manual CSV
 * upload of the same reviews is unsupported (source-precedence undecided — a future cross-source dedup
 * unit if real coexistence is ever required).
 */
@Component
public class Cafe24ReviewIssueBridge {

    private static final Logger log = LoggerFactory.getLogger(Cafe24ReviewIssueBridge.class);

    private final Cafe24ReviewPromoter promoter;
    private final ApplicationEventPublisher events;

    public Cafe24ReviewIssueBridge(Cafe24ReviewPromoter promoter, ApplicationEventPublisher events) {
        this.promoter = promoter;
        this.events = events;
    }

    /**
     * Promote the public board-4 REVIEW articles in this page and, when any were newly promoted,
     * publish {@link ReviewSegmentIngestedEvent}. Idempotent; returns the count newly promoted.
     */
    @Transactional
    public int bridgePublicReviews(UUID orgId, UUID channelId, UUID sellerAccountId,
                                   List<CanonicalCommunityArticle> articles) {
        if (articles == null || articles.isEmpty()) {
            return 0;
        }
        int promoted = 0;
        for (CanonicalCommunityArticle article : articles) {
            if (promoter.promote(orgId, channelId, article.sourceKind(), article.boardNo(),
                    article.articleNo(), article.content(), article.rating(),
                    article.sourceCreatedAt()) == Cafe24ReviewPromoter.Outcome.PROMOTED) {
                promoted++;
            }
        }
        if (promoted > 0) {
            events.publishEvent(new ReviewSegmentIngestedEvent(
                    orgId, channelId, LocalDate.now(ZoneOffset.UTC)));
            log.info("카페24 REVIEW→이슈메모리 브리지: 신규 프로젝션={}", promoted);
        }
        return promoted;
    }
}
