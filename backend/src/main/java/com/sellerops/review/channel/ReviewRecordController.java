package com.sellerops.review.channel;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.review.channel.dto.ReviewRecordPageView;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The organisation's review record — READ only (UI/UX v2 Phase 2).
 *
 * <p>The per-channel record lives under a seller account because it was built for one; a seller who opens 리뷰
 * asks about their reviews, not about one account's. This is that question with the same answer shape: the same
 * {@code sort} values, the same {@code tier} filter, the same paging, with {@code channel} as a filter over
 * {@code ProductChannels.VISIBLE_CODES} rather than as the address. No write route lives here; every decision about
 * a review is still taken where it always was.
 */
@RestController
@RequestMapping("/api/reviews/record")
public class ReviewRecordController {

    private final ChannelReviewService service;

    public ReviewRecordController(ChannelReviewService service) {
        this.service = service;
    }

    @GetMapping
    public ReviewRecordPageView list(@AuthenticationPrincipal AuthPrincipal principal,
                                     @RequestParam(required = false) String channel,
                                     @RequestParam(required = false) String sort,
                                     @RequestParam(required = false) String tier,
                                     @RequestParam(defaultValue = "0") int page,
                                     @RequestParam(defaultValue = "20") int size) {
        return service.record(principal.orgId(), channel, sort, tier, page, size);
    }
}
