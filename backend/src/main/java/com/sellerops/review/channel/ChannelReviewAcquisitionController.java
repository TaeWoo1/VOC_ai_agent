package com.sellerops.review.channel;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.review.channel.dto.ChannelReviewAcquisitionRunResponse;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The seller starts a Coupang review read from a conversation: mint the single-use
 * {@code acquisitionRef} their browser passes into the Action Window {@code START_RUN}. A POST because
 * it mints state; the marketplace is not touched by this call.
 */
@RestController
@RequestMapping("/api/seller-accounts/{accountId}")
public class ChannelReviewAcquisitionController {

    private final ChannelReviewAcquisitionService service;

    public ChannelReviewAcquisitionController(ChannelReviewAcquisitionService service) {
        this.service = service;
    }

    @PostMapping("/review-acquisition-runs")
    public ChannelReviewAcquisitionRunResponse start(@AuthenticationPrincipal AuthPrincipal principal,
                                                     @PathVariable UUID accountId) {
        return service.mint(principal.orgId(), accountId, principal.userId());
    }
}
