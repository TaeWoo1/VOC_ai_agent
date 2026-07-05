package com.sellerops.inquiry.proposal;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.inquiry.proposal.dto.InquiryDetail;
import com.sellerops.inquiry.proposal.dto.ProposalResult;
import com.sellerops.inquiry.reply.InquiryReplyDraftService;
import com.sellerops.inquiry.reply.dto.ReplyDraftRequest;
import com.sellerops.inquiry.reply.dto.ReplyDraftView;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Seller-only inquiry detail + proposal generation + reply-draft save, keyed by work
 * item id. All endpoints are org-scoped via {@code principal.orgId()} (a foreign or
 * unknown id is a 404). The detail read exposes the seller's own title/details (and
 * the current reply draft) but never buyer identity; the proposal POST moves an OPEN
 * item to PROPOSED (idempotent); the draft PUT saves a new append-only version on a
 * PROPOSED item. No approval, ActionIntent, token, or ESM send here.
 */
@RestController
@RequestMapping("/api/inquiries")
public class InquiryDetailController {

    private final InquiryProposalService service;
    private final InquiryReplyDraftService drafts;

    public InquiryDetailController(InquiryProposalService service, InquiryReplyDraftService drafts) {
        this.service = service;
        this.drafts = drafts;
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

    /**
     * Save a new append-only reply-draft version on a PROPOSED work item. The seller
     * edits only title/comments; {@code baseVersion} is the version being edited
     * from ({@code 0} for the first save). A stale base is a 409; an exact retry is
     * idempotent.
     */
    @PutMapping("/{workItemId}/draft")
    public ReplyDraftView saveDraft(@AuthenticationPrincipal AuthPrincipal principal,
                                    @PathVariable UUID workItemId,
                                    @RequestBody ReplyDraftRequest request) {
        return drafts.save(principal.orgId(), workItemId, principal.userId(),
                request.title(), request.comments(), request.baseVersion());
    }
}
