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
 * returns sanitized rows only (no buyer identity, no raw body). {@code phase}
 * defaults to {@code OPEN}; an unrecognized phase is a 400 (Spring enum binding).
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
            @RequestParam(defaultValue = "OPEN") InquiryWorkItemPhase phase,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return service.queue(principal.orgId(), phase, page, size);
    }
}
