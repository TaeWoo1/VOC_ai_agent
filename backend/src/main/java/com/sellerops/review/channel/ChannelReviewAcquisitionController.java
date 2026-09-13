package com.sellerops.review.channel;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.review.channel.dto.ChannelReviewAcquisitionReadinessView;
import com.sellerops.review.channel.dto.ChannelReviewAcquisitionRunResponse;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The seller starts a Coupang review read: mint the single-use {@code acquisitionRef} their browser
 * passes into the Action Window {@code START_RUN}. A POST because it mints state; the marketplace is
 * not touched by this call.
 *
 * <p>The GET beside it answers the same three preconditions without minting, so a screen can draw the
 * 지금 동기화 it can honour and say what is missing when it cannot. Neither call reaches a marketplace,
 * and neither can say whether the seller is logged in — that is the run's to discover and to fail
 * closed on.
 */
@RestController
@RequestMapping("/api/seller-accounts/{accountId}")
public class ChannelReviewAcquisitionController {

    private final ChannelReviewAcquisitionService service;

    public ChannelReviewAcquisitionController(ChannelReviewAcquisitionService service) {
        this.service = service;
    }

    @GetMapping("/review-acquisition-readiness")
    public ChannelReviewAcquisitionReadinessView readiness(@AuthenticationPrincipal AuthPrincipal principal,
                                                           @PathVariable UUID accountId) {
        return service.readiness(principal.orgId(), accountId);
    }

    @PostMapping("/review-acquisition-runs")
    public ChannelReviewAcquisitionRunResponse start(@AuthenticationPrincipal AuthPrincipal principal,
                                                     @PathVariable UUID accountId) {
        return service.mint(principal.orgId(), accountId, principal.userId());
    }
}
