package com.sellerops.inquiry.queue;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.inquiry.queue.dto.InquiryQueueResponse;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Read-only seller inquiry work queue. Org-scoped via {@code principal.orgId()};
 * returns sanitized rows only (no buyer identity, no raw body). An unrecognized phase is a 400
 * (Spring enum binding).
 *
 * <p><b>No {@code phase} means the work waiting for the seller</b> —
 * {@link InquiryWorkItemPhase#AWAITING_SELLER}, the set this product declared once as "the phases
 * where the work is still waiting for the SELLER to decide something" and said every recommendation
 * surface would read. It used to mean {@code OPEN} alone, which is half of it, and the half was what
 * 홈 printed as 「지금 처리할 일」 while 문의 printed the whole set under the same words. Naming a phase
 * still returns exactly that phase, so every caller that names one is unchanged.
 */
@RestController
@RequestMapping("/api/inquiries")
public class InquiryQueueController {

    private final InquiryQueueService service;

    public InquiryQueueController(InquiryQueueService service) {
        this.service = service;
    }

    @GetMapping
    public InquiryQueueResponse list(
            @AuthenticationPrincipal AuthPrincipal principal,
            @RequestParam(required = false) InquiryWorkItemPhase phase,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return service.queue(principal.orgId(),
                phase == null ? InquiryWorkItemPhase.AWAITING_SELLER : java.util.Set.of(phase),
                page, size);
    }
}
