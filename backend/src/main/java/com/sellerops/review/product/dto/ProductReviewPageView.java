package com.sellerops.review.product.dto;

import com.sellerops.review.recent.dto.RecentReviewItemView;
import java.util.List;
import java.util.UUID;

/**
 * One page of ONE product's reviews.
 *
 * <p>{@code total} is the whole record for this product, not the page — and it is the number the 상품
 * screen prints on its 리뷰 tile, read through the same predicate. That is the entire point of this view:
 * a figure a seller can press and a list it opens that disagree about which rows they mean is worse than
 * no door at all.
 *
 * <p>Rows are the same {@link RecentReviewItemView} the Agent's window read returns, from the same
 * mapping, so a review reads identically in the conversation and on the screen.
 */
public record ProductReviewPageView(UUID productId, String productName, long total, int page, int size,
                                    List<RecentReviewItemView> items) {
}
