package com.sellerops.review.channel;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.review.channel.dto.ChannelReviewDetailView;
import com.sellerops.review.channel.dto.ChannelReviewLocateRunResponse;
import com.sellerops.review.channel.dto.ChannelReviewPageView;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The channel review record for one connected account — list, detail, and the one thing a seller can ask
 * SellerOps to DO with a 상품평: show it to them on Coupang's own screen.
 *
 * <p>There is still no reply endpoint here, and its absence is the design: Coupang gives sellers no way to
 * answer a 상품평, so a draft or submit route would be an affordance for a capability the channel does not
 * have. The reply surfaces that exist elsewhere are bound to channels that can actually post.
 *
 * <p>The locate route mints a binding; it opens nothing and reads nothing. What acts on it is the seller's
 * own Local Agent, which resolves the ref over its own session and then only reads and rings.
 *
 * <p>{@code orgId} always comes from the authenticated principal, never the client, like every sibling read.
 */
@RestController
@RequestMapping("/api/seller-accounts/{accountId}/channel-reviews")
public class ChannelReviewController {

    private final ChannelReviewService service;
    private final ChannelReviewLocateService locates;

    public ChannelReviewController(ChannelReviewService service, ChannelReviewLocateService locates) {
        this.service = service;
        this.locates = locates;
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

    /**
     * The seller pressed {@code [쿠팡에서 보기]}: mint the single-use {@code locateRef} their browser passes
     * into the Action Window {@code START_RUN}.
     *
     * <p>A POST because it mints state, not because anything is submitted anywhere — the marketplace is not
     * touched by this call, or by the run it starts.
     */
    @PostMapping("/{reviewId}/locate-runs")
    public ChannelReviewLocateRunResponse startLocateRun(@AuthenticationPrincipal AuthPrincipal principal,
                                                         @PathVariable UUID accountId,
                                                         @PathVariable UUID reviewId) {
        return locates.mint(principal.orgId(), accountId, reviewId, principal.userId());
    }
}
