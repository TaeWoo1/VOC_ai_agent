package com.sellerops.ingest;

import com.sellerops.community.Cafe24CommunityArticle;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import com.sellerops.community.CommunitySourceKind;
import com.sellerops.reviewimport.ReviewSegmentIngestedEvent;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Historical-gap closer for the Cafe24 REVIEW → Issue-Memory bridge: promotes Cafe24 board-4 public
 * REVIEW community articles that were <b>already stored</b> (e.g. before the bridge existed, or on a
 * run where ingestion skipped them as duplicates so the per-page {@link Cafe24ReviewIssueBridge} was
 * driven only by fresh fetches) into the canonical review store — <b>reading storage only, with no
 * Cafe24 API call</b> — so no stored review with a resolvable KST source date is permanently missing
 * from Issue-Memory. (A row whose {@code sourceCreatedAt} is null falls outside every KST window — the
 * same conservative undercount the window queries already make — and is reachable only via the
 * fresh-ingest bridge, which promotes regardless of date.)
 *
 * <p><b>Bounded.</b> Always scoped to one (org, seller account) and one exact KST date window; it never
 * does a boot-time or global scan. Idempotent: an already-promoted article is a no-op. The refresh
 * event is published (once) only when this run promoted ≥1 new review, so a repeat reconcile of the
 * same window triggers nothing. Reuses the shared {@link Cafe24ReviewPromoter} contract and the
 * existing {@link ReviewSegmentIngestedEvent} refresh seam — no new pipeline, no new LangGraph, no
 * migration, no reanalysis policy. Secret 비밀글 reviews cannot be a target (excluded before storage);
 * board 6/9 are a different source kind and are filtered out.
 *
 * <p><b>Sanitized.</b> Returns and logs counts only — never a review body/title/writer/article id.
 */
@Component
public class Cafe24ReviewPromotionReconciler {

    private static final Logger log = LoggerFactory.getLogger(Cafe24ReviewPromotionReconciler.class);
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final int PAGE = 500;

    private final Cafe24CommunityArticleRepository articles;
    private final Cafe24ReviewPromoter promoter;
    private final ApplicationEventPublisher events;

    public Cafe24ReviewPromotionReconciler(Cafe24CommunityArticleRepository articles,
                                           Cafe24ReviewPromoter promoter,
                                           ApplicationEventPublisher events) {
        this.articles = articles;
        this.promoter = promoter;
        this.events = events;
    }

    /** Sanitized outcome of a bounded reconcile — counts and a boolean only. */
    public record ReconcileResult(int eligible, int promoted, int alreadyPromoted,
                                  int skippedEmptyBody, int skippedInvalidIdentity,
                                  boolean refreshTriggered) {
    }

    /**
     * Promote every not-yet-promoted stored public board-4 REVIEW article for this account whose source
     * created date is within the inclusive KST window {@code [startKst, endKst]}. No Cafe24 API call.
     */
    @Transactional
    public ReconcileResult reconcile(UUID orgId, UUID sellerAccountId, LocalDate startKst,
                                     LocalDate endKst) {
        Instant from = startKst.atStartOfDay(KST).toInstant();
        Instant toExclusive = endKst.plusDays(1).atStartOfDay(KST).toInstant();

        int eligible = 0;
        int promoted = 0;
        int alreadyPromoted = 0;
        int skippedEmptyBody = 0;
        int skippedInvalidIdentity = 0;
        UUID promotedChannelId = null;

        int page = 0;
        while (true) {
            Page<Cafe24CommunityArticle> rows = articles.findInWindowFiltered(
                    orgId, sellerAccountId, CommunitySourceKind.REVIEW.name(),
                    null, null, null, from, toExclusive, PageRequest.of(page, PAGE));
            for (Cafe24CommunityArticle a : rows) {
                eligible++;
                Cafe24ReviewPromoter.Outcome outcome = promoter.promote(
                        orgId, a.getChannelId(), a.getSourceKind(), a.getBoardNo(), a.getArticleNo(),
                        a.getContent(), a.getRating(), a.getSourceCreatedAt());
                switch (outcome) {
                    case PROMOTED -> {
                        promoted++;
                        if (promotedChannelId == null) {
                            promotedChannelId = a.getChannelId();
                        }
                    }
                    case ALREADY_PRESENT -> alreadyPromoted++;
                    case SKIPPED_EMPTY_BODY -> skippedEmptyBody++;
                    case SKIPPED_INVALID_IDENTITY -> skippedInvalidIdentity++;
                    // The query already filters sourceKind = REVIEW, so SKIPPED_NOT_REVIEW never occurs.
                    case SKIPPED_NOT_REVIEW -> { }
                }
            }
            if (!rows.hasNext()) {
                break;
            }
            page++;
        }

        boolean refreshTriggered = promoted > 0;
        if (refreshTriggered) {
            events.publishEvent(new ReviewSegmentIngestedEvent(
                    orgId, promotedChannelId, LocalDate.now(ZoneOffset.UTC)));
            log.info("카페24 REVIEW 이슈메모리 소급 프로젝션: eligible={} promoted={} alreadyPromoted={} "
                            + "skippedEmptyBody={} skippedInvalidIdentity={}",
                    eligible, promoted, alreadyPromoted, skippedEmptyBody, skippedInvalidIdentity);
        }
        return new ReconcileResult(eligible, promoted, alreadyPromoted, skippedEmptyBody,
                skippedInvalidIdentity, refreshTriggered);
    }
}
