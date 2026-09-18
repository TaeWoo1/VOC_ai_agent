package com.sellerops.review.naver;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.sellerops.auth.AuthPrincipal;
import java.util.List;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The seller-authenticated half of NAVER Review Reply Enrichment: which replied reviews still lack their text, and the
 * text a bounded Seller Center read found. The organisation is the session's; nothing here reaches a channel.
 */
@RestController
@RequestMapping("/api/reviews/naver/reply-enrichment")
public class NaverReviewReplyEnrichmentController {

    @JsonIgnoreProperties(ignoreUnknown = false)
    public record RecordRequest(List<NaverReviewReplyEnrichmentService.Observation> observations) {
    }

    private final NaverReviewReplyEnrichmentService service;

    public NaverReviewReplyEnrichmentController(NaverReviewReplyEnrichmentService service) {
        this.service = service;
    }

    @GetMapping("/targets")
    public List<NaverReviewReplyEnrichmentService.Target> targets(@AuthenticationPrincipal AuthPrincipal principal,
                                                                   @RequestParam(defaultValue = "3") int limit) {
        return service.targets(principal.orgId(), limit);
    }

    @PostMapping
    public NaverReviewReplyEnrichmentService.Result record(@AuthenticationPrincipal AuthPrincipal principal,
                                                           @RequestBody RecordRequest request) {
        return service.record(principal.orgId(), request == null ? null : request.observations());
    }
}
