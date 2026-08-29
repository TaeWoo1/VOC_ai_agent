package com.sellerops.inquiry.queue;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.inquiry.queue.dto.InquiryRowsResponse;
import java.time.LocalDate;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Read-only customer inquiry ROWS (Query Accuracy v1). Every axis is a closed token: window, channel,
 * status, order, limit. Org-scoped via {@code principal.orgId()}; sanitized rows only.
 */
@RestController
@RequestMapping("/api/inquiries/rows")
public class InquiryRowsController {

    private final InquiryRowsService service;

    public InquiryRowsController(InquiryRowsService service) {
        this.service = service;
    }

    @GetMapping
    public InquiryRowsResponse rows(@AuthenticationPrincipal AuthPrincipal principal,
                                    @RequestParam(required = false)
                                    @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                    @RequestParam(required = false)
                                    @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
                                    @RequestParam(required = false) String channel,
                                    @RequestParam(required = false) String status,
                                    @RequestParam(required = false) String order,
                                    @RequestParam(required = false) Integer limit) {
        return service.rows(principal.orgId(), from, to, channel, status, order, limit);
    }
}
