package com.sellerops.attention.reply;

import com.sellerops.attention.reply.dto.ReviewReplyApprovalRequest;
import com.sellerops.attention.reply.dto.ReviewReplyApprovalResponse;
import com.sellerops.attention.reply.dto.ReviewReplyDraftRequest;
import com.sellerops.review.draft.dto.GeneratedReviewDraftView;
import com.sellerops.attention.reply.dto.ReviewReplyDraftView;
import com.sellerops.attention.reply.dto.ReviewReplyExecuteRequest;
import com.sellerops.attention.reply.dto.ReviewReplyExecutionObserveRequest;
import com.sellerops.attention.reply.dto.ReviewReplyOutcomeRequest;
import com.sellerops.attention.reply.dto.ReviewReplyOutcomeResponse;
import com.sellerops.attention.reply.dto.ReviewReplyPrepView;
import com.sellerops.attention.reply.dto.ReviewReplySubmissionRunRequest;
import com.sellerops.attention.reply.dto.ReviewReplySubmissionRunResponse;
import com.sellerops.auth.AuthPrincipal;
import com.sellerops.review.publish.ReviewExecutionView;
import com.sellerops.review.publish.ReviewReplyExecutionService;
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
 * <p><b>Preparation routes send nothing.</b> Draft, approval, submission-run mint and outcome carry no
 * marketplace call. The approved text leaves through the operator's clipboard or a guided run.
 *
 * <p><b>One route sends, and it says so:</b> {@code POST …/reply/execute} (Agentic Operating
 * Workspace v2 §A2) posts the APPROVED head at the channel through
 * {@link ReviewReplyExecutionService} — behind the execution flag, the connector, the seller's write
 * grant, {@code executableIdentity = MARKETPLACE}, an armed live approval and the approved
 * fingerprint the client saw. Off by default it records a refusal and touches no transport. The
 * guided lane's {@code …/execution/observe} records what the collector saw and sends nothing.
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
    private final ReviewReplyExecutionService executions;

    public OperatorReviewReplyController(ReviewReplyService service, ReviewReplyExecutionService executions) {
        this.service = service;
        this.executions = executions;
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
     * <b>Write one grounded draft version</b> (Grounded Review Drafting v1).
     *
     * <p>POST, and it takes no body: everything the composer needs is the review, and the review is
     * the URL. It writes exactly one new version through the same append-only path a typed save uses,
     * and it makes at most one model call — charged to the org's daily AI budget like every other
     * draft, so a regenerate is a call rather than a free retry.
     *
     * <p>Returns 200 with the saved version, its citations and what is still missing; 404 when the
     * ref is not addressable from this account; 409 for a review that is not {@code RESPONSE_NEEDED},
     * for a draft frozen by a standing approval, or in a deployment with no composer wired.
     *
     * <p>It reaches no marketplace and it approves nothing.
     */
    @PostMapping("/draft/generate")
    public GeneratedReviewDraftView generateDraft(@AuthenticationPrincipal AuthPrincipal principal,
                                                  @PathVariable UUID accountId,
                                                  @PathVariable String actionRef) {
        return service.generateDraft(principal.orgId(), accountId, actionRef, principal.userId());
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
     * <p>The run is always bound to the review's current approved head. The optional body's
     * {@code requireTargetHint} asks the server to derive AND validate the privacy-safe review target hint
     * (coarse rating, KST recency bucket, one-way review-body fingerprint) <b>before</b> minting — so a
     * review that cannot produce a valid hint 409s and mints nothing. Returns 409 when the review is not
     * {@code RESPONSE_NEEDED}, no approval stands, or (guided) no valid hint can be derived; 404 when the ref
     * is not addressable from this account.
     */
    @PostMapping("/submission-run")
    public ReviewReplySubmissionRunResponse startSubmissionRun(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable UUID accountId,
            @PathVariable String actionRef,
            @RequestBody(required = false) ReviewReplySubmissionRunRequest request) {
        boolean requireTargetHint = request != null && Boolean.TRUE.equals(request.requireTargetHint());
        return service.startSubmissionRun(principal.orgId(), accountId, actionRef,
                principal.userId(), requireTargetHint);
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

    /**
     * Execute the approved reply at its channel (API lane — Cafe24 board comment).
     *
     * <p>Returns 200 with the recorded execution for a fresh attempt and for an exact replay
     * ({@code replayed}); the recorded {@code status}/{@code reason} say whether anything left — a
     * deployment with the lane off answers {@code REFUSED / EXECUTION_DISABLED}, never a 500. 400 for a
     * missing commandId; 404 when the ref is not addressable from this account; 409 when no approval
     * stands, the fingerprint is stale, the channel already reports a reply, or the command id was
     * spent on a different target.
     */
    @PostMapping("/execute")
    public ReviewExecutionView execute(@AuthenticationPrincipal AuthPrincipal principal,
                                       @PathVariable UUID accountId,
                                       @PathVariable String actionRef,
                                       @RequestBody ReviewReplyExecuteRequest request) {
        return executions.execute(principal.orgId(), accountId, actionRef, request.commandId(),
                request.expectedFingerprint(), principal.userId());
    }

    /** Where the current approved head's execution stands; 404 when nothing was executed or observed. */
    @GetMapping("/execution")
    public ReviewExecutionView execution(@AuthenticationPrincipal AuthPrincipal principal,
                                         @PathVariable UUID accountId,
                                         @PathVariable String actionRef) {
        return executions.read(principal.orgId(), accountId, actionRef);
    }

    /**
     * The guided lane's observation (NAVER): the collector reports {@code COMPOSER_FILLED} or
     * {@code SELLER_SUBMISSION_OBSERVED} against the run's {@code submissionRef}. Order is enforced,
     * nothing is promoted past what was observed, and nothing is sent.
     */
    @PostMapping("/execution/observe")
    public ReviewExecutionView observe(@AuthenticationPrincipal AuthPrincipal principal,
                                       @PathVariable UUID accountId,
                                       @PathVariable String actionRef,
                                       @RequestBody ReviewReplyExecutionObserveRequest request) {
        return executions.observe(principal.orgId(), accountId, actionRef, request.commandId(),
                request.submissionRef(), request.state(), principal.userId());
    }
}
