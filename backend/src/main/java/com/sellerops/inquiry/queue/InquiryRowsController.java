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
 * Read-only customer inquiry ROWS (Query Accuracy v1). Window, channel, status, order and limit are
 * closed tokens; {@code q} is the seller's own subject word, matched as one bounded LIKE over the
 * subject line and the customer's message; {@code productId} is the product an inquiry is BOUND to —
 * the axis a doorway from the 상품 screen uses, sharing its predicate with the count that screen prints.
 * Org-scoped via {@code principal.orgId()}; sanitized rows only. Another org's product id is not a probe:
 * the org clause means it simply matches nothing.
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
                                    @RequestParam(required = false) Integer limit,
                                    @RequestParam(required = false) String q,
                                    @RequestParam(required = false) java.util.UUID productId,
                                    @RequestParam(required = false) java.util.UUID inquiryId) {
        return service.rows(principal.orgId(), from, to, channel, status, order, limit, q, productId, inquiryId);
    }
}
