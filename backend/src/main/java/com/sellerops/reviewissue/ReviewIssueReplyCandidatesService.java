package com.sellerops.reviewissue;

import com.sellerops.attention.VocItemRef;
import com.sellerops.common.ApiException;
import com.sellerops.product.OperatorProductName;
import com.sellerops.product.Product;
import com.sellerops.product.ProductRepository;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewReplyState;
import com.sellerops.review.ReviewRepository;
import com.sellerops.reviewissue.dto.ReviewIssueReplyCandidateView;
import com.sellerops.reviewissue.dto.ReviewIssueReplyCandidatesView;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The bridge from the org-global issue surface to the account-scoped reply stack: an issue's evidence
 * reviews, resolved to the {@code actionRef} + {@code accountId} the existing reply flow needs, with an
 * honest {@code selectable} flag that excludes already-answered reviews from selection and execution.
 *
 * <p><b>Reuse-first.</b> It resolves the account exactly as the worklist does
 * ({@code SellerAccountRepository}), addresses a review exactly as the attention surface does
 * ({@link VocItemRef#forReview}), and derives "already reported" from the SAME
 * {@code REPORTED_SUBMISSION_PREDICATE} the worklist count and the guided-run 409 use — so there is
 * one definition of "answered", never a second that could drift.
 *
 * <p><b>Fail closed on ambiguity.</b> {@code reviews} carries no seller account, so when an org holds
 * more than one account on a review's channel the account cannot be attributed; that candidate is
 * returned with a null {@code accountId}, {@code accountAmbiguous = true}, and {@code selectable =
 * false}, never auto-picked.
 *
 * <p><b>DRAFT honesty carried through.</b> The response labels the signal with its {@code extractorKind}
 * and the {@code thresholds} contract version, so the surface can present the issue as an UNMEASURED
 * candidate rather than a confirmed problem ({@code contracts/review-issue/v1/THRESHOLDS.md}).
 */
@Service
public class ReviewIssueReplyCandidatesService {

    private final ReviewIssueRepository issues;
    private final ReviewIssueEvidenceRepository evidence;
    private final ReviewRepository reviews;
    private final ProductRepository products;
    private final SellerAccountRepository sellerAccounts;

    public ReviewIssueReplyCandidatesService(ReviewIssueRepository issues,
                                             ReviewIssueEvidenceRepository evidence,
                                             ReviewRepository reviews,
                                             ProductRepository products,
                                             SellerAccountRepository sellerAccounts) {
        this.issues = issues;
        this.evidence = evidence;
        this.reviews = reviews;
        this.products = products;
        this.sellerAccounts = sellerAccounts;
    }

    @Transactional(readOnly = true)
    public ReviewIssueReplyCandidatesView candidates(UUID orgId, UUID issueId) {
        ReviewIssue issue = issues.findById(issueId)
                .filter(i -> i.getOrgId().equals(orgId))
                // Same message whether it is missing or another org's, so an id cannot be probed.
                .orElseThrow(() -> ApiException.notFound("이슈를 찾을 수 없습니다."));

        List<ReviewIssueEvidence> rows =
                evidence.findByOrgIdAndIssueIdOrderByOccurredOnDesc(orgId, issueId);

        // One candidate per distinct review, keeping the newest evidence row (rows are occurredOn desc)
        // as the representative — its ordinal is the quote we show as "포함 이유".
        Map<UUID, ReviewIssueEvidence> byReview = new LinkedHashMap<>();
        for (ReviewIssueEvidence row : rows) {
            byReview.putIfAbsent(row.getReviewId(), row);
        }
        if (byReview.isEmpty()) {
            return new ReviewIssueReplyCandidatesView(issueId, issue.getExtractorKind(),
                    ReviewIssueThresholds.CONTRACT_VERSION, 0, List.of());
        }

        Map<UUID, Review> reviewsById = new HashMap<>();
        for (Review review : reviews.findAllById(byReview.keySet())) {
            // Org guard: findAllById is not org-scoped; a cross-org id must not leak into candidates.
            if (review.getOrgId().equals(orgId)) {
                reviewsById.put(review.getId(), review);
            }
        }
        Set<UUID> reportedSubmitted = new HashSet<>(
                reviews.findReportedSubmittedReviewIds(orgId, reviewsById.keySet()));
        Map<UUID, String> productNames = loadProductNames(orgId, byReview.values());

        List<ReviewIssueReplyCandidateView> candidates = new ArrayList<>(byReview.size());
        Map<UUID, AccountResolution> accountByChannel = new HashMap<>();
        int selectable = 0;
        for (Map.Entry<UUID, ReviewIssueEvidence> entry : byReview.entrySet()) {
            Review review = reviewsById.get(entry.getKey());
            if (review == null) {
                // Evidence points at a review no longer resolvable in this org — omit it rather than
                // surface a candidate that cannot be acted on.
                continue;
            }
            ReviewIssueEvidence row = entry.getValue();
            AccountResolution account = accountByChannel.computeIfAbsent(
                    review.getChannelId(), ch -> resolveAccount(orgId, ch));

            boolean channelAnswered = review.getReplyState() == ReviewReplyState.ANSWERED;
            boolean reported = reportedSubmitted.contains(review.getId());
            boolean isSelectable = !channelAnswered && !reported && account.accountId() != null;
            if (isSelectable) {
                selectable++;
            }
            candidates.add(new ReviewIssueReplyCandidateView(
                    review.getId(),
                    VocItemRef.forReview(review.getId()),
                    row.getUnitOrdinal(),
                    ReviewIssueQueryService.quoteFor(review, row.getUnitOrdinal()),
                    review.getRating(),
                    row.getProductId() == null ? null : productNames.get(row.getProductId()),
                    row.getOccurredOn(),
                    review.getReplyState().name(),
                    reported,
                    isSelectable,
                    account.accountId(),
                    account.ambiguous()));
        }
        return new ReviewIssueReplyCandidatesView(issueId, issue.getExtractorKind(),
                ReviewIssueThresholds.CONTRACT_VERSION, selectable, List.copyOf(candidates));
    }

    /**
     * The account to scope a reply against for this channel, or a fail-closed ambiguity. Counting —
     * rather than {@link SellerAccountRepository#findByOrgIdAndChannelId}, which throws on a non-unique
     * result — lets more-than-one fail closed instead of erroring, exactly like the attention source.
     */
    private AccountResolution resolveAccount(UUID orgId, UUID channelId) {
        if (channelId == null) {
            return new AccountResolution(null, false);
        }
        long count = sellerAccounts.countByOrgIdAndChannelId(orgId, channelId);
        if (count != 1) {
            // 0 → nothing to reply through; >1 → cannot attribute (reviews carry no account). Both
            // are non-selectable; only >1 is the "ambiguous, choose explicitly" case.
            return new AccountResolution(null, count > 1);
        }
        return sellerAccounts.findByOrgIdAndChannelId(orgId, channelId)
                .map(SellerAccount::getId)
                .map(id -> new AccountResolution(id, false))
                .orElse(new AccountResolution(null, false));
    }

    private Map<UUID, String> loadProductNames(UUID orgId, java.util.Collection<ReviewIssueEvidence> rows) {
        Set<UUID> ids = new HashSet<>();
        for (ReviewIssueEvidence row : rows) {
            if (row.getProductId() != null) {
                ids.add(row.getProductId());
            }
        }
        Map<UUID, String> byId = new HashMap<>();
        if (ids.isEmpty()) {
            return byId;
        }
        for (Product product : products.findAllByOrgIdAndIdIn(orgId, ids)) {
            byId.put(product.getId(), OperatorProductName.displayNameOrNull(product));
        }
        return byId;
    }

    private record AccountResolution(UUID accountId, boolean ambiguous) {
    }
}
