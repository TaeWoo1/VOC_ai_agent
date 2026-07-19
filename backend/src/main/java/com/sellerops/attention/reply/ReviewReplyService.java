package com.sellerops.attention.reply;

import com.sellerops.attention.VocItemRef;
import com.sellerops.attention.reply.dto.ReviewReplyApprovalResponse;
import com.sellerops.attention.reply.dto.ReviewReplyApprovalView;
import com.sellerops.attention.reply.dto.ReviewReplyCapabilities;
import com.sellerops.attention.reply.dto.ReviewReplyDraftView;
import com.sellerops.attention.reply.dto.ReviewReplyOutcomeResponse;
import com.sellerops.attention.reply.dto.ReviewReplyOutcomeView;
import com.sellerops.attention.reply.dto.ReviewReplyPrepView;
import com.sellerops.attention.reply.dto.ReviewReplySubmissionRunResponse;
import com.sellerops.attention.reply.dto.ReviewReplySuggestionView;
import com.sellerops.attention.reply.dto.ReviewReplyTargetHintView;
import com.sellerops.attention.triage.ReviewTriage;
import com.sellerops.attention.triage.ReviewTriageRepository;
import com.sellerops.attention.triage.TriageDisposition;
import com.sellerops.common.ApiException;
import com.sellerops.common.RedactedBody;
import com.sellerops.common.ReviewBodyFingerprint;
import com.sellerops.common.VocPreviewSanitizer;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.time.Clock;
import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * Review response preparation: read the review, start from a suggested reply, edit it, approve
 * it, copy it. The operator pastes it into the seller center themselves.
 *
 * <p><b>What this is not.</b> There is no marketplace write path behind any of it — no
 * adapter, no action intent, no dispatcher, no verification. The reply leaves SellerOps
 * through the clipboard and nowhere else. Approving freezes text; it does not send it.
 *
 * <p><b>{@code RESPONSE_NEEDED} still promises nothing.</b> It gates whether preparation is
 * OFFERED; it never causes it. Nothing here runs when a disposition is recorded — an operator
 * opens this surface explicitly, or it never opens. {@code TriageDisposition}'s "recording
 * RESPONSE_NEEDED does not draft, queue, send, or promise a reply" is still literally true, and
 * keeping it true is a requirement rather than a coincidence.
 *
 * <p><b>This class owns authorization, the gate, and the capability rule</b>, and delegates
 * persistence to {@link ReviewReplyDraftService} and {@link ReviewReplyApprovalService}. Those
 * two assume both checks have run; nothing else is wired to them. Stating the rule once is what
 * keeps the read, the save, and the approval from drifting into three different opinions about
 * what is allowed.
 *
 * <p><b>Authorization is re-derived from the principal on every call</b>, exactly as
 * {@code ReviewTriageService} does, and the ref is never trusted for any of it: org from the
 * JWT, account must exist in that org, review must exist in that org, review's channel must be
 * the account's channel. Steps 2–4 all fail as 404 — non-disclosure, so a caller cannot tell
 * "no such review" from "someone else's" from "yours, wrong account".
 *
 * <p>Carries no {@code @Transactional}, and must not gain one — see
 * {@link ReviewReplyApprovalWriter}.
 */
@Service
public class ReviewReplyService {

    /** Actor-tag prefix; {@code SELLER:} for the same reason {@code ReviewTriageService} uses it. */
    static final String ACTOR_PREFIX = "SELLER:";

    private final ReviewRepository reviews;
    private final SellerAccountRepository sellerAccounts;
    private final ReviewTriageRepository triages;
    private final ReviewReplyDraftService drafts;
    private final ReviewReplyApprovalService approvals;
    private final ReviewReplyOutcomeService outcomes;
    private final ReviewReplyProposalProvider provider;
    private final Clock clock;

    @Autowired
    public ReviewReplyService(ReviewRepository reviews, SellerAccountRepository sellerAccounts,
                              ReviewTriageRepository triages, ReviewReplyDraftService drafts,
                              ReviewReplyApprovalService approvals,
                              ReviewReplyOutcomeService outcomes,
                              ReviewReplyProposalProvider provider) {
        this(reviews, sellerAccounts, triages, drafts, approvals, outcomes, provider, Clock.systemUTC());
    }

    /** Test seam: an explicit {@link Clock} pins the KST as-of date used for the recency bucket. */
    ReviewReplyService(ReviewRepository reviews, SellerAccountRepository sellerAccounts,
                       ReviewTriageRepository triages, ReviewReplyDraftService drafts,
                       ReviewReplyApprovalService approvals,
                       ReviewReplyOutcomeService outcomes,
                       ReviewReplyProposalProvider provider, Clock clock) {
        this.reviews = reviews;
        this.sellerAccounts = sellerAccounts;
        this.triages = triages;
        this.drafts = drafts;
        this.approvals = approvals;
        this.outcomes = outcomes;
        this.provider = provider;
        this.clock = clock;
    }

    /** Everything the preparation surface needs for one review, in one read. */
    public ReviewReplyPrepView view(UUID orgId, UUID accountId, String actionRef) {
        Review review = authorize(orgId, accountId, actionRef);
        return compose(orgId, review, actionRef);
    }

    /**
     * Save a new draft version.
     *
     * @throws ApiException 409 when the disposition is not {@code RESPONSE_NEEDED} (the gate) or
     *                      an approval currently stands (the freeze).
     */
    public ReviewReplyDraftView saveDraft(UUID orgId, UUID accountId, String actionRef, String body,
                                          Integer baseVersion, UUID actorUserId) {
        Review review = authorize(orgId, accountId, actionRef);
        requireResponseNeeded(orgId, review.getId());
        requireNotFrozen(orgId, review.getId());
        return drafts.save(orgId, review.getId(), ACTOR_PREFIX + actorUserId, body, baseVersion);
    }

    /**
     * Approve or withdraw.
     *
     * <p><b>The gate is asymmetric, and that is the design.</b> Approving requires
     * {@code RESPONSE_NEEDED}; withdrawing never does. Withdrawal is the one operation that
     * reduces commitment, and gating it would strand a review in APPROVED with no way out —
     * frozen against editing by its own approval, and frozen against withdrawal by the gate.
     * An operator who changes their mind about a review must always be able to unsay the
     * approval, whatever they have since concluded about the review itself.
     */
    public ReviewReplyApprovalResponse decideApproval(UUID orgId, UUID accountId, String actionRef,
                                                      String state, Integer baseVersion,
                                                      String commandId, UUID actorUserId) {
        ReviewReplyApprovalState target = ReviewReplyApprovalState.parse(state);
        String command = ReviewReplyApprovalService.requireCommandId(commandId);
        Review review = authorize(orgId, accountId, actionRef);
        UUID reviewId = review.getId();
        String actor = ACTOR_PREFIX + actorUserId;

        if (target == ReviewReplyApprovalState.WITHDRAWN) {
            // No disposition gate: the exit is never blocked.
            //
            // Tests the STATE, not merely the row's existence. A withdrawn row still exists, so
            // an existence check would accept a second withdrawal — returning 200 at exactly the
            // moment this message is true, and appending a WITHDRAWN→WITHDRAWN edge that moves
            // nothing while reattributing the standing decision to whoever fired last.
            gateOrReplay(orgId, reviewId, command, () -> {
                if (!isApproved(orgId, reviewId)) {
                    throw ApiException.conflict("승인된 초안이 없습니다.");
                }
            });
            return approvals.decide(orgId, reviewId, actionRef, target, null, null, command, actor);
        }

        // The binding is the version the CLIENT named, resolved before any gate so that a replay
        // can be compared against the same binding a fresh write would have produced.
        if (baseVersion == null) {
            throw ApiException.badRequest("승인할 초안 버전(baseVersion)이 필요합니다.");
        }
        ReviewReplyDraft bound = drafts.version(reviewId, baseVersion)
                .orElseThrow(() -> ApiException.conflict("승인할 초안이 없습니다. 먼저 초안을 저장하세요."));

        gateOrReplay(orgId, reviewId, command, () -> {
            requireResponseNeeded(orgId, reviewId);
            // Approving is forward motion, so a standing approval freezes it exactly as it
            // freezes saving. Without this, re-approving succeeded while `canApprove` reported
            // false — and the capability object's promise that the server enforces the rules it
            // reports is only worth anything if the flag and the guard are the same rule.
            requireNotFrozen(orgId, reviewId);
            // Approve the version you actually saw. If the head moved on, binding to the newer
            // text would approve words the operator never read.
            //
            // `headVersion` is an int, and that is not incidental: `baseVersion` is an Integer
            // (Jackson boxes it), so comparing it with `!=` against another Integer compares
            // REFERENCES, not values. That silently works up to 127 — where Integer.valueOf's
            // cache hands both sides the same object — and then refuses every approval from
            // version 128 on, with a "refresh and try again" message that cannot help, because
            // refreshing produces the same two distinct boxes. Unboxing one side forces the
            // comparison to be about the number.
            int headVersion = drafts.latest(reviewId).map(ReviewReplyDraft::getVersion).orElse(0);
            if (baseVersion.intValue() != headVersion) {
                throw ApiException.conflict("이미 최신 초안이 있습니다. 새로고침 후 다시 시도하세요.");
            }
        });
        return approvals.decide(orgId, reviewId, actionRef, target, bound.getVersion(),
                bound.getContentFingerprint(), command, actor);
    }

    /**
     * Start a guided Action Window reply-submission run: mint a single-use {@code submissionRef}
     * bound to the current approved head.
     *
     * <p>Same gate as copy — you may guide a post only for an approved reply you may copy, because a
     * guided post IS the copy step performed in the seller center rather than the clipboard. It
     * authorizes no send: SellerOps only guides and observes; the operator submits. Marketplace-neutral.
     *
     * @throws ApiException 409 when the review is not {@code RESPONSE_NEEDED} or no approval stands.
     */
    public ReviewReplySubmissionRunResponse startSubmissionRun(UUID orgId, UUID accountId,
                                                               String actionRef, UUID actorUserId) {
        return startSubmissionRun(orgId, accountId, actionRef, actorUserId, false);
    }

    /**
     * As {@link #startSubmissionRun(UUID, UUID, String, UUID)}, but when {@code requireTargetHint} is set
     * (guided preparation) the privacy-safe review target hint — coarse rating, KST recency bucket, and the
     * one-way {@code review-body-fingerprint/v1} — is derived AND validated <b>before</b> the ref is minted.
     * A review that cannot produce a valid hint (missing rating or blank body) throws 409 and mints
     * <b>nothing</b>, so a missing hint can never leave an unusable single-use ref. The hint carries no raw
     * body/timestamp/id; only the coarse fields and the fingerprint surface, alongside the explicit KST
     * {@code asOfDate} the bucket was computed against.
     *
     * @throws ApiException 409 when the review is not {@code RESPONSE_NEEDED}, no approval stands, or (guided)
     *     the review cannot produce a valid target hint.
     */
    public ReviewReplySubmissionRunResponse startSubmissionRun(UUID orgId, UUID accountId,
                                                               String actionRef, UUID actorUserId,
                                                               boolean requireTargetHint) {
        Review review = authorize(orgId, accountId, actionRef);
        UUID reviewId = review.getId();
        requireResponseNeeded(orgId, reviewId);
        ReviewReplyApproval approval = approvals.current(orgId, reviewId)
                .filter(a -> a.getState() == ReviewReplyApprovalState.APPROVED)
                .orElseThrow(() -> ApiException.conflict("승인된 답변이 없습니다. 먼저 답변을 승인하세요."));

        // Guided: derive AND validate the hint BEFORE minting, so a review that cannot produce a valid hint
        // never leaves an unusable spent ref.
        ReviewReplyTargetHintView targetHint = null;
        String asOfDate = null;
        if (requireTargetHint) {
            LocalDate asOf = ReviewRecencyBucket.asOfKstDate(clock.instant());
            Integer rating = review.getRating();
            String body = review.getBody();
            if (rating == null || rating < 1 || rating > 5 || body == null || body.isBlank()) {
                throw ApiException.conflict("이 리뷰로는 제출 대상 힌트를 만들 수 없어 제출을 시작할 수 없습니다.");
            }
            targetHint = new ReviewReplyTargetHintView(rating,
                    ReviewRecencyBucket.of(review.getReceivedAt(), asOf).name(),
                    ReviewBodyFingerprint.of(body));
            asOfDate = asOf.toString();
        }

        String ref = outcomes.mint(orgId, reviewId, approval.getApprovedVersion(),
                approval.getApprovedFingerprint(), ACTOR_PREFIX + actorUserId);
        return new ReviewReplySubmissionRunResponse(actionRef, ref, approval.getApprovedVersion(),
                targetHint, asOfDate);
    }

    /**
     * Record the operator's report that they posted (or did not post) the approved reply in the
     * seller center — a LOCAL, operator-reported, explicitly UNVERIFIED fact. Never a claim about
     * NAVER, never a completion.
     *
     * <p>Version and fingerprint are server-sourced from the binding; the client names only the ref,
     * the reported outcome, the run ref, and its command id. The binding must still describe the
     * current approved head — a withdrawal or a newer approval since the mint is a 409. The gate is
     * the same asymmetric forward gate ({@code RESPONSE_NEEDED}) as copy; a spent binding is refused
     * (single-use), and a retry of the same command replays rather than double-recording.
     */
    public ReviewReplyOutcomeResponse recordSubmissionReported(UUID orgId, UUID accountId,
                                                               String actionRef, String submissionRef,
                                                               String operatorOutcomeRaw, String awRunRef,
                                                               String commandId, UUID actorUserId) {
        OperatorOutcome operatorOutcome = OperatorOutcome.parse(operatorOutcomeRaw);
        String command = ReviewReplyApprovalService.requireCommandId(commandId);
        String ref = requireSubmissionRef(submissionRef);
        String runRef = requireAwRunRef(awRunRef);
        Review review = authorize(orgId, accountId, actionRef);
        UUID reviewId = review.getId();
        String actor = ACTOR_PREFIX + actorUserId;

        ReviewReplySubmissionRef binding = outcomes.binding(orgId, ref)
                .filter(b -> b.getReviewId().equals(reviewId))
                .orElseThrow(() -> ApiException.conflict("유효하지 않은 제출 참조입니다. 다시 시작해 주세요."));

        gateOrReplayOutcome(orgId, command, () -> {
            requireResponseNeeded(orgId, reviewId);
            ReviewReplyApproval approval = approvals.current(orgId, reviewId)
                    .filter(a -> a.getState() == ReviewReplyApprovalState.APPROVED)
                    .orElse(null);
            if (approval == null || approval.getApprovedVersion() == null
                    || approval.getApprovedVersion().intValue() != binding.getBoundVersion().intValue()
                    || !approval.getApprovedFingerprint().equals(binding.getBoundFingerprint())) {
                throw ApiException.conflict("승인 상태가 바뀌었습니다. 답변 제출을 다시 시작해 주세요.");
            }
            if (outcomes.isSpent(ref)) {
                throw ApiException.conflict("이미 결과가 기록된 제출입니다. 다시 시작해 주세요.");
            }
        });

        String algorithm = drafts.version(reviewId, binding.getBoundVersion())
                .map(ReviewReplyDraft::getFingerprintAlgorithm)
                .orElseThrow(() -> new IllegalStateException(
                        "review_reply_submission_ref binds a draft version that does not exist"));
        return outcomes.record(orgId, reviewId, actionRef, ref, binding.getBoundVersion(),
                binding.getBoundFingerprint(), algorithm, operatorOutcome, runRef, command, actor);
    }

    /** As {@link #gateOrReplay}, but the idempotency ledger is the outcome table, not the approval trail. */
    private void gateOrReplayOutcome(UUID orgId, String command, Runnable gate) {
        try {
            gate.run();
        } catch (ApiException gateClosed) {
            if (!outcomes.isCommandSpent(orgId, command)) {
                throw gateClosed;
            }
        }
    }

    private static String requireSubmissionRef(String submissionRef) {
        if (submissionRef == null || !submissionRef.strip().matches("[0-9a-f]{16}")) {
            throw ApiException.badRequest("유효하지 않은 제출 참조입니다.");
        }
        return submissionRef.strip();
    }

    private static String requireAwRunRef(String awRunRef) {
        if (awRunRef == null || awRunRef.isBlank()) {
            throw ApiException.badRequest("실행 참조(awRunRef)가 필요합니다.");
        }
        String ref = awRunRef.strip();
        if (ref.length() > 128) {
            throw ApiException.badRequest("실행 참조가 너무 깁니다.");
        }
        return ref;
    }

    /**
     * Run a gate, but do not let it refuse a command that has already been applied.
     *
     * <p><b>Every gate here is closed by its own command's success.</b> Approving closes
     * {@code canApprove}; withdrawing closes {@code canWithdraw}. So a client retrying a request
     * whose response it never saw — the ordinary reason command ids exist at all — would be
     * refused by the state its own first attempt created, and told 409 for a decision that in
     * fact succeeded. Gating before the idempotency lookup makes retries unsafe exactly when
     * they matter most.
     *
     * <p>So a closed gate is re-examined rather than reported: if this command id is already
     * spent in this org, the effect has landed and {@link ReviewReplyApprovalService#decide}
     * resolves it as the replay it is (or as a 409, if the id was spent on a DIFFERENT
     * decision — that comparison stays where it belongs). Any other reason the gate closed is
     * still a conflict, and still says so in its own words.
     *
     * <p>This is race-free rather than narrowly-timed, and the reason is worth naming:
     * {@link ReviewReplyApprovalWriter} commits the approval row and its audit row in ONE
     * transaction. There is therefore no instant at which a concurrent winner has closed this
     * gate but not yet published the audit row that explains why — the state that refuses us and
     * the evidence that exonerates us become visible together, or not at all.
     */
    private void gateOrReplay(UUID orgId, UUID reviewId, String command, Runnable gate) {
        try {
            gate.run();
        } catch (ApiException gateClosed) {
            if (!approvals.isCommandSpent(orgId, command)) {
                throw gateClosed;
            }
        }
    }

    /**
     * Re-derive the caller's right to touch this row. The ref is an address, never a capability
     * — see {@link VocItemRef}.
     */
    private Review authorize(UUID orgId, UUID accountId, String actionRef) {
        UUID reviewId = VocItemRef.parseReviewId(actionRef);
        SellerAccount account = sellerAccounts.findByIdAndOrgId(accountId, orgId)
                .orElseThrow(() -> ApiException.notFound("판매 계정을 찾을 수 없습니다."));
        Review review = reviews.findByIdAndOrgId(reviewId, orgId)
                .orElseThrow(ReviewReplyService::unaddressable);
        if (account.getChannelId() == null || !account.getChannelId().equals(review.getChannelId())) {
            throw unaddressable();
        }
        return review;
    }

    private Optional<TriageDisposition> disposition(UUID orgId, UUID reviewId) {
        return triages.findByOrgIdAndReviewId(orgId, reviewId).map(ReviewTriage::getDisposition);
    }

    private void requireResponseNeeded(UUID orgId, UUID reviewId) {
        if (disposition(orgId, reviewId).orElse(null) != TriageDisposition.RESPONSE_NEEDED) {
            throw ApiException.conflict("'대응 필요'로 기록된 리뷰만 답변을 준비할 수 있습니다.");
        }
    }

    /**
     * Whether an approval currently STANDS — the single predicate behind {@code canApprove},
     * {@code canWithdraw}, {@code canCopy}, and both guards below.
     *
     * <p>Stated once rather than re-expressed at each site. The capability object claims the
     * server enforces the rules it reports; that claim survives only if the flag and the guard
     * are literally the same test, not two expressions that currently agree.
     */
    private boolean isApproved(UUID orgId, UUID reviewId) {
        return approvals.current(orgId, reviewId)
                .map(a -> a.getState() == ReviewReplyApprovalState.APPROVED)
                .orElse(false);
    }

    private void requireNotFrozen(UUID orgId, UUID reviewId) {
        if (isApproved(orgId, reviewId)) {
            throw ApiException.conflict("승인된 초안은 수정할 수 없습니다. 승인을 해제한 뒤 수정하세요.");
        }
    }

    private ReviewReplyPrepView compose(UUID orgId, Review review, String actionRef) {
        RedactedBody body = VocPreviewSanitizer.redactFullBody(review.getBody());
        TriageDisposition triage = disposition(orgId, review.getId()).orElse(null);
        ReviewReplyDraft head = drafts.latest(review.getId()).orElse(null);
        ReviewReplyApproval approval = approvals.current(orgId, review.getId()).orElse(null);

        boolean responseNeeded = triage == TriageDisposition.RESPONSE_NEEDED;
        boolean approved = approval != null
                && approval.getState() == ReviewReplyApprovalState.APPROVED;
        ReviewReplyCapabilities capabilities = new ReviewReplyCapabilities(
                responseNeeded && !approved,
                responseNeeded && !approved && head != null,
                approved,
                responseNeeded && approved,
                // canStartSubmissionRun — the same rule as canCopy (a guided post is the copy step
                // performed in the seller center); it never authorizes a send.
                responseNeeded && approved);

        ReviewReplyProposalProvider.Suggestion suggestion = provider.suggest(
                new ReviewReplyProposalProvider.ReviewReplyContext(orgId, review.getId(),
                        body.text(), review.getRating()));

        return new ReviewReplyPrepView(
                actionRef,
                body.text(),
                body.redacted(),
                triage == null ? null : triage.name(),
                new ReviewReplySuggestionView(suggestion.body(), suggestion.category(),
                        suggestion.providerKind(), suggestion.providerName(),
                        suggestion.providerVersion()),
                head == null ? null : ReviewReplyDraftView.of(head),
                approvalView(review.getId(), approval, capabilities.canCopy()),
                outcomeView(orgId, review.getId(), approval, approved),
                capabilities);
    }

    /**
     * The operator-reported outcome for the CURRENT approved reply, or null when nothing is approved
     * or nothing has been reported. Carries {@code operatorOutcome} and {@code verification} as two
     * separate facts — the surface renders the pair, never {@code UNVERIFIED} alone.
     */
    private ReviewReplyOutcomeView outcomeView(UUID orgId, UUID reviewId, ReviewReplyApproval approval,
                                               boolean approved) {
        if (!approved || approval.getApprovedVersion() == null) {
            return null;
        }
        return outcomes.latestForVersion(orgId, reviewId, approval.getApprovedVersion())
                .map(o -> new ReviewReplyOutcomeView(o.getOperatorOutcome().name(),
                        o.getVerification().name(), o.getRecordedVersion(), o.getRecordedFingerprint(),
                        o.getAwRunRef(), o.getCreatedAt()))
                .orElse(null);
    }

    /**
     * The approval, with its copyable body attached only when copying is allowed.
     *
     * <p><b>Fail closed on a mismatched binding.</b> While an approval stands, saves are frozen,
     * so {@code approved_version} is always the head version and its fingerprint always matches
     * the stored draft. If either is ever untrue the data has been corrupted by something this
     * code does not know about, and the honest response is to stop — not to serve a body under a
     * binding that does not describe it. An operator pasting text into a public reply is
     * entitled to know it is the text they approved.
     */
    private ReviewReplyApprovalView approvalView(UUID reviewId, ReviewReplyApproval approval,
                                                 boolean canCopy) {
        if (approval == null) {
            return null;
        }
        if (approval.getState() != ReviewReplyApprovalState.APPROVED) {
            return new ReviewReplyApprovalView(approval.getState().name(), null, null, null,
                    approval.getDecidedAt());
        }
        ReviewReplyDraft bound = drafts.version(reviewId, approval.getApprovedVersion())
                .orElseThrow(() -> new IllegalStateException(
                        "review_reply_approval binds a draft version that does not exist"));
        if (!bound.getContentFingerprint().equals(approval.getApprovedFingerprint())) {
            throw new IllegalStateException(
                    "review_reply_approval fingerprint does not match the version it binds");
        }
        return new ReviewReplyApprovalView(approval.getState().name(), approval.getApprovedVersion(),
                approval.getApprovedFingerprint(), canCopy ? bound.getBody() : null,
                approval.getDecidedAt());
    }

    /**
     * The one "you cannot address this" answer. Deliberately identical for an absent review, a
     * cross-org review, and a review on another account's channel.
     */
    private static ApiException unaddressable() {
        return ApiException.notFound("해당 항목을 찾을 수 없습니다.");
    }
}
