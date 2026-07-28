package com.sellerops.reviewissue;

import com.sellerops.common.SafePreviewResult;
import com.sellerops.common.VocPreviewSanitizer;
import com.sellerops.product.Product;
import com.sellerops.product.ProductRepository;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import com.sellerops.reviewissue.dto.IssueChangeView;
import com.sellerops.reviewissue.dto.IssueEvidenceView;
import com.sellerops.reviewissue.dto.IssueStateEventView;
import com.sellerops.reviewissue.dto.ReviewIssueDetailView;
import com.sellerops.reviewissue.dto.ReviewIssueView;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
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
     * Every non-dismissed issue, worst-first.
     *
     * <p>Ordering is severity, then whether anything fired, then recency — so a HIGH issue that is
     * quiet still outranks a LOW one that is surging. That is a deliberate choice: severity is a
     * property of what went wrong, and a rising count of minor friction should not displace a report
     * that customers are receiving broken product.
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
        views.sort(Comparator
                .comparingInt((ReviewIssueView v) -> IssueSeverity.valueOf(v.severity()).rank())
                .thenComparing(v -> v.change().kinds().isEmpty())
                .thenComparing(ReviewIssueView::lastEvidenceOn,
                        Comparator.nullsLast(Comparator.reverseOrder())));
        return List.copyOf(views);
    }

    @Transactional(readOnly = true)
    public ReviewIssueDetailView detail(UUID orgId, UUID issueId, LocalDate referenceDate) {
        ReviewIssue issue = issues.findById(issueId)
                .filter(i -> i.getOrgId().equals(orgId))
                // Same message whether it is missing or another org's, so an id cannot be probed.
                .orElseThrow(() -> new IllegalArgumentException("이슈를 찾을 수 없습니다."));

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
    static String quoteFor(Review review, int unitOrdinal) {
        if (review == null) {
            return null;
        }
        List<String> units = OpinionUnitSplitter.split(review.getBody());
        if (unitOrdinal < 0 || unitOrdinal >= units.size()) {
            return null;
        }
        SafePreviewResult preview = VocPreviewSanitizer.sanitize(units.get(unitOrdinal));
        return preview.text();
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
}
