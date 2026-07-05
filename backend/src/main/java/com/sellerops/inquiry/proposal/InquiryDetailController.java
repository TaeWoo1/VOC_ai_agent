package com.sellerops.inquiry.proposal;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.inquiry.proposal.dto.InquiryDetail;
import com.sellerops.inquiry.proposal.dto.ProposalResult;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Seller-only inquiry detail + proposal generation, keyed by work item id. Both
 * endpoints are org-scoped via {@code principal.orgId()} (a foreign or unknown id
 * is a 404). The detail read exposes the seller's own title/details but never buyer
 * identity; the proposal POST moves an OPEN item to PROPOSED (idempotent).
 */
@RestController
@RequestMapping("/api/inquiries")
public class InquiryDetailController {

    private final InquiryProposalService service;

    public InquiryDetailController(InquiryProposalService service) {
        this.service = service;
    }

    /** Seller-only detail (title + details), org-scoped. */
    @GetMapping("/{workItemId}")
    public InquiryDetail detail(@AuthenticationPrincipal AuthPrincipal principal,
                                @PathVariable UUID workItemId) {
        return service.detail(principal.orgId(), workItemId);
    }

    /** Seller-initiated proposal generation + OPEN &rarr; PROPOSED transition. */
    @PostMapping("/{workItemId}/proposal")
    public ProposalResult propose(@AuthenticationPrincipal AuthPrincipal principal,
                                  @PathVariable UUID workItemId) {
        return service.propose(principal.orgId(), workItemId, principal.userId());
    }
}
