package com.sellerops.review.publish;

import com.sellerops.attention.VocItemRef;
import com.sellerops.attention.reply.ReviewReplyApproval;
import com.sellerops.attention.reply.ReviewReplyApprovalRepository;
import com.sellerops.attention.reply.ReviewReplyApprovalService;
import com.sellerops.attention.reply.ReviewReplyApprovalState;
import com.sellerops.attention.reply.ReviewReplyDraft;
import com.sellerops.attention.reply.ReviewReplyDraftService;
import com.sellerops.attention.reply.ReviewReplySubmissionRef;
import com.sellerops.attention.reply.ReviewReplySubmissionRefRepository;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.ApiException;
import com.sellerops.identity.ExecutableIdentity;
import com.sellerops.identity.ExecutableIdentityResolver;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewReplyState;
import com.sellerops.review.ReviewRepository;
import com.sellerops.review.publish.cafe24.Cafe24ReviewCommentAdapter;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.time.Instant;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;

/**
 * Executes an APPROVED review reply at its channel (API lane, Cafe24) and records what the guided
 * lane observed (NAVER) — the one service behind {@code POST …/reply/execute},
 * {@code POST …/reply/execution/observe} and {@code GET …/reply/execution}.
 *
 * <p><b>Every gate the approval seam already has, plus three of its own.</b> The ref is authorized
 * the way {@code ReviewReplyService} authorizes it (org from the JWT, account in org, review in org,
 * review on the account's channel); an APPROVED head must stand and the client's
 * {@code expectedFingerprint} must be that head's (a stale screen sends nothing); the review's
 * {@link ExecutableIdentity} must be {@code MARKETPLACE} (a file cannot be answered at a channel);
 * and the channel's {@link ReviewExecutionCapability} must be {@code API_EXECUTION} — the flag, the
 * connector and the seller's write grant, each with its own reason when it is not.
 *
 * <p><b>Idempotent on {@code commandId}, org-scoped</b>, with the UNIQUE index as the correctness
 * boundary and the lookup as the fast path — the pattern {@code ReviewReplyOutcomeService} uses.
 * A replay returns the recorded row; a command id reused for a different review or head is a 409.
 * Because a POST is not idempotent at the channel, the row is written once per command and the
 * transport is never retried by anything here.
 *
 * <p><b>Guided lane.</b> {@link #observe} appends the collector's report against the single-use
 * {@code submissionRef} the guided run was minted with, refuses a state that goes backwards, and
 * never promotes past {@code SELLER_SUBMISSION_OBSERVED}. {@link #read} performs the read-back step:
 * when the stored review now says {@code ANSWERED} (a later channel read), the observation becomes
 * {@code SUBMISSION_OBSERVED_CONTENT_UNVERIFIED} — and no further, because NAVER exposes no reply
 * body to compare. {@code VERIFIED} is unreachable for NAVER today, by construction.
 *
 * <p>No {@code @Transactional}: the API lane makes a network call between two writes, and a
 * transaction spanning it would hold a row lock across a marketplace round trip.
 */
@Service
public class ReviewReplyExecutionService {

    static final String ACTOR_PREFIX = "SELLER:";
    static final java.util.List<ReviewExecutionStatus> SENT_STATUSES =
            java.util.List.of(ReviewExecutionStatus.POSTED, ReviewExecutionStatus.DELIVERY_UNKNOWN);
    static final String READBACK_COMMAND_PREFIX = "READBACK:";

    private final ReviewRepository reviews;
    private final SellerAccountRepository accounts;
    private final ChannelRepository channels;
    private final ReviewReplyApprovalRepository approvals;
    private final ReviewReplyDraftService drafts;
    private final ReviewReplySubmissionRefRepository submissionRefs;
    private final ReviewReplyExecutionRepository executions;
    private final ExecutableIdentityResolver identity;
    private final ReviewExecutionCapability capability;

    public ReviewReplyExecutionService(ReviewRepository reviews, SellerAccountRepository accounts,
                                       ChannelRepository channels, ReviewReplyApprovalRepository approvals,
                                       ReviewReplyDraftService drafts,
                                       ReviewReplySubmissionRefRepository submissionRefs,
                                       ReviewReplyExecutionRepository executions,
                                       ExecutableIdentityResolver identity,
                                       ReviewExecutionCapability capability) {
        this.reviews = reviews;
        this.accounts = accounts;
        this.channels = channels;
        this.approvals = approvals;
        this.drafts = drafts;
        this.submissionRefs = submissionRefs;
        this.executions = executions;
        this.identity = identity;
        this.capability = capability;
    }

    // ── API lane ─────────────────────────────────────────────────────────────────────────────

    /** Execute the approved head at the channel. See the class note for the gates. */
    public ReviewExecutionView execute(UUID orgId, UUID accountId, String actionRef, String commandId,
                                       String expectedFingerprint, UUID actorUserId) {
        String command = ReviewReplyApprovalService.requireCommandId(commandId);
        Scope scope = authorize(orgId, accountId, actionRef);
        ReviewReplyApproval approval = requireApprovedHead(orgId, scope.review().getId(), expectedFingerprint);

        Optional<ReviewReplyExecution> prior = executions.findByOrgIdAndCommandId(orgId, command);
        if (prior.isPresent()) {
            return replay(prior.get(), scope.review().getId(), approval);
        }

        if (ReviewReplyState.ANSWERED.equals(scope.review().getReplyState())) {
            // The channel already reports a reply. Refused before any gate that could send: a second
            // public reply is the one outcome this whole seam exists to prevent.
            throw ApiException.conflict("채널에 이미 답변이 등록된 리뷰입니다. 답변을 보낼 수 없습니다.");
        }
        String actor = ACTOR_PREFIX + actorUserId;
        // Identity before capability: a row that is not a marketplace object has no channel to send to,
        // whatever the channel's switches say.
        if (identity.forReview(scope.review()) != ExecutableIdentity.MARKETPLACE) {
            return record(scope, approval, command, ReviewExecutionLane.API, ReviewExecutionStatus.REFUSED, null,
                    ReviewExecutionReason.NOT_MARKETPLACE_OBJECT, null, null, actor);
        }
        ReviewExecutionCapability.Decision decision = capability.of(orgId, accountId, scope.channel().getCode());
        if (decision.kind() != ReviewExecutionKind.API_EXECUTION) {
            return record(scope, approval, command, ReviewExecutionLane.API, ReviewExecutionStatus.REFUSED, null,
                    decision.reason() == null ? ReviewExecutionReason.EXECUTION_DISABLED : decision.reason(),
                    null, null, actor);
        }
        // One public reply per review. A NEW command id against a review this lane already POSTED to
        // (or may have — DELIVERY_UNKNOWN) is refused here, and `uq_review_reply_execution_api_sent`
        // is the boundary under a race. The check is per review, not per fingerprint: a newer approved
        // text does not make a second reply less public.
        if (executions.existsByOrgIdAndReviewIdAndLaneAndStatusIn(scope.review().getOrgId(), scope.review().getId(),
                ReviewExecutionLane.API, SENT_STATUSES)) {
            return record(scope, approval, command, ReviewExecutionLane.API, ReviewExecutionStatus.REFUSED, null,
                    ReviewExecutionReason.ALREADY_EXECUTED, null, null, actor);
        }
        return executeCafe24(scope, approval, command, actorUserId);
    }

    private ReviewExecutionView executeCafe24(Scope scope, ReviewReplyApproval approval, String command,
                                              UUID actorUserId) {
        Cafe24ReviewCommentAdapter adapter = capability.cafe24Adapter();
        if (adapter == null) {
            return record(scope, approval, command, ReviewExecutionLane.API, ReviewExecutionStatus.REFUSED, null,
                    ReviewExecutionReason.EXECUTION_DISABLED, null, null, ACTOR_PREFIX + actorUserId);
        }
        String body = approvedBody(scope.review().getId(), approval);
        Cafe24ReviewCommentAdapter.PostResult posted = adapter.post(scope.review().getOrgId(),
                scope.account().getId(), scope.review().getExternalId(), body);
        String actor = ACTOR_PREFIX + actorUserId;
        return switch (posted.kind()) {
            case REFUSED -> record(scope, approval, command, ReviewExecutionLane.API,
                    ReviewExecutionStatus.REFUSED, null, posted.reason(), null, null, actor);
            case DELIVERY_UNKNOWN -> record(scope, approval, command, ReviewExecutionLane.API,
                    ReviewExecutionStatus.DELIVERY_UNKNOWN, null, null,
                    ReviewExecutionVerification.DELIVERY_UNKNOWN, Instant.now(), actor);
            case ACCEPTED -> {
                // The read-back is the verification; a 2xx is only "the channel took the request".
                ReviewExecutionVerification verification = adapter.verify(scope.review().getOrgId(),
                        scope.account().getId(), scope.review().getExternalId(), body, posted.commentNo());
                yield record(scope, approval, command, ReviewExecutionLane.API, ReviewExecutionStatus.POSTED,
                        posted.commentNo() == null ? null : String.valueOf(posted.commentNo()), null,
                        verification, Instant.now(), actor);
            }
        };
    }

    // ── guided lane ──────────────────────────────────────────────────────────────────────────

    /**
     * Record what the collector observed in the seller's browser. State is closed to the two
     * observations the collector can make; it never advances on its own and never goes back.
     */
    public ReviewExecutionView observe(UUID orgId, UUID accountId, String actionRef, String commandId,
                                       String submissionRef, String stateRaw, UUID actorUserId) {
        String command = ReviewReplyApprovalService.requireCommandId(commandId);
        ReviewExecutionVerification state = parseObservedState(stateRaw);
        String ref = requireSubmissionRef(submissionRef);
        Scope scope = authorize(orgId, accountId, actionRef);
        UUID reviewId = scope.review().getId();

        ReviewReplySubmissionRef binding = submissionRefs.findByOrgIdAndSubmissionRef(orgId, ref)
                .filter(b -> b.getReviewId().equals(reviewId))
                .orElseThrow(() -> ApiException.conflict("유효하지 않은 제출 참조입니다. 다시 시작해 주세요."));
        // The binding must still describe the approved head (Acceptance Closure §6): a ref minted for
        // v1 must not stamp the ledger after v1 was withdrawn or v2 approved. Same predicate the
        // outcome path uses; an observation about a superseded draft is refused, not recorded.
        if (binding.getSellerAccountId() != null && !binding.getSellerAccountId().equals(accountId)) {
            throw ApiException.conflict("유효하지 않은 제출 참조입니다. 다시 시작해 주세요.");
        }
        ReviewReplyApproval standing = approvals.findByOrgIdAndReviewId(orgId, reviewId)
                .filter(a -> a.getState() == ReviewReplyApprovalState.APPROVED)
                .orElse(null);
        if (standing == null || standing.getApprovedVersion() == null
                || standing.getApprovedVersion().intValue() != binding.getBoundVersion().intValue()
                || !standing.getApprovedFingerprint().equals(binding.getBoundFingerprint())) {
            throw ApiException.conflict("승인 상태가 바뀌었습니다. 답변 제출을 다시 시작해 주세요.");
        }

        Optional<ReviewReplyExecution> prior = executions.findByOrgIdAndCommandId(orgId, command);
        if (prior.isPresent()) {
            ReviewReplyExecution p = prior.get();
            if (!p.getReviewId().equals(reviewId) || !ref.equals(p.getSubmissionRef())
                    || p.getVerification() != state) {
                throw ApiException.conflict("commandId가 이미 다른 결정에 사용되었습니다.");
            }
            return ReviewExecutionView.of(p, true);
        }

        Optional<ReviewReplyExecution> latest = executions.findTopByOrgIdAndSubmissionRefOrderByCreatedAtDesc(orgId, ref);
        if (latest.isPresent() && latest.get().getVerification() != null
                && latest.get().getVerification().guidedRank() >= state.guidedRank()) {
            // Idempotent on state, strict on order: the same observation twice is the same fact,
            // an earlier one after a later one is a report from the past and is refused.
            if (latest.get().getVerification() == state) {
                return ReviewExecutionView.of(latest.get(), true);
            }
            throw ApiException.conflict("이미 더 나중 단계가 기록된 제출입니다.");
        }

        ReviewExecutionStatus status = state == ReviewExecutionVerification.COMPOSER_FILLED
                ? ReviewExecutionStatus.COMPOSER_FILLED : ReviewExecutionStatus.SELLER_SUBMISSION_OBSERVED;
        ReviewReplyExecution row = newRow(scope, binding.getBoundVersion(), binding.getBoundFingerprint(),
                command, ReviewExecutionLane.GUIDED, status, null, null, state, Instant.now(),
                ACTOR_PREFIX + actorUserId);
        row.setSubmissionRef(ref);
        return persist(row, reviewId, false);
    }

    /**
     * Where the CURRENT approved head's execution stands, or 404 when nothing was ever executed or
     * observed for it. Performs the guided read-back promotion described in the class note.
     */
    public ReviewExecutionView read(UUID orgId, UUID accountId, String actionRef) {
        Scope scope = authorize(orgId, accountId, actionRef);
        ReviewReplyApproval approval = approvals.findByOrgIdAndReviewId(orgId, scope.review().getId())
                .filter(a -> a.getState() == ReviewReplyApprovalState.APPROVED)
                .orElseThrow(() -> ApiException.notFound("실행 기록이 없습니다."));
        ReviewReplyExecution latest = executions
                .findTopByOrgIdAndReviewIdAndApprovedVersionOrderByCreatedAtDesc(orgId, scope.review().getId(),
                        approval.getApprovedVersion())
                .orElseThrow(() -> ApiException.notFound("실행 기록이 없습니다."));
        return ReviewExecutionView.of(readBack(scope, latest), false);
    }

    /**
     * The guided lane's one promotion: a submission the collector saw, on a review the channel has
     * since reported ANSWERED, becomes {@code SUBMISSION_OBSERVED_CONTENT_UNVERIFIED}. Appended once
     * per binding (the command id is derived from the ref), and never {@code VERIFIED}.
     */
    private ReviewReplyExecution readBack(Scope scope, ReviewReplyExecution latest) {
        if (latest.getLane() != ReviewExecutionLane.GUIDED
                || latest.getVerification() != ReviewExecutionVerification.SELLER_SUBMISSION_OBSERVED
                || !ReviewReplyState.ANSWERED.equals(scope.review().getReplyState())) {
            return latest;
        }
        ReviewReplyExecution promoted = newRow(scope, latest.getApprovedVersion(), latest.getApprovedFingerprint(),
                READBACK_COMMAND_PREFIX + latest.getSubmissionRef(), ReviewExecutionLane.GUIDED,
                ReviewExecutionStatus.SELLER_SUBMISSION_OBSERVED, null, null,
                ReviewExecutionVerification.SUBMISSION_OBSERVED_CONTENT_UNVERIFIED, Instant.now(), "SYSTEM");
        promoted.setSubmissionRef(latest.getSubmissionRef());
        try {
            return executions.save(promoted);
        } catch (DataIntegrityViolationException raced) {
            return executions.findByOrgIdAndCommandId(scope.review().getOrgId(), promoted.getCommandId())
                    .orElse(latest);
        }
    }

    // ── shared ───────────────────────────────────────────────────────────────────────────────

    private ReviewExecutionView record(Scope scope, ReviewReplyApproval approval, String command,
                                       ReviewExecutionLane lane, ReviewExecutionStatus status, String providerRef,
                                       ReviewExecutionReason reason, ReviewExecutionVerification verification,
                                       Instant observedAt, String actor) {
        ReviewReplyExecution row = newRow(scope, approval.getApprovedVersion(), approval.getApprovedFingerprint(),
                command, lane, status, providerRef, reason, verification, observedAt, actor);
        return persist(row, scope.review().getId(), false);
    }

    private ReviewReplyExecution newRow(Scope scope, Integer version, String fingerprint, String command,
                                        ReviewExecutionLane lane, ReviewExecutionStatus status, String providerRef,
                                        ReviewExecutionReason reason, ReviewExecutionVerification verification,
                                        Instant observedAt, String actor) {
        ReviewReplyExecution row = new ReviewReplyExecution();
        row.setOrgId(scope.review().getOrgId());
        row.setReviewId(scope.review().getId());
        row.setSellerAccountId(scope.account().getId());
        row.setChannelCode(scope.channel().getCode());
        row.setLane(lane);
        row.setApprovedVersion(version);
        row.setApprovedFingerprint(fingerprint);
        row.setCommandId(command);
        row.setStatus(status);
        row.setProviderRef(providerRef);
        row.setReason(reason);
        row.setVerification(verification);
        row.setObservedAt(observedAt);
        row.setRecordedBy(actor);
        return row;
    }

    private ReviewExecutionView persist(ReviewReplyExecution row, UUID reviewId, boolean replayed) {
        try {
            return ReviewExecutionView.of(executions.save(row), replayed);
        } catch (DataIntegrityViolationException race) {
            // Our own command landed concurrently — answer as the replay it is.
            ReviewReplyExecution raced = executions.findByOrgIdAndCommandId(row.getOrgId(), row.getCommandId())
                    .orElseThrow(() -> race);
            if (!raced.getReviewId().equals(reviewId)) {
                throw ApiException.conflict("commandId가 이미 다른 결정에 사용되었습니다.");
            }
            return ReviewExecutionView.of(raced, true);
        }
    }

    private ReviewExecutionView replay(ReviewReplyExecution prior, UUID reviewId, ReviewReplyApproval approval) {
        if (!prior.getReviewId().equals(reviewId)
                || !prior.getApprovedFingerprint().equals(approval.getApprovedFingerprint())) {
            throw ApiException.conflict("commandId가 이미 다른 결정에 사용되었습니다.");
        }
        return ReviewExecutionView.of(prior, true);
    }

    private ReviewReplyApproval requireApprovedHead(UUID orgId, UUID reviewId, String expectedFingerprint) {
        ReviewReplyApproval approval = approvals.findByOrgIdAndReviewId(orgId, reviewId)
                .filter(a -> a.getState() == ReviewReplyApprovalState.APPROVED)
                .orElseThrow(() -> ApiException.conflict("승인된 답변이 없습니다. 먼저 답변을 승인하세요."));
        if (expectedFingerprint == null || !expectedFingerprint.strip().equals(approval.getApprovedFingerprint())) {
            throw ApiException.conflict("승인 상태가 바뀌었습니다. 화면을 새로고침한 뒤 다시 확인해 주세요.");
        }
        return approval;
    }

    private String approvedBody(UUID reviewId, ReviewReplyApproval approval) {
        ReviewReplyDraft bound = drafts.version(reviewId, approval.getApprovedVersion())
                .orElseThrow(() -> new IllegalStateException(
                        "review_reply_approval binds a draft version that does not exist"));
        if (!bound.getContentFingerprint().equals(approval.getApprovedFingerprint())) {
            throw new IllegalStateException("review_reply_approval fingerprint does not match the version it binds");
        }
        return bound.getBody();
    }

    private static ReviewExecutionVerification parseObservedState(String raw) {
        String state = raw == null ? "" : raw.strip().toUpperCase(Locale.ROOT);
        if (state.equals(ReviewExecutionVerification.COMPOSER_FILLED.name())) {
            return ReviewExecutionVerification.COMPOSER_FILLED;
        }
        if (state.equals(ReviewExecutionVerification.SELLER_SUBMISSION_OBSERVED.name())) {
            return ReviewExecutionVerification.SELLER_SUBMISSION_OBSERVED;
        }
        // Everything else — including VERIFIED and the read-back word — is not something a collector
        // may assert. The vocabulary refuses it here, before any row exists to carry it.
        throw ApiException.badRequest("기록할 수 없는 관찰 상태입니다.");
    }

    private static String requireSubmissionRef(String submissionRef) {
        if (submissionRef == null || !submissionRef.strip().matches("[0-9a-f]{16}")) {
            throw ApiException.badRequest("유효하지 않은 제출 참조입니다.");
        }
        return submissionRef.strip();
    }

    /** The same derivation {@code ReviewReplyService.authorize} performs, with the channel resolved. */
    private Scope authorize(UUID orgId, UUID accountId, String actionRef) {
        UUID reviewId = VocItemRef.parseReviewId(actionRef);
        SellerAccount account = accounts.findByIdAndOrgId(accountId, orgId)
                .orElseThrow(() -> ApiException.notFound("판매 계정을 찾을 수 없습니다."));
        Review review = reviews.findByIdAndOrgId(reviewId, orgId)
                .orElseThrow(() -> ApiException.notFound("해당 항목을 찾을 수 없습니다."));
        if (account.getChannelId() == null || !account.getChannelId().equals(review.getChannelId())) {
            throw ApiException.notFound("해당 항목을 찾을 수 없습니다.");
        }
        Channel channel = channels.findById(account.getChannelId())
                .orElseThrow(() -> ApiException.notFound("채널을 찾을 수 없습니다."));
        return new Scope(account, review, channel);
    }

    private record Scope(SellerAccount account, Review review, Channel channel) {
    }
}
