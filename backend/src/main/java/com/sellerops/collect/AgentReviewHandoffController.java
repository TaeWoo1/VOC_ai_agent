package com.sellerops.collect;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.collect.dto.AgentReviewAcquisitionFailureRequest;
import com.sellerops.collect.dto.AgentReviewAcquisitionFailureResultView;
import com.sellerops.collect.dto.AgentReviewHandoffRequest;
import com.sellerops.collect.dto.AgentReviewHandoffResultView;
import jakarta.validation.Valid;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The Local Agent's review route: the 상품평 it read off the seller's own WING screen, under that seller's
 * explicit connection.
 *
 * <p>Its own route rather than a variant of {@code /api/uploads}, for the reason the credential handoff is its
 * own: this takes the opaque account slot the Action Window wire carries and resolves it server-side, where the
 * upload path takes a file and a channel id. Same ingestion spine, same dedup, one binding apart.
 *
 * <p>The org comes from the JWT principal and never from the body, so the surface is tenant-isolated by
 * construction. The response carries counts — never a review body, a product id, or a stored row.
 */
@RestController
@RequestMapping("/api/agent")
public class AgentReviewHandoffController {

    private final AgentReviewHandoffService service;

    public AgentReviewHandoffController(AgentReviewHandoffService service) {
        this.service = service;
    }

    @PostMapping("/review-handoff")
    public AgentReviewHandoffResultView handOff(@AuthenticationPrincipal AuthPrincipal principal,
                                                @Valid @RequestBody AgentReviewHandoffRequest request) {
        return service.handOff(principal.orgId(), request);
    }

    /**
     * The same lane's other ending: a read that stored nothing, so that it leaves a row the seller can find
     * after the window has closed.
     *
     * <p>A sibling route rather than an empty handoff, because an empty handoff already means something else —
     * a walk that read a page and found nothing new — and a route that has to be told apart by the emptiness of
     * its payload is a route that will eventually be told apart wrongly.
     */
    @PostMapping("/review-handoff/failure")
    public AgentReviewAcquisitionFailureResultView recordFailure(
            @AuthenticationPrincipal AuthPrincipal principal,
            @Valid @RequestBody AgentReviewAcquisitionFailureRequest request) {
        return service.recordFailure(principal.orgId(), request);
    }
}
