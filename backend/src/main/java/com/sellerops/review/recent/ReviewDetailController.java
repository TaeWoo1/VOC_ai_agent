package com.sellerops.review.recent;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.review.recent.dto.ReviewDetailView;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * READ: one review, by id.
 *
 * <p>Org-scoped from the JWT, never from a parameter; an id this org does not own is a 404. Like every
 * route the Operator's tool catalogue adapts onto, it reads and writes nothing — no channel is contacted
 * and no state moves.
 */
@RestController
@RequestMapping("/api/reviews")
public class ReviewDetailController {

    private final ReviewDetailService service;

    public ReviewDetailController(ReviewDetailService service) {
        this.service = service;
    }

    @GetMapping("/{reviewId}")
    public ReviewDetailView detail(@AuthenticationPrincipal AuthPrincipal principal,
                                   @PathVariable UUID reviewId) {
        return service.detail(principal.orgId(), reviewId);
    }
}
