package com.sellerops.review.workspace;

import com.sellerops.attention.triage.ReviewTriageService;
import com.sellerops.attention.triage.dto.TriageDecisionRequest;
import com.sellerops.attention.triage.dto.TriageDecisionResponse;
import com.sellerops.auth.AuthPrincipal;
import com.sellerops.review.channel.ChannelReviewFeedbackService;
import com.sellerops.review.channel.ChannelReviewService;
import com.sellerops.review.channel.dto.ChannelReviewDetailView;
import com.sellerops.review.channel.dto.TriageFeedbackRequests;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * <b>Agent-native Core Boundary v1 — the Review Decision Workspace, addressed by the review alone.</b>
 *
 * <p>Everything a seller does <i>about</i> a review lives here: read it in full, judge it, decide what
 * to do, record that they did it, read the trail. Every route is scoped by {@code (reviewId, orgId)}
 * from the JWT and nothing else, because that pair is what the services underneath always authorized
 * on. The seller account used to sit in the path and contribute exactly one predicate — «this
 * account's channel equals the review's channel» — which is a fact the review already carries, so the
 * only thing the segment actually did was make the address unreachable for a review no account
 * acquired. Manual uploads and seller-center exports are this org's reviews; until now they had no
 * workspace.
 *
 * <p><b>What did NOT move.</b> Replying is something an ACCOUNT does — it needs a channel, a
 * credential and somebody for the message to be from — so the reply draft, the approval, the
 * submission mint and the execution lane keep their account-scoped addresses, unchanged. The detail
 * read below names the account when this org has exactly one on the review's channel, so a surface
 * can reach those lanes without knowing it in advance, and says which absence it is looking at when
 * it cannot ({@code replyUnavailableReason}).
 *
 * <p><b>Nothing here is new behaviour.</b> Each method delegates to the service that already owned the
 * write, its idempotency key, its row lock and its append-only trail. There is no second decision
 * store, no second correction store, and no marketplace call on any route in this class.
 *
 * <p>The channel contract of {@code contracts/review-triage-events/v1} §1 is unchanged and still
 * enforced — now against the review's own channel — so a review on a channel outside the three is
 * still a 404 on the feedback routes, and an act a channel cannot produce is still a 400.
 */
@RestController
@RequestMapping("/api/reviews/{reviewId}")
public class ReviewWorkspaceController {

    private final ChannelReviewService reviews;
    private final ChannelReviewFeedbackService feedback;
    private final ReviewTriageService triage;

    public ReviewWorkspaceController(ChannelReviewService reviews, ChannelReviewFeedbackService feedback,
                                     ReviewTriageService triage) {
        this.reviews = reviews;
        this.feedback = feedback;
        this.triage = triage;
    }

    /**
     * One review in full — the read the workspace opens on.
     *
     * <p>Named {@code /workspace} rather than taking over {@code GET /api/reviews/{id}}, which is a
     * different view with a different shape and a live consumer (the conversation's review anchor).
     * Two views of one row is not duplication when each answers a different question; two views at one
     * address would be.
     */
    @GetMapping("/workspace")
    public ChannelReviewDetailView workspace(@AuthenticationPrincipal AuthPrincipal principal,
                                             @PathVariable UUID reviewId) {
        return reviews.detail(principal.orgId(), reviewId);
    }

    /** The seller's own judgment — one of the three tiers. Strong evidence; supersedes their last answer. */
    @PostMapping("/triage-feedback/correction")
    public TriageFeedbackRequests.CorrectionView correct(@AuthenticationPrincipal AuthPrincipal principal,
                                                         @PathVariable UUID reviewId,
                                                         @RequestBody TriageFeedbackRequests.Correction request) {
        return feedback.correct(principal.orgId(), reviewId, request, principal.userId());
    }

    /** 되돌리기 — the seller takes their judgment back. The row and its trail are kept. */
    @DeleteMapping("/triage-feedback/correction")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void withdrawCorrection(@AuthenticationPrincipal AuthPrincipal principal,
                                   @PathVariable UUID reviewId) {
        feedback.withdraw(principal.orgId(), reviewId, principal.userId());
    }

    /** The review's correction trail, oldest first. */
    @GetMapping("/triage-feedback/correction/history")
    public List<TriageFeedbackRequests.CorrectionHistoryView> correctionHistory(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable UUID reviewId) {
        return feedback.correctionHistory(principal.orgId(), reviewId);
    }

    /** The seller acted: started or completed. Append-only; nothing is sent anywhere. */
    @PostMapping("/triage-feedback/actions")
    public void act(@AuthenticationPrincipal AuthPrincipal principal,
                    @PathVariable UUID reviewId,
                    @RequestBody TriageFeedbackRequests.Action request) {
        feedback.act(principal.orgId(), reviewId, request == null ? null : request.kind(), principal.userId());
    }

    /**
     * Record the response decision on this review.
     *
     * <p>No {@code actionRef}: the path already names the review, and a ref in a path segment that
     * decodes to the same id is a second address for one object. Idempotency is unchanged and still
     * comes from {@code commandId} — 200 for a fresh write and for an exact replay (told apart by
     * {@code replayed}), 400 for an unknown disposition, 404 when this org does not own the review,
     * 409 when the command id was already spent on a different decision.
     */
    @PostMapping("/decision")
    public TriageDecisionResponse decide(@AuthenticationPrincipal AuthPrincipal principal,
                                         @PathVariable UUID reviewId,
                                         @RequestBody TriageDecisionRequest request) {
        return triage.decide(principal.orgId(), reviewId, request.disposition(), request.commandId(),
                principal.userId());
    }
}
