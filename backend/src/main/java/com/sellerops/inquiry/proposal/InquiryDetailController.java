package com.sellerops.inquiry.proposal;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.inquiry.binding.InquiryProductBindingService;
import com.sellerops.inquiry.binding.dto.BindProductRequest;
import com.sellerops.inquiry.binding.dto.InquiryProductBindingView;
import com.sellerops.inquiry.proposal.dto.InquiryDetail;
import com.sellerops.inquiry.proposal.dto.ProposalResult;
import com.sellerops.inquiry.publish.InquiryPublishService;
import com.sellerops.inquiry.publish.dto.ConfirmPublishRequest;
import com.sellerops.inquiry.publish.dto.PublishStatusView;
import com.sellerops.inquiry.reply.InquiryReplyDraftService;
import com.sellerops.inquiry.reply.dto.ReplyDraftRequest;
import com.sellerops.inquiry.reply.dto.ReplyDraftView;
import com.sellerops.inquiry.draft.InquiryDraftComposer;
import com.sellerops.inquiry.draft.dto.DraftEvidenceView;
import com.sellerops.inquiry.draft.dto.GeneratedDraftView;
import jakarta.validation.Valid;
import java.util.List;
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
    private final InquiryDraftComposer composer;
    private final InquiryProductBindingService bindings;

    public InquiryDetailController(InquiryProposalService service, InquiryReplyDraftService drafts,
                                   InquiryPublishService publish, InquiryDraftComposer composer,
                                   InquiryProductBindingService bindings) {
        this.service = service;
        this.drafts = drafts;
        this.publish = publish;
        this.composer = composer;
        this.bindings = bindings;
    }

    /** The inquiry's current product attribution and how it was decided. */
    @GetMapping("/{workItemId}/product")
    public InquiryProductBindingView productBinding(@AuthenticationPrincipal AuthPrincipal principal,
                                                    @PathVariable UUID workItemId) {
        return bindings.current(principal.orgId(), workItemId);
    }

    /**
     * Bind this inquiry to a product the seller picked on screen.
     *
     * <p>The product id comes from the seller's own search — nothing here proposes, ranks, or infers
     * one from the inquiry text. Replacing an attribution the CHANNEL made is a 409 carrying {@code
     * SOURCE_BINDING_EXISTS} unless {@code override} is set, so the second confirmation is the
     * seller's and not this endpoint's assumption.
     */
    @PostMapping("/{workItemId}/product")
    public InquiryProductBindingView bindProduct(@AuthenticationPrincipal AuthPrincipal principal,
                                                 @PathVariable UUID workItemId,
                                                 @Valid @RequestBody BindProductRequest request) {
        return bindings.bind(principal.orgId(), workItemId, request.productId(), request.override(),
                principal.userId());
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
     * Generate an AI reply draft for a PROPOSED work item, grounded in the seller's own product
     * knowledge where the inquiry resolves to a product and that product has any.
     *
     * <p>It saves one more append-only version, which means a regenerate does not overwrite what the
     * seller was reading — and, because a new version has a new fingerprint, any approval bound to the
     * previous one can no longer be spent. It performs no marketplace call and needs no approval; it
     * is the "prepare" end of the flow, and the send is a separate, explicitly-confirmed endpoint.
     */
    @PostMapping("/{workItemId}/draft/generate")
    public GeneratedDraftView generateDraft(@AuthenticationPrincipal AuthPrincipal principal,
                                            @PathVariable UUID workItemId) {
        return composer.generate(principal.orgId(), workItemId, principal.userId());
    }

    /** The evidence a given draft version was grounded in — readable after the fact, not only at generation. */
    @GetMapping("/{workItemId}/draft/{version}/evidence")
    public List<DraftEvidenceView> draftEvidence(@AuthenticationPrincipal AuthPrincipal principal,
                                                 @PathVariable UUID workItemId,
                                                 @PathVariable int version) {
        return composer.evidenceFor(principal.orgId(), workItemId, version);
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
     * Re-arm a refused send after the request contract itself was corrected.
     *
     * <p>Not a retry endpoint: it sends nothing, refuses unless the provider created nothing, and
     * writes the refused attempt into the audit before the execution row's fields are cleared. The
     * send that follows is the ordinary {@code /resume}, with the ordinary approval still bound.
     */
    @PostMapping("/{workItemId}/rearm")
    public PublishStatusView rearm(@AuthenticationPrincipal AuthPrincipal principal,
                                   @PathVariable UUID workItemId,
                                   @RequestBody RearmRequest request) {
        return publish.rearmAfterRequestCorrection(principal.orgId(), workItemId,
                principal.userId(), request.correctionRef());
    }

    /** What was corrected — recorded verbatim in the audit, never interpreted. */
    public record RearmRequest(String correctionRef) {
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
