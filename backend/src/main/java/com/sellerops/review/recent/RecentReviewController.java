package com.sellerops.review.recent;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.review.recent.dto.RecentReviewsResponse;
import java.time.LocalDate;
import java.util.UUID;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * READ: the reviews that arrived in a window, across the seller-visible channels, with per-channel
 * coverage beside them.
 *
 * <p>Org-scoped from the JWT, never from a parameter. This is the Agent's only source for
 * 「새 리뷰 / 오늘 리뷰 / 낮은 평점 리뷰」 and, like every route the Operator's tool catalogue adapts
 * onto, it reads and writes nothing — no channel is contacted and no state moves.
 */
@RestController
@RequestMapping("/api/reviews/recent")
public class RecentReviewController {

    private final RecentReviewService service;

    public RecentReviewController(RecentReviewService service) {
        this.service = service;
    }

    @GetMapping
    public RecentReviewsResponse recent(@AuthenticationPrincipal AuthPrincipal principal,
                                        @RequestParam(required = false)
                                        @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                        @RequestParam(required = false)
                                        @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
                                        @RequestParam(defaultValue = "false") boolean negativeOnly,
                                        @RequestParam(required = false) String channel,
                                        @RequestParam(required = false) UUID productId,
                                        @RequestParam(required = false) Integer size) {
        return service.recent(principal.orgId(), from, to, negativeOnly, channel, productId, size);
    }
}
