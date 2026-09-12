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
 * <p><b>Addressed by the review alone.</b> These used to hang off {@code /api/seller-accounts/\{id\}},
 * which read as scoping and was not: the service authorized on {@code (reviewId, orgId)} and used the
 * account for one channel-equality check. The cost of the extra segment was that a review acquired
 * without an account — every manual upload, every seller-center export — had no address at which its
 * context or its trail could be read. The account boundary that is real (who a reply is FROM) lives on
 * the reply routes, which are unchanged.
 */
@RestController
@RequestMapping("/api/reviews/{reviewId}")
public class ReviewDecisionWorkspaceController {

    private final ReviewDecisionWorkspaceService service;

    public ReviewDecisionWorkspaceController(ReviewDecisionWorkspaceService service) {
        this.service = service;
    }

    /** What stands behind this review: repeated problems, what else said the same, what is written down. */
    @GetMapping("/decision-context")
    public ReviewDecisionContextView context(@AuthenticationPrincipal AuthPrincipal principal,
                                             @PathVariable UUID reviewId) {
        return service.context(principal.orgId(), reviewId);
    }

    /** What has already been decided about this review, newest first. */
    @GetMapping("/decision-log")
    public List<ReviewDecisionLogEntryView> log(@AuthenticationPrincipal AuthPrincipal principal,
                                                @PathVariable UUID reviewId) {
        return service.log(principal.orgId(), reviewId);
    }
}
