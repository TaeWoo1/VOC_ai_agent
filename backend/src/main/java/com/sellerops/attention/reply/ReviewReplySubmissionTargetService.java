package com.sellerops.attention.reply;

import com.sellerops.attention.VocItemRef;
import com.sellerops.attention.reply.dto.AgentReplySubmissionTargetView;
import com.sellerops.attention.reply.dto.ReviewReplyTargetHintView;
import com.sellerops.attention.triage.ReviewTriage;
import com.sellerops.attention.triage.ReviewTriageRepository;
import com.sellerops.attention.triage.TriageDisposition;
import com.sellerops.common.ApiException;
import com.sellerops.common.ReviewBodyFingerprint;
import com.sellerops.common.ReviewIdFingerprint;
import com.sellerops.identity.ExecutableIdentity;
import com.sellerops.identity.ExecutableIdentityResolver;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewReplyState;
import com.sellerops.review.ReviewRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.time.Clock;
import java.time.LocalDate;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * Spends a guided run's {@code submissionRef} for the Local Agent — the step immediately before a
 * seller-center page is touched, so every gate the approval seam has is re-asked here, against the
 * state of the world NOW rather than at mint (Acceptance Closure §1).
 *
 * <p>Refused, each with its own 409 and none of them spending the ref: unknown or cross-org ref;
 * expired; already resolved (single-use); a row minted without an intent (pre-V86); an account
 * that no longer owns the review's channel; a review that is not a {@code MARKETPLACE} object
 * <b>now</b>; no APPROVED head, or a head whose (version, fingerprint) is not the one the ref was
 * bound to (a withdrawal, a re-approval of a newer draft); a review the channel already reports
 * answered; a review no longer marked 대응 필요. The bound draft's body is read at the end and
 * re-checked against the bound fingerprint — the text the agent fills is the text that was approved.
 *
 * <p>The ref is spent by a conditional UPDATE after every gate passed: two agents racing on one ref
 * get one target between them, and the loser gets the same refusal as a spent ref.
 */
@Service
public class ReviewReplySubmissionTargetService {

    private final ReviewReplySubmissionRefRepository refs;
    private final ReviewReplyApprovalRepository approvals;
    private final ReviewReplyDraftService drafts;
    private final ReviewRepository reviews;
    private final SellerAccountRepository accounts;
    private final ReviewTriageRepository triages;
    private final ExecutableIdentityResolver identity;
    private final Clock clock;

    @Autowired
    public ReviewReplySubmissionTargetService(ReviewReplySubmissionRefRepository refs,
                                              ReviewReplyApprovalRepository approvals,
                                              ReviewReplyDraftService drafts, ReviewRepository reviews,
                                              SellerAccountRepository accounts, ReviewTriageRepository triages,
                                              ExecutableIdentityResolver identity) {
        this(refs, approvals, drafts, reviews, accounts, triages, identity, Clock.systemUTC());
    }

    ReviewReplySubmissionTargetService(ReviewReplySubmissionRefRepository refs,
                                       ReviewReplyApprovalRepository approvals,
                                       ReviewReplyDraftService drafts, ReviewRepository reviews,
                                       SellerAccountRepository accounts, ReviewTriageRepository triages,
                                       ExecutableIdentityResolver identity, Clock clock) {
        this.refs = refs;
        this.approvals = approvals;
        this.drafts = drafts;
        this.reviews = reviews;
        this.accounts = accounts;
        this.triages = triages;
        this.identity = identity;
        this.clock = clock;
    }

    public AgentReplySubmissionTargetView resolve(UUID orgId, String submissionRef) {
        String ref = submissionRef == null ? "" : submissionRef.strip();
        ReviewReplySubmissionRef binding = refs.findByOrgIdAndSubmissionRef(orgId, ref)
                .orElseThrow(ReviewReplySubmissionTargetService::invalid);
        if (binding.getTargetResolvedAt() != null) {
            throw ApiException.conflict("이미 사용된 제출 참조입니다. 답변 제출을 다시 시작해 주세요.");
        }
        if (binding.getExpiresAt() == null || !clock.instant().isBefore(binding.getExpiresAt())) {
            throw ApiException.conflict("제출 참조가 만료되었습니다. 답변 제출을 다시 시작해 주세요.");
        }
        if (binding.getSellerAccountId() == null || binding.getChannelId() == null
                || !ReviewReplyService.GUIDED_EXECUTION_MODE.equals(binding.getExecutionMode())) {
            // Pre-V86 or non-guided intent: a binding this table cannot prove is refused, not assumed.
            throw invalid();
        }
        SellerAccount account = accounts.findByIdAndOrgId(binding.getSellerAccountId(), orgId)
                .orElseThrow(ReviewReplySubmissionTargetService::invalid);
        Review review = reviews.findByIdAndOrgId(binding.getReviewId(), orgId)
                .orElseThrow(ReviewReplySubmissionTargetService::invalid);
        if (account.getChannelId() == null || !account.getChannelId().equals(review.getChannelId())
                || !account.getChannelId().equals(binding.getChannelId())) {
            throw invalid();
        }
        if (identity.forReview(review) != ExecutableIdentity.MARKETPLACE) {
            throw ApiException.conflict("파일로 가져온 기록이라 채널로 보낼 수 없습니다.");
        }
        if (review.getReplyState() == ReviewReplyState.ANSWERED) {
            throw ApiException.conflict("채널에 이미 답변이 등록된 리뷰입니다. 가이드형 답변을 시작할 수 없습니다.");
        }
        if (triages.findByOrgIdAndReviewId(orgId, review.getId()).map(ReviewTriage::getDisposition).orElse(null)
                != TriageDisposition.RESPONSE_NEEDED) {
            throw ApiException.conflict("'대응 필요'로 기록된 리뷰만 답변을 준비할 수 있습니다.");
        }
        ReviewReplyApproval approval = approvals.findByOrgIdAndReviewId(orgId, review.getId())
                .filter(a -> a.getState() == ReviewReplyApprovalState.APPROVED)
                .orElseThrow(() -> ApiException.conflict("승인 상태가 바뀌었습니다. 답변 제출을 다시 시작해 주세요."));
        if (approval.getApprovedVersion() == null
                || approval.getApprovedVersion().intValue() != binding.getBoundVersion().intValue()
                || !approval.getApprovedFingerprint().equals(binding.getBoundFingerprint())) {
            throw ApiException.conflict("승인 상태가 바뀌었습니다. 답변 제출을 다시 시작해 주세요.");
        }
        ReviewReplyDraft bound = drafts.version(review.getId(), binding.getBoundVersion())
                .orElseThrow(() -> new IllegalStateException(
                        "review_reply_submission_ref binds a draft version that does not exist"));
        if (!bound.getContentFingerprint().equals(binding.getBoundFingerprint())) {
            throw new IllegalStateException("review_reply_submission_ref fingerprint does not match the version it binds");
        }
        Integer rating = review.getRating();
        String body = review.getBody();
        if (rating == null || rating < 1 || rating > 5 || body == null || body.isBlank()) {
            throw ApiException.conflict("이 리뷰로는 제출 대상 힌트를 만들 수 없어 제출을 시작할 수 없습니다.");
        }
        LocalDate asOf = ReviewRecencyBucket.asOfKstDate(clock.instant());

        if (refs.markTargetResolved(orgId, ref, clock.instant()) != 1) {
            throw ApiException.conflict("이미 사용된 제출 참조입니다. 답변 제출을 다시 시작해 주세요.");
        }
        String externalId = review.getExternalId();
        return new AgentReplySubmissionTargetView(
                account.getId().toString(),
                VocItemRef.forReview(review.getId()),
                new ReviewReplyTargetHintView(rating,
                        ReviewRecencyBucket.of(review.getReceivedAt(), asOf).name(),
                        ReviewBodyFingerprint.of(body)),
                asOf.toString(),
                externalId == null || externalId.isBlank() ? null : ReviewIdFingerprint.of(externalId),
                bound.getBody(),
                binding.getBoundVersion(),
                binding.getBoundFingerprint(),
                binding.getOperation(),
                binding.getExecutionMode());
    }

    private static ApiException invalid() {
        return ApiException.conflict("유효하지 않은 제출 참조입니다. 다시 시작해 주세요.");
    }
}
