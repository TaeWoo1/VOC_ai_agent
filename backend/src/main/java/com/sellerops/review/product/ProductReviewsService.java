package com.sellerops.review.product;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.ApiException;
import com.sellerops.identity.ExecutableIdentity;
import com.sellerops.identity.ExecutableIdentityResolver;
import com.sellerops.product.ProductQueryService;
import com.sellerops.product.dto.ProductSummaryView;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import com.sellerops.review.product.dto.ProductReviewPageView;
import com.sellerops.review.recent.ReviewRows;
import com.sellerops.review.recent.dto.RecentReviewItemView;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * READ: one product's reviews, newest first — the destination behind the 상품 screen's 리뷰 figure
 * (Product Operations Continuity v1 §1).
 *
 * <p><b>Its predicate is the figure's predicate.</b> {@code total} comes from the very count
 * {@code ProductSignalsService} prints ({@code countByOrgIdAndProductId}) and the rows come from the
 * statement written next to it ({@code findByOrgIdAndProductId}); neither narrows to a channel set, a
 * window, or a rating. This is not a stylistic preference — the org-wide window read
 * ({@code RecentReviewService}) is scoped to {@code ProductChannels.VISIBLE_CODES}, and on this
 * repository's own demo data eight products carry reviews outside that set, so a door wired to it would
 * have opened an empty list under a figure of 2.
 *
 * <p><b>It is the record, not the queue.</b> Ordering is arrival, not attention: 「이 상품의 리뷰」 is a
 * question about what buyers wrote, and the reply work standing on those reviews is answered by the
 * reply-work read that already owns it. Nothing here is a verdict, and nothing is hidden — a filter the
 * seller never set must not decide what their own record contains.
 *
 * <p>Org-scoped from the principal; another org's product id is not a probe, because the org clause makes
 * it simply match nothing. Contacts no channel and moves no state.
 */
@Service
public class ProductReviewsService {

    static final int DEFAULT_SIZE = 20;
    static final int MAX_SIZE = 50;

    private final ReviewRepository reviews;
    private final ProductQueryService products;
    private final ChannelRepository channels;
    private final SellerAccountRepository accounts;
    private final ExecutableIdentityResolver identity;

    public ProductReviewsService(ReviewRepository reviews, ProductQueryService products,
                                 ChannelRepository channels, SellerAccountRepository accounts,
                                 ExecutableIdentityResolver identity) {
        this.reviews = reviews;
        this.products = products;
        this.channels = channels;
        this.accounts = accounts;
        this.identity = identity;
    }

    @Transactional(readOnly = true)
    public ProductReviewPageView page(UUID orgId, UUID productId, Integer page, Integer size) {
        ProductSummaryView product = products.byId(orgId, productId)
                // The same message whether it is missing or another org's, so an id cannot be probed —
                // the rule ProductSignalsService already sets for this exact product read.
                .orElseThrow(() -> ApiException.notFound("상품을 찾을 수 없습니다."));
        int pageIndex = page == null || page < 0 ? 0 : page;
        int pageSize = size == null || size <= 0 ? DEFAULT_SIZE : Math.min(MAX_SIZE, size);

        long total = reviews.countByOrgIdAndProductId(orgId, productId);
        List<Review> rows = reviews.findByOrgIdAndProductId(orgId, productId,
                PageRequest.of(pageIndex, pageSize,
                        Sort.by(Sort.Order.desc("receivedAt"), Sort.Order.desc("id"))));

        Map<UUID, Channel> channelById = new HashMap<>();
        for (Channel ch : channels.findAllById(
                rows.stream().map(Review::getChannelId).filter(Objects::nonNull).distinct().toList())) {
            channelById.put(ch.getId(), ch);
        }
        Map<UUID, SellerAccount> accountByChannel = new HashMap<>();
        for (UUID channelId : channelById.keySet()) {
            accounts.findByOrgIdAndChannelId(orgId, channelId).ifPresent(a -> accountByChannel.put(channelId, a));
        }
        Map<UUID, ExecutableIdentity> identities = identity.forReviews(orgId, rows);

        List<RecentReviewItemView> items = rows.stream()
                .map(r -> ReviewRows.row(r, channelById.get(r.getChannelId()),
                        accountByChannel.get(r.getChannelId()), product.name(),
                        identities.getOrDefault(r.getId(), ExecutableIdentity.NONE)))
                .toList();
        return new ProductReviewPageView(productId, product.name(), total, pageIndex, pageSize, items);
    }
}
