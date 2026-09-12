package com.sellerops.review.decision;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.review.decision.dto.ReviewDecisionContextView;
import com.sellerops.review.decision.dto.ReviewDecisionLogEntryView;
import java.util.List;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The two reads behind the Review Decision Workspace — both GET, both org-scoped, both bounded.
 *
 * <p><b>There is no write here on purpose.</b> Everything the workspace records goes through a route
 * that already exists and already owns its approval boundary and its audit trail: the response
 * decision, the seller's own tier, the explicit act, the reply draft, the approval, the outcome. A
 * write on this controller would be a second door into a decision whose first door already carries
 * the locking, the idempotency key and the trail — and the two doors would eventually disagree.
 *
 * <p>Mounted beside {@code ChannelReviewController} on the same account-scoped path rather than
 * inside it, so the record's endpoints and the workspace's stay separable: one is what a channel
 * holds, the other is what a person concluded.
 */
@RestController
@RequestMapping("/api/seller-accounts/{accountId}/channel-reviews/{reviewId}")
public class ReviewDecisionWorkspaceController {

    private final ReviewDecisionWorkspaceService service;

    public ReviewDecisionWorkspaceController(ReviewDecisionWorkspaceService service) {
        this.service = service;
    }

    /** What stands behind this review: repeated problems, what else said the same, what is written down. */
    @GetMapping("/decision-context")
    public ReviewDecisionContextView context(@AuthenticationPrincipal AuthPrincipal principal,
                                             @PathVariable UUID accountId,
                                             @PathVariable UUID reviewId) {
        return service.context(principal.orgId(), accountId, reviewId);
    }

    /** What has already been decided about this review, newest first. */
    @GetMapping("/decision-log")
    public List<ReviewDecisionLogEntryView> log(@AuthenticationPrincipal AuthPrincipal principal,
                                                @PathVariable UUID accountId,
                                                @PathVariable UUID reviewId) {
        return service.log(principal.orgId(), accountId, reviewId);
    }
}
