package com.sellerops.reviewissue;

import com.sellerops.common.ApiException;
import com.sellerops.common.SafePreviewResult;
import com.sellerops.common.VocPreviewSanitizer;
import com.sellerops.product.Product;
import com.sellerops.product.ProductRepository;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import com.sellerops.reviewissue.dto.IssueChangeView;
import com.sellerops.reviewissue.dto.IssueContextView;
import com.sellerops.reviewissue.dto.IssueEvidenceSummaryView;
import com.sellerops.reviewissue.dto.IssueEvidenceView;
import com.sellerops.reviewissue.dto.IssueProductEvidenceView;
import com.sellerops.reviewissue.dto.IssueRatingDistributionView;
import com.sellerops.reviewissue.dto.IssueStateEventView;
import com.sellerops.reviewissue.dto.IssueTransitionView;
import com.sellerops.reviewissue.dto.ReviewIssueDetailView;
import com.sellerops.reviewissue.dto.ReviewIssueView;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Read side of the issue memory: issues with their judgements, and the evidence behind them.
 *
 * <p><b>Where customer text enters and leaves.</b> The evidence table stores none, so a quote is
 * produced here by re-splitting the review body with the same pure {@link OpinionUnitSplitter} that
 * produced the stored ordinal and passing that one clause through
 * {@link VocPreviewSanitizer#sanitize}. Two consequences worth stating: the list and detail surfaces
 * use the identical masking as every other VOC row, and a suppressed quote is {@code null} rather
 * than an empty string, so a client cannot render an empty speech bubble as if the customer said
 * nothing.
 */
@Service
public class ReviewIssueQueryService {

    private final ReviewIssueRepository issues;
    private final ReviewIssueEvidenceRepository evidence;
    private final ReviewIssueStateEventRepository stateEvents;
    private final ReviewIssueSnapshotService snapshots;
    private final ReviewRepository reviews;
    private final ProductRepository products;

    public ReviewIssueQueryService(ReviewIssueRepository issues,
                                   ReviewIssueEvidenceRepository evidence,
                                   ReviewIssueStateEventRepository stateEvents,
                                   ReviewIssueSnapshotService snapshots,
                                   ReviewRepository reviews,
                                   ProductRepository products) {
        this.issues = issues;
        this.evidence = evidence;
        this.stateEvents = stateEvents;
        this.snapshots = snapshots;
        this.reviews = reviews;
        this.products = products;
    }

    /**
     * Every non-dismissed issue that still has evidence, most-repeated first.
     *
     * <p>Ordering and the zero-evidence exclusion are both {@link IssueOrdering}'s, shared with the
     * product page so the two lists a person scans cannot disagree about which problem is the biggest.
     * The earlier severity-first rule and why it was reversed are recorded there.
     */
    @Transactional(readOnly = true)
    public List<ReviewIssueView> list(UUID orgId, LocalDate referenceDate) {
        return list(orgId, referenceDate, false);
    }

    /**
     * @param dismissed false for the working list, true for the 중요하지 않음 list. Two calls rather
     *     than one combined list: mixing them would put issues an operator has explicitly set aside
     *     back among the ones asking for attention.
     */
    @Transactional(readOnly = true)
    public List<ReviewIssueView> list(UUID orgId, LocalDate referenceDate, boolean dismissed) {
        List<ReviewIssue> rows = dismissed
                ? issues.findByOrgIdAndDismissedTrue(orgId)
                : issues.findByOrgIdAndDismissedFalse(orgId);
        List<ReviewIssueView> views = new ArrayList<>();
        for (ReviewIssue issue : rows) {
            views.add(view(orgId, issue, referenceDate));
        }
        views.sort(IssueOrdering.ACTIVE_FIRST);
        // The set-aside list keeps everything the operator put there — it is a record of decisions, so
        // a row losing its last evidence must not make the decision disappear too. The working list is
        // the one that must only hold live work.
        return dismissed ? List.copyOf(views)
                : views.stream().filter(IssueOrdering::hasLiveEvidence).toList();
    }

    @Transactional(readOnly = true)
    public ReviewIssueDetailView detail(UUID orgId, UUID issueId, LocalDate referenceDate) {
        ReviewIssue issue = requireIssue(orgId, issueId);

        List<ReviewIssueEvidence> rows =
                evidence.findByOrgIdAndIssueIdOrderByOccurredOnDesc(orgId, issueId);
        Map<UUID, Review> reviewsById = loadReviews(rows);
        Map<UUID, String> productNames = loadProductNames(rows.stream()
                .map(ReviewIssueEvidence::getProductId).filter(java.util.Objects::nonNull).toList());

        List<IssueEvidenceView> evidenceViews = new ArrayList<>(rows.size());
        for (ReviewIssueEvidence row : rows) {
            Review review = reviewsById.get(row.getReviewId());
            evidenceViews.add(new IssueEvidenceView(
                    row.getReviewId(),
                    row.getUnitOrdinal(),
                    row.getOccurredOn(),
                    row.getProductId(),
                    row.getProductId() == null ? null : productNames.get(row.getProductId()),
                    review == null ? null : review.getRating(),
                    quoteFor(review, row.getUnitOrdinal())));
        }

        List<IssueStateEventView> history =
                stateEvents.findByOrgIdAndIssueIdOrderByCreatedAtAsc(orgId, issueId).stream()
                        .map(ReviewIssueQueryService::historyView)
                        .toList();

        return new ReviewIssueDetailView(view(orgId, issue, referenceDate), List.copyOf(evidenceViews),
                history);
    }

    /**
     * One issue's current signal — severity, the change/trend judgement, concentration, and the
     * evidence span — as of {@code referenceDate}. Quote-free: {@link ReviewIssueView} is built from
     * closed-vocabulary labels and aggregate counts only. Backs {@code GET /{id}/trend}.
     */
    @Transactional(readOnly = true)
    public ReviewIssueView issueView(UUID orgId, UUID issueId, LocalDate referenceDate) {
        return view(orgId, requireIssue(orgId, issueId), referenceDate);
    }

    /**
     * One issue's identity and lifecycle history, note-free (see {@link IssueTransitionView}). Backs
     * {@code GET /{id}/context}. No evidence quotes are read, so no customer text is produced.
     */
    @Transactional(readOnly = true)
    public IssueContextView context(UUID orgId, UUID issueId, LocalDate referenceDate) {
        ReviewIssue issue = requireIssue(orgId, issueId);
        List<IssueTransitionView> history =
                stateEvents.findByOrgIdAndIssueIdOrderByCreatedAtAsc(orgId, issueId).stream()
                        .map(ReviewIssueQueryService::transitionView)
                        .toList();
        return new IssueContextView(view(orgId, issue, referenceDate), history);
    }

    /**
     * A quote-free roll-up of an issue's evidence: total, per-product split (attributed only,
     * largest first, each with ITS OWN span; unattributed reported separately), the rating
     * distribution, and the issue's span.
     *
     * <p>All-time, so it needs no reference date. Reviews are loaded to read their star rating only
     * — never a body — and the result carries no review id, no quote, and no buyer identity, so this
     * is the "sanitized evidence summary" an operations brief may hold. Counting rows by product and
     * rating is a presentation roll-up, not the issue judgement (severity/trend/concentration verdicts
     * stay in {@link IssueChangeRules}/{@link ReviewIssueSnapshotService}, reused via {@link #view}).
     */
    @Transactional(readOnly = true)
    public IssueEvidenceSummaryView evidenceSummary(UUID orgId, UUID issueId) {
        ReviewIssue issue = requireIssue(orgId, issueId);
        List<ReviewIssueEvidence> rows =
                evidence.findByOrgIdAndIssueIdOrderByOccurredOnDesc(orgId, issueId);
        Map<UUID, Review> reviewsById = loadReviews(rows);
        Map<UUID, String> productNames = loadProductNames(rows.stream()
                .map(ReviewIssueEvidence::getProductId).filter(java.util.Objects::nonNull).toList());

        // Per-product tally (insertion order preserved, then sorted largest-first) and per-rating
        // tally, both over the same evidence rows so they each sum to totalEvidence.
        //
        // The per-product SPAN is accumulated in the same pass and from the same rows, so a product's
        // first/last date can only ever be one of its own evidence dates. The issue's span
        // (issue.getFirstEvidenceOn()) is deliberately not consulted here: it is the union over every
        // product, and lending it to a row would let another product's recent review date this one.
        Map<UUID, Long> perProduct = new LinkedHashMap<>();
        Map<UUID, LocalDate> firstOn = new LinkedHashMap<>();
        Map<UUID, LocalDate> lastOn = new LinkedHashMap<>();
        long unattributed = 0L;
        long[] ratingBuckets = new long[6]; // index 1..5 = stars; index 0 = unrated
        for (ReviewIssueEvidence row : rows) {
            UUID productId = row.getProductId();
            if (productId == null) {
                unattributed++;
            } else {
                perProduct.merge(productId, 1L, Long::sum);
                LocalDate on = row.getOccurredOn();
                firstOn.merge(productId, on, (a, b) -> a.isBefore(b) ? a : b);
                lastOn.merge(productId, on, (a, b) -> a.isAfter(b) ? a : b);
            }
            Review review = reviewsById.get(row.getReviewId());
            Integer rating = review == null ? null : review.getRating();
            ratingBuckets[rating != null && rating >= 1 && rating <= 5 ? rating : 0]++;
        }

        // The denominator is read per product that actually carries evidence — bounded by the number
        // of products this one issue reaches (three on the largest issue measured), never by the
        // catalogue. It is the same count the product page and the Decision Workspace print, from the
        // same repository method, so the three surfaces cannot disagree about how many reviews a
        // product has.
        List<IssueProductEvidenceView> byProduct = perProduct.entrySet().stream()
                .map(e -> new IssueProductEvidenceView(e.getKey(), productNames.get(e.getKey()),
                        e.getValue(), reviews.countByOrgIdAndProductId(orgId, e.getKey()),
                        firstOn.get(e.getKey()), lastOn.get(e.getKey())))
                .sorted(Comparator.comparingLong(IssueProductEvidenceView::evidenceCount).reversed()
                        .thenComparing(v -> v.productId().toString()))
                .toList();

        IssueRatingDistributionView distribution = new IssueRatingDistributionView(
                ratingBuckets[1], ratingBuckets[2], ratingBuckets[3], ratingBuckets[4],
                ratingBuckets[5], ratingBuckets[0]);

        return new IssueEvidenceSummaryView(rows.size(), byProduct, unattributed, distribution,
                issue.getFirstEvidenceOn(), issue.getLastEvidenceOn());
    }

    /** Load an issue in this org, or fail with the id-non-probing message the mutation paths use. */
    private ReviewIssue requireIssue(UUID orgId, UUID issueId) {
        return issues.findById(issueId)
                .filter(i -> i.getOrgId().equals(orgId))
                // Same message whether it is missing or another org's, so an id cannot be probed.
                // <b>404, not 500.</b> Both this and the lifecycle service used to raise
                // IllegalArgumentException, which no handler maps — so a stale bookmark to a deleted
                // issue, and a cross-org id, both came back as a server error. Measured against a
                // second org's token on 2026-09-13: GET /api/review-issues/{id} answered 500 while
                // every neighbouring read answered 404. Nothing leaked either way; what it cost was a
                // seller shown a crash for a page that simply is not theirs, and a pilot operator
                // watching ERROR counts shown an incident that never happened.
                .orElseThrow(() -> ApiException.notFound("이슈를 찾을 수 없습니다."));
    }

    private ReviewIssueView view(UUID orgId, ReviewIssue issue, LocalDate referenceDate) {
        IssueChangeRules.Assessment assessment = IssueChangeRules.assess(
                snapshots.snapshot(orgId, issue.getId(), referenceDate));
        UUID dominantProductId = snapshots.dominantProductId(orgId, issue.getId(), referenceDate);
        long total = evidence.countByOrgIdAndIssueId(orgId, issue.getId());

        return new ReviewIssueView(
                issue.getId(),
                issue.getTitle(),
                issue.getAspect(),
                issue.getProblem(),
                issue.getSeverity().name(),
                issue.getLifecycleState().name(),
                issue.getLifecycleState().labelKo(),
                total,
                issue.getFirstEvidenceOn(),
                issue.getLastEvidenceOn(),
                dominantProductId,
                dominantProductId == null ? null
                        : products.findById(dominantProductId).map(Product::getName).orElse(null),
                issue.isDismissed(),
                issue.getExtractorKind(),
                changeView(assessment));
    }

    private static IssueChangeView changeView(IssueChangeRules.Assessment assessment) {
        return new IssueChangeView(
                assessment.kinds().stream().map(Enum::name).toList(),
                assessment.kinds().stream().map(IssueChangeKind::labelKo).toList(),
                assessment.highSurge(),
                assessment.surgeWindowCount(),
                assessment.surgeBaselineWeekly());
    }

    /**
     * Re-derive one opinion unit and mask it. Returns null when the stored ordinal no longer resolves
     * — which can only happen if the review body changed after extraction — rather than falling back
     * to the whole body. Silently widening a quote to the entire review would show text the issue was
     * never evidence for.
     */
    private static String quoteFor(Review review, int unitOrdinal) {
        return IssueEvidenceQuote.of(review, unitOrdinal);
    }

    private Map<UUID, Review> loadReviews(List<ReviewIssueEvidence> rows) {
        List<UUID> ids = rows.stream().map(ReviewIssueEvidence::getReviewId).distinct().toList();
        Map<UUID, Review> byId = new HashMap<>();
        for (Review review : reviews.findAllById(ids)) {
            byId.put(review.getId(), review);
        }
        return byId;
    }

    private Map<UUID, String> loadProductNames(List<UUID> productIds) {
        Map<UUID, String> byId = new HashMap<>();
        for (Product product : products.findAllById(productIds.stream().distinct().toList())) {
            byId.put(product.getId(), product.getName());
        }
        return byId;
    }

    private static IssueStateEventView historyView(ReviewIssueStateEvent event) {
        return new IssueStateEventView(
                event.getFromState() == null ? null : event.getFromState().name(),
                event.getToState().name(),
                event.getToState().labelKo(),
                event.getActor().name(),
                event.getReason().name(),
                event.getNote(),
                event.getCreatedAt());
    }

    /** Lifecycle transition without the operator's free-text note — see {@link IssueTransitionView}. */
    private static IssueTransitionView transitionView(ReviewIssueStateEvent event) {
        return new IssueTransitionView(
                event.getFromState() == null ? null : event.getFromState().name(),
                event.getToState().name(),
                event.getToState().labelKo(),
                event.getActor().name(),
                event.getReason().name(),
                event.getCreatedAt());
    }
}
