package com.sellerops.inquiry.proposal;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.inquiry.proposal.dto.InquiryDetail;
import com.sellerops.inquiry.proposal.dto.ProposalResult;
import com.sellerops.inquiry.publish.InquiryPublishService;
import com.sellerops.inquiry.publish.dto.ConfirmPublishRequest;
import com.sellerops.inquiry.publish.dto.PublishStatusView;
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
    private final InquiryPublishService publish;

    public InquiryDetailController(InquiryProposalService service, InquiryReplyDraftService drafts,
                                   InquiryPublishService publish) {
        this.service = service;
        this.drafts = drafts;
        this.publish = publish;
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

    /**
     * Seller "confirm and publish": bind the approval immutably to the exact draft
     * version/fingerprint, create the publish intent (&rarr; ACTION_PENDING), and — only
     * when live execution is enabled and credentialed — dispatch. Requires {@code
     * commandId} (idempotency) and {@code expectedFingerprint} (a mismatch is 409).
     */
    @PostMapping("/{workItemId}/confirm-publish")
    public PublishStatusView confirmPublish(@AuthenticationPrincipal AuthPrincipal principal,
                                            @PathVariable UUID workItemId,
                                            @RequestBody ConfirmPublishRequest request) {
        return publish.confirmAndPublish(principal.orgId(), workItemId, principal.userId(),
                request.commandId(), request.expectedFingerprint());
    }

    /** Verify-only: re-query {@code informStatus} and advance to COMPLETED on 처리완료. Never resends. */
    @PostMapping("/{workItemId}/verify")
    public PublishStatusView verify(@AuthenticationPrincipal AuthPrincipal principal,
                                    @PathVariable UUID workItemId) {
        return publish.verify(principal.orgId(), workItemId);
    }

    /**
     * Resume/recover an already-bound publish: a retry dispatches only from
     * ACTION_PENDING; an abandoned DISPATCHING is recovered to DELIVERY_UNKNOWN and
     * verified (never resent); EXECUTED/DELIVERY_UNKNOWN verify; COMPLETED/FAILED are
     * no-op. Use this to resume a publish confirmed while execution was disabled.
     */
    @PostMapping("/{workItemId}/resume")
    public PublishStatusView resume(@AuthenticationPrincipal AuthPrincipal principal,
                                    @PathVariable UUID workItemId) {
        return publish.resume(principal.orgId(), workItemId);
    }
}
