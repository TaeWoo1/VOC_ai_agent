package com.sellerops.collect;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.review.channel.ChannelReviewAcquisitionService;
import com.sellerops.review.channel.dto.AgentReviewAcquisitionTargetRequest;
import com.sellerops.review.channel.dto.AgentReviewAcquisitionTargetView;
import jakarta.validation.Valid;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The Local Agent's acquisition route: it spends the {@code acquisitionRef} the seller's browser gave it
 * and learns which account's WING screen to read — mirror of {@link AgentReviewLocateController}. The ref
 * travels in the body (a single-use secret is not a path segment); the org comes from the JWT.
 */
@RestController
@RequestMapping("/api/agent")
public class AgentReviewAcquisitionController {

    private final ChannelReviewAcquisitionService service;

    public AgentReviewAcquisitionController(ChannelReviewAcquisitionService service) {
        this.service = service;
    }

    @PostMapping("/review-acquisition-targets")
    public AgentReviewAcquisitionTargetView resolve(@AuthenticationPrincipal AuthPrincipal principal,
                                                    @Valid @RequestBody AgentReviewAcquisitionTargetRequest request) {
        return service.resolve(principal.orgId(), request.acquisitionRef());
    }
}
