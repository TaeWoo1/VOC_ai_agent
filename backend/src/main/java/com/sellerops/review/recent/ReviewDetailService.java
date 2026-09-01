package com.sellerops.review.recent;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.ApiException;
import com.sellerops.common.MarkupText;
import com.sellerops.common.RedactedBody;
import com.sellerops.common.VocPreviewSanitizer;
import com.sellerops.identity.ExecutableIdentity;
import com.sellerops.identity.ExecutableIdentityResolver;
import com.sellerops.product.Product;
import com.sellerops.product.ProductRepository;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import com.sellerops.review.recent.dto.ReviewDetailView;
import com.sellerops.review.triage.ReviewTriageRules;
import com.sellerops.reviewissue.ReviewIssue;
import com.sellerops.reviewissue.ReviewIssueEvidence;
import com.sellerops.reviewissue.ReviewIssueEvidenceRepository;
import com.sellerops.reviewissue.ReviewIssueRepository;
import com.sellerops.selleraccount.SellerAccount;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * ONE review, by id, org-scoped — the exact READ behind the conversation's review anchor.
 *
 * <p><b>Bounded by construction.</b> One review row, one product row, one channel row, one account row,
 * and this review's own issue-evidence links (capped). No window, no scan, no channel contact: it is the
 * single-object read this runtime did not have, and nothing about it can grow with the seller's data.
 *
 * <p><b>An id from outside is not a fact.</b> The row is fetched with the caller's org and a miss is a
 * 404 — a review of another org is indistinguishable from one that does not exist, which is the only
 * answer this service is entitled to give.
 */
@Service
public class ReviewDetailService {

    /** How many repeated problems one review may be shown as evidence for. A review is not a report. */
    static final int MAX_ISSUES = 5;

    private final ReviewRepository reviews;
    private final ProductRepository products;
    private final ChannelRepository channels;
    private final com.sellerops.selleraccount.SellerAccountRepository accounts;
    private final ReviewIssueEvidenceRepository issueEvidence;
    private final ReviewIssueRepository issues;
    private final ExecutableIdentityResolver identity;

    public ReviewDetailService(ReviewRepository reviews, ProductRepository products, ChannelRepository channels,
                               com.sellerops.selleraccount.SellerAccountRepository accounts,
                               ReviewIssueEvidenceRepository issueEvidence, ReviewIssueRepository issues,
                               ExecutableIdentityResolver identity) {
        this.reviews = reviews;
        this.products = products;
        this.channels = channels;
        this.accounts = accounts;
        this.issueEvidence = issueEvidence;
        this.issues = issues;
        this.identity = identity;
    }

    @Transactional(readOnly = true)
    public ReviewDetailView detail(UUID orgId, UUID reviewId) {
        Review review = reviews.findByIdAndOrgId(reviewId, orgId)
                .orElseThrow(() -> ApiException.notFound("리뷰를 찾을 수 없습니다."));
        Channel channel = review.getChannelId() == null ? null : channels.findById(review.getChannelId()).orElse(null);
        SellerAccount account = channel == null ? null
                : accounts.findByOrgIdAndChannelId(orgId, channel.getId()).orElse(null);
        Product product = review.getProductId() == null ? null
                : products.findAllByOrgIdAndIdIn(orgId, List.of(review.getProductId())).stream().findFirst().orElse(null);
        // The whole sentence, with volatile PII-shaped spans tokenized — the seller is reading what a
        // customer wrote, not recognising a row (`RedactedBody` explains why this is not the 60-char preview).
        RedactedBody body = VocPreviewSanitizer.redactFullBody(MarkupText.toPlainText(review.getBody()));
        ExecutableIdentity executable = identity.forReviews(orgId, List.of(review))
                .getOrDefault(review.getId(), ExecutableIdentity.NONE);
        return new ReviewDetailView(
                review.getId(),
                account == null ? null : account.getId(),
                channel == null ? null : channel.getCode(),
                channel == null ? null : channel.getNameKo(),
                review.getReceivedAt() == null ? null : review.getReceivedAt().atZone(ZoneOffset.UTC).toLocalDate(),
                review.getRating(),
                review.isNegative(),
                body.text(),
                body.redacted(),
                review.getProductId(),
                product == null ? null : product.getName(),
                review.getReplyState() == null ? null : review.getReplyState().name(),
                executable.name(),
                ReviewTriageRules.tier(review.getRating(), review.getBody()).name(),
                issuesOf(orgId, review.getId()));
    }

    /**
     * The repeated problems this review is evidence for.
     *
     * <p>The link rows are this review's own; the titles come from the issues those rows name, fetched
     * org-scoped. A dismissed issue is still a true statement about why the review was recorded, so it is
     * kept — what would be dishonest is inventing an attribution the extractor never made.
     */
    private List<ReviewDetailView.ReviewIssueRefView> issuesOf(UUID orgId, UUID reviewId) {
        List<ReviewIssueEvidence> links = issueEvidence.findByOrgIdAndReviewId(orgId, reviewId);
        if (links.isEmpty()) {
            return List.of();
        }
        // One row per issue: a review with two opinion units on the same problem is that problem once.
        Map<UUID, ReviewIssueEvidence> byIssue = new LinkedHashMap<>();
        for (ReviewIssueEvidence link : links) {
            byIssue.putIfAbsent(link.getIssueId(), link);
        }
        Map<UUID, ReviewIssue> found = issues.findByOrgIdAndIdIn(orgId, byIssue.keySet()).stream()
                .collect(Collectors.toMap(ReviewIssue::getId, Function.identity(), (a, b) -> a));
        return byIssue.values().stream()
                .map(link -> Optional.ofNullable(found.get(link.getIssueId()))
                        .map(issue -> new ReviewDetailView.ReviewIssueRefView(
                                issue.getId(), issue.getTitle(),
                                issue.getSeverity() == null ? null : issue.getSeverity().name(),
                                link.getOccurredOn()))
                        .orElse(null))
                .filter(java.util.Objects::nonNull)
                .limit(MAX_ISSUES)
                .toList();
    }
}
