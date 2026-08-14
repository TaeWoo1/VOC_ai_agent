package com.sellerops.review.channel;

import com.sellerops.common.ApiException;
import com.sellerops.common.RedactedBody;
import com.sellerops.common.ReviewBodyFingerprint;
import com.sellerops.common.SafePreviewResult;
import com.sellerops.common.VocPreviewSanitizer;
import com.sellerops.product.Product;
import com.sellerops.product.ProductRepository;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import com.sellerops.review.channel.dto.ChannelReviewDetailView;
import com.sellerops.review.channel.dto.ChannelReviewItemView;
import com.sellerops.review.channel.dto.ChannelReviewPageView;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncJob;
import com.sellerops.sync.SyncJobRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;

/**
 * The seller's own record of what buyers wrote on a connected channel.
 *
 * <p><b>It is a record, not a work queue.</b> Every other review read in this codebase narrows to something
 * the operator must act on. Coupang gives sellers no way to answer a 상품평, so "needs a reply" is not a
 * subset that means anything here — and a list that showed only actionable reviews would show almost none of
 * the seller's VOC. The one ordering concession is {@code sort=lowest}, which puts the complaints first
 * without pretending they are tasks.
 *
 * <p><b>New is derived, never stored.</b> A review is new when it was written into the database at or after
 * the most recent review import for this account started. No read flag, no per-review state: the question a
 * seller asks after a sync is "what came in this time", and that has an answer already.
 *
 * <p><b>Coverage is carried, not implied.</b> The page reports whether the last import claimed to have
 * covered the list, because a list of reviews cannot say so itself — an acquisition that stopped early looks
 * exactly like a channel with fewer reviews.
 *
 * <p>All text leaves through {@link VocPreviewSanitizer}: a redacted one-line preview in the list, the
 * redacted full body in the detail. The fingerprint that {@code [쿠팡에서 보기]} matches on is computed from
 * the STORED body, so what the locate compares is what the collector will compute in the page.
 */
@Service
public class ChannelReviewService {

    /** What the list can be ordered by. Anything else is a 400 — never a silent fallback to the default. */
    static final String SORT_NEWEST = "newest";
    static final String SORT_LOWEST = "lowest";

    static final int MAX_PAGE_SIZE = 100;
    static final int DEFAULT_PAGE_SIZE = 20;

    private final ReviewRepository reviews;
    private final ProductRepository products;
    private final SellerAccountRepository accounts;
    private final SyncJobRepository syncJobs;

    public ChannelReviewService(ReviewRepository reviews, ProductRepository products,
                                SellerAccountRepository accounts, SyncJobRepository syncJobs) {
        this.reviews = reviews;
        this.products = products;
        this.accounts = accounts;
        this.syncJobs = syncJobs;
    }

    public ChannelReviewPageView list(UUID orgId, UUID accountId, String sort, int page, int size) {
        SellerAccount account = requireAccount(orgId, accountId);
        UUID channelId = account.getChannelId();
        Optional<SyncJob> lastImport = lastReviewImport(orgId, accountId);
        Instant newSince = lastImport.map(SyncJob::getStartedAt).orElse(null);

        Page<Review> found = reviews.findByOrgIdAndChannelId(orgId, channelId,
                PageRequest.of(Math.max(0, page), clampSize(size), sortOf(sort)));
        Map<UUID, Product> byProduct = productsOf(orgId, found.getContent());

        List<ChannelReviewItemView> items = found.getContent().stream()
                .map(r -> item(r, byProduct.get(r.getProductId()), newSince))
                .toList();

        long newCount = newSince == null ? 0
                : reviews.countByOrgIdAndChannelIdAndCreatedAtGreaterThanEqual(orgId, channelId, newSince);

        return new ChannelReviewPageView(found.getNumber(), found.getSize(), found.getTotalElements(),
                newCount,
                lastImport.map(SyncJob::getFinishedAt).orElse(null),
                lastImport.map(j -> "SUCCESS".equals(j.getStatus())).orElse(false),
                items);
    }

    /**
     * One review in full, with the target that finds it on the seller's own screen. Org-scoped at the query
     * boundary, then checked against the account's channel: a review id from another of the org's channels is
     * a wrong answer, not merely an odd one, because the locate target would send the agent looking for it on
     * a screen it was never written on.
     */
    public ChannelReviewDetailView detail(UUID orgId, UUID accountId, UUID reviewId) {
        SellerAccount account = requireAccount(orgId, accountId);
        Review review = reviews.findByIdAndOrgId(reviewId, orgId)
                .filter(r -> account.getChannelId().equals(r.getChannelId()))
                .orElseThrow(() -> ApiException.notFound("상품평을 찾을 수 없습니다."));

        Product product = review.getProductId() == null ? null
                : products.findAllByOrgIdAndIdIn(orgId, List.of(review.getProductId()))
                        .stream().findFirst().orElse(null);
        RedactedBody body = VocPreviewSanitizer.redactFullBody(review.getBody());
        Instant newSince = lastReviewImport(orgId, accountId).map(SyncJob::getStartedAt).orElse(null);

        return new ChannelReviewDetailView(
                review.getId(),
                writtenOn(review),
                review.getRating(),
                review.isNegative(),
                body.text(),
                body.redacted(),
                product == null ? null : product.getName(),
                review.getMediaCount(),
                isTextless(review),
                isNew(review, newSince),
                new ChannelReviewDetailView.LocateTarget(
                        product == null ? null : product.getSku(),
                        review.getSourceOptionId(),
                        writtenOn(review),
                        review.getRating(),
                        // From the STORED body, so the target and the live row are compared on one rule.
                        ReviewBodyFingerprint.of(review.getBody())));
    }

    private ChannelReviewItemView item(Review review, Product product, Instant newSince) {
        SafePreviewResult preview = VocPreviewSanitizer.sanitize(review.getBody());
        return new ChannelReviewItemView(
                review.getId(),
                writtenOn(review),
                review.getRating(),
                review.isNegative(),
                preview.text(),
                product == null ? null : product.getName(),
                product == null ? null : product.getSku(),
                review.getSourceOptionId(),
                review.getMediaCount(),
                isTextless(review),
                isNew(review, newSince));
    }

    private Map<UUID, Product> productsOf(UUID orgId, List<Review> page) {
        List<UUID> ids = page.stream().map(Review::getProductId).filter(java.util.Objects::nonNull).distinct().toList();
        if (ids.isEmpty()) {
            return Map.of();
        }
        return products.findAllByOrgIdAndIdIn(orgId, ids).stream()
                .collect(Collectors.toMap(Product::getId, Function.identity(), (a, b) -> a));
    }

    /** The most recent REVIEW collection for this account, whatever produced it. */
    private Optional<SyncJob> lastReviewImport(UUID orgId, UUID accountId) {
        return syncJobs.findFirstByOrgIdAndSellerAccountIdAndDataTypeOrderByCreatedAtDesc(orgId, accountId, "REVIEW");
    }

    /**
     * A review the buyer rated without writing. The channel's placeholder for that cell is never stored, so
     * a blank body means exactly this and nothing else — there is no case where a body went missing.
     */
    private boolean isTextless(Review review) {
        return review.getBody() == null || review.getBody().isBlank();
    }

    private boolean isNew(Review review, Instant newSince) {
        return newSince != null && review.getCreatedAt() != null && !review.getCreatedAt().isBefore(newSince);
    }

    /** Stored as UTC start-of-day for the calendar date the channel printed, so this reads it back unshifted. */
    private LocalDate writtenOn(Review review) {
        return review.getReceivedAt() == null ? null : review.getReceivedAt().atZone(ZoneOffset.UTC).toLocalDate();
    }

    /**
     * {@code newest} (default) or {@code lowest}. An unrecognised value is refused rather than quietly
     * ordered by the default: a seller who asked for the complaints first and silently got the newest first
     * would read the top of the list as their worst reviews.
     */
    private Sort sortOf(String sort) {
        String requested = sort == null || sort.isBlank() ? SORT_NEWEST : sort;
        if (SORT_NEWEST.equals(requested)) {
            return Sort.by(Sort.Order.desc("receivedAt"), Sort.Order.asc("id"));
        }
        if (SORT_LOWEST.equals(requested)) {
            return Sort.by(Sort.Order.asc("rating"), Sort.Order.desc("receivedAt"), Sort.Order.asc("id"));
        }
        throw ApiException.badRequest("정렬 방식을 알 수 없습니다. (newest / lowest)");
    }

    private int clampSize(int size) {
        return Math.max(1, Math.min(MAX_PAGE_SIZE, size <= 0 ? DEFAULT_PAGE_SIZE : size));
    }

    private SellerAccount requireAccount(UUID orgId, UUID accountId) {
        return accounts.findById(accountId)
                .filter(a -> orgId.equals(a.getOrgId()))
                .orElseThrow(() -> ApiException.notFound("판매 계정을 찾을 수 없습니다."));
    }
}
