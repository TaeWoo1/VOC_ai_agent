package com.sellerops.attention.reply;

import com.sellerops.attention.reply.dto.ReviewReplyApprovalRequest;
import com.sellerops.attention.reply.dto.ReviewReplyApprovalResponse;
import com.sellerops.attention.reply.dto.ReviewReplyDraftRequest;
import com.sellerops.attention.reply.dto.ReviewReplyDraftView;
import com.sellerops.attention.reply.dto.ReviewReplyOutcomeRequest;
import com.sellerops.attention.reply.dto.ReviewReplyOutcomeResponse;
import com.sellerops.attention.reply.dto.ReviewReplyPrepView;
import com.sellerops.attention.reply.dto.ReviewReplySubmissionRunResponse;
import com.sellerops.auth.AuthPrincipal;
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
 * Review response preparation for one drill-down row: read the review and its draft, save a
 * version, approve or withdraw. Thin delegate over {@link ReviewReplyService}; {@code orgId}
 * always comes from the authenticated principal, never the client.
 *
 * <p><b>No send, and nothing that resembles one.</b> There is no publish endpoint here and no
 * marketplace call behind any of these routes. The approved text leaves through the operator's
 * clipboard (Frontend Spec §10.2: 발송처럼 보이는 버튼 금지 — which binds the client, and is
 * easier to honour when the server offers nothing to send with).
 *
 * <p>A third controller in this family rather than an addition to either existing one.
 * {@code OperatorAttentionController} is a pure read delegate over a metadata-only projection,
 * pinned as such by {@code OperatorAttentionItemsJsonContractTest} — and this surface exists
 * precisely to serve what that projection refuses to (the body). Folding it in would make one
 * class answer for both rules and make every read-contract test carry this service.
 * {@code OperatorReviewTriageController} records a judgement about a review; this prepares a
 * reply to one. The routes stay in one family under
 * {@code /api/seller-accounts/{accountId}/attention}.
 *
 * <p>The nesting is real scoping, not cosmetic URL shape: {@code accountId} is what the service
 * authorizes the ref against (see {@link ReviewReplyService}).
 */
@RestController
@RequestMapping("/api/seller-accounts/{accountId}/attention/items/{actionRef}/reply")
public class OperatorReviewReplyController {

    private final ReviewReplyService service;

    public OperatorReviewReplyController(ReviewReplyService service) {
        this.service = service;
    }

    /**
     * Everything the preparation surface needs for one review, in one read: the redacted body,
     * a rule-based suggestion, the current draft, the current approval, and what the operator
     * may do next.
     *
     * <p>Readable regardless of the review's disposition — an operator who has moved a review
     * off {@code RESPONSE_NEEDED} must still be able to see the draft they wrote and withdraw
     * an approval they made. What changes with the disposition is {@code capabilities}, not
     * visibility.
     */
    @GetMapping
    public ReviewReplyPrepView view(@AuthenticationPrincipal AuthPrincipal principal,
                                    @PathVariable UUID accountId,
                                    @PathVariable String actionRef) {
        return service.view(principal.orgId(), accountId, actionRef);
    }

    /**
     * Save a new append-only draft version.
     *
     * <p>PUT, not POST: the client is replacing the current content of a thing that already has
     * an address, and {@code baseVersion} — not a command id — is what makes a retry safe. That
     * differs from the approval below on purpose; see its note.
     *
     * <p>Returns 200 for a fresh version and for an exact retry (identical content on the same
     * base, which inserts nothing); 400 for a blank/over-long body or a missing base; 404 when
     * the ref is not addressable from this account; 409 for a stale base, for a review that is
     * not {@code RESPONSE_NEEDED}, or for a draft frozen by a standing approval.
     */
    @PutMapping("/draft")
    public ReviewReplyDraftView saveDraft(@AuthenticationPrincipal AuthPrincipal principal,
                                          @PathVariable UUID accountId,
                                          @PathVariable String actionRef,
                                          @RequestBody ReviewReplyDraftRequest request) {
        return service.saveDraft(principal.orgId(), accountId, actionRef, request.body(),
                request.baseVersion(), principal.userId());
    }

    /**
     * Approve the current draft, or withdraw a standing approval.
     *
     * <p>POST with a client-minted {@code commandId}, matching the triage route rather than the
     * draft route above. The difference is what a retry must be idempotent against: a draft save
     * carries its own content, so re-sending it is recognisable by that content, whereas
     * "approve" carries almost nothing — two approvals of the same version are
     * indistinguishable without a key, and a retried timeout must not append a second decision
     * to the trail.
     *
     * <p>Withdrawal is accepted whatever the review's disposition. Approval is not — see
     * {@link ReviewReplyService#decideApproval}.
     *
     * <p>Returns 200 for both a fresh write and an exact replay (distinguished by
     * {@code replayed}); 400 for a malformed ref, an unknown state, or a missing
     * commandId/baseVersion; 404 when the ref is not addressable from this account; 409 when
     * there is no draft to approve, no approval to withdraw, the base is stale, the review is
     * not {@code RESPONSE_NEEDED} (approve only), or the command id was already spent on a
     * different decision.
     */
    @PostMapping("/approval")
    public ReviewReplyApprovalResponse decideApproval(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable UUID accountId,
            @PathVariable String actionRef,
            @RequestBody ReviewReplyApprovalRequest request) {
        return service.decideApproval(principal.orgId(), accountId, actionRef, request.state(),
                request.baseVersion(), request.commandId(), principal.userId());
    }

    /**
     * Start a guided Action Window reply-submission run: mint a single-use {@code submissionRef}
     * bound to the current approved head. The client passes it into the Action Window {@code
     * START_RUN}; the reply text never crosses that boundary.
     *
     * <p><b>Still no send.</b> This authorizes a guided, human-performed post — SellerOps guides and
     * observes; the operator submits. There is no marketplace call behind it.
     *
     * <p>Takes no body: the run is always bound to the review's current approved head. Returns 409
     * when the review is not {@code RESPONSE_NEEDED} or no approval stands; 404 when the ref is not
     * addressable from this account.
     */
    @PostMapping("/submission-run")
    public ReviewReplySubmissionRunResponse startSubmissionRun(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable UUID accountId,
            @PathVariable String actionRef) {
        return service.startSubmissionRun(principal.orgId(), accountId, actionRef, principal.userId());
    }

    /**
     * Record the operator's report about their own manual reply post — a LOCAL, operator-reported,
     * explicitly UNVERIFIED fact. Never a claim about NAVER, never a completion; the response carries
     * no body.
     *
     * <p>Returns 200 for a fresh record and for an exact replay (distinguished by {@code replayed});
     * 400 for a malformed ref/commandId/submissionRef/awRunRef or an unknown outcome; 404 when the
     * ref is not addressable from this account; 409 when the review is not {@code RESPONSE_NEEDED},
     * the binding no longer describes the approved head, the binding is already spent (single-use), or
     * the command id was spent on a different outcome.
     */
    @PostMapping("/outcome")
    public ReviewReplyOutcomeResponse recordOutcome(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable UUID accountId,
            @PathVariable String actionRef,
            @RequestBody ReviewReplyOutcomeRequest request) {
        return service.recordSubmissionReported(principal.orgId(), accountId, actionRef,
                request.submissionRef(), request.operatorOutcome(), request.awRunRef(),
                request.commandId(), principal.userId());
    }
}
