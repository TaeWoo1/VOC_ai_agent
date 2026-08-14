package com.sellerops.review.channel;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.review.channel.dto.ChannelReviewDetailView;
import com.sellerops.review.channel.dto.ChannelReviewPageView;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The channel review record for one connected account — list and detail.
 *
 * <p>Two GETs and nothing else. There is no reply endpoint here, and its absence is the design: Coupang gives
 * sellers no way to answer a 상품평, so a draft or submit route would be an affordance for a capability the
 * channel does not have. The reply surfaces that exist elsewhere are bound to channels that can actually post.
 *
 * <p>{@code orgId} always comes from the authenticated principal, never the client, like every sibling read.
 */
@RestController
@RequestMapping("/api/seller-accounts/{accountId}/channel-reviews")
public class ChannelReviewController {

    private final ChannelReviewService service;

    public ChannelReviewController(ChannelReviewService service) {
        this.service = service;
    }

    /** One page of this account's reviews. {@code sort} is {@code newest} (default) or {@code lowest}. */
    @GetMapping
    public ChannelReviewPageView list(@AuthenticationPrincipal AuthPrincipal principal,
                                      @PathVariable UUID accountId,
                                      @RequestParam(required = false) String sort,
                                      @RequestParam(defaultValue = "0") int page,
                                      @RequestParam(defaultValue = "20") int size) {
        return service.list(principal.orgId(), accountId, sort, page, size);
    }

    /** One review in full, with the locate target `[쿠팡에서 보기]` re-finds it on the seller's screen by. */
    @GetMapping("/{reviewId}")
    public ChannelReviewDetailView detail(@AuthenticationPrincipal AuthPrincipal principal,
                                          @PathVariable UUID accountId,
                                          @PathVariable UUID reviewId) {
        return service.detail(principal.orgId(), accountId, reviewId);
    }
}
