package com.sellerops.attention.reply;

import com.sellerops.attention.VocItemRef;
import com.sellerops.attention.reply.dto.ReviewReplyWorkDismissalResponse;
import com.sellerops.common.ApiException;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.time.Clock;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;

/**
 * "작업에서 제외" — the operator sets a review ASIDE from their 내 답변 작업 to-do, without claiming a
 * reply happened.
 *
 * <p>This writes ONE thing — an append-only {@link ReviewReplyWorkDismissal} — and touches nothing
 * else: no draft is deleted or mutated, no reported outcome is written, no completion is implied. The
 * review leaves the to-do at read time (the {@code NOT_DISMISSED_PREDICATE}) and re-enters
 * automatically once the operator re-marks {@code RESPONSE_NEEDED} or saves a new draft version, so
 * there is no "restore" write here at all.
 *
 * <p>Org/account scoped exactly like the reply lifecycle: the account must exist in the org and host
 * the review's channel, or the ref is unaddressable. Idempotent on {@code (orgId, commandId)}: a
 * repeat is a no-op that reports {@code replayed}, the same contract the outcome write follows.
 *
 * <p><b>Carries no {@code @Transactional} on the write path by design</b> — the same rule
 * {@code ReviewReplyDraftService} follows: {@code save()} commits on return so the unique-violation
 * on a concurrent duplicate surfaces here where the catch can turn it into an idempotent replay,
 * rather than being swallowed by an ambient transaction that flushes only at proxy commit.
 */
@Service
public class ReviewReplyWorkDismissalService {

    private final ReviewReplyWorkDismissalRepository dismissals;
    private final ReviewRepository reviews;
    private final SellerAccountRepository sellerAccounts;
    private final Clock clock;

    @Autowired
    public ReviewReplyWorkDismissalService(ReviewReplyWorkDismissalRepository dismissals,
                                           ReviewRepository reviews,
                                           SellerAccountRepository sellerAccounts) {
        this(dismissals, reviews, sellerAccounts, Clock.systemUTC());
    }

    /** Test seam: an explicit {@link Clock} pins {@code dismissed_at}. */
    ReviewReplyWorkDismissalService(ReviewReplyWorkDismissalRepository dismissals,
                                    ReviewRepository reviews,
                                    SellerAccountRepository sellerAccounts, Clock clock) {
        this.dismissals = dismissals;
        this.reviews = reviews;
        this.sellerAccounts = sellerAccounts;
        this.clock = clock;
    }

    // Not @Transactional: it is called by dismiss() via self-invocation (where a proxy annotation would
    // be a no-op anyway), and the reads need no explicit transaction. The write path is deliberately
    // non-transactional too, so the unique-violation on a concurrent duplicate commits and surfaces to
    // the catch below rather than being swallowed by an ambient transaction.
    Review authorize(UUID orgId, UUID accountId, String actionRef) {
        UUID reviewId = VocItemRef.parseReviewId(actionRef);
        SellerAccount account = sellerAccounts.findByIdAndOrgId(accountId, orgId)
                .orElseThrow(() -> ApiException.notFound("판매 계정을 찾을 수 없습니다."));
        Review review = reviews.findByIdAndOrgId(reviewId, orgId)
                .orElseThrow(() -> ApiException.notFound("해당 항목을 찾을 수 없습니다."));
        if (account.getChannelId() == null || !account.getChannelId().equals(review.getChannelId())) {
            throw ApiException.notFound("해당 항목을 찾을 수 없습니다.");
        }
        return review;
    }

    /**
     * Set the review aside from the reply to-do. Idempotent on {@code (orgId, commandId)}: a replay
     * writes nothing and reports {@code replayed = true}. Never deletes a draft, never records an
     * outcome, never claims completion.
     */
    public ReviewReplyWorkDismissalResponse dismiss(UUID orgId, UUID accountId, String actionRef,
                                                    String commandId, String actor) {
        Review review = authorize(orgId, accountId, actionRef);
        if (commandId == null || commandId.isBlank()) {
            throw ApiException.badRequest("commandId는 필수입니다.");
        }
        // Bound the id here, not at the column: tests build the H2 schema from the entity (varchar(120)),
        // so an over-long id would pass every test and 500 only in production. A 400 everywhere instead.
        if (commandId.length() > 120) {
            throw ApiException.badRequest("commandId가 너무 깁니다.");
        }
        // Fast path: a command already applied replays without a second row.
        if (dismissals.findByOrgIdAndCommandId(orgId, commandId).isPresent()) {
            return new ReviewReplyWorkDismissalResponse(actionRef, true);
        }
        ReviewReplyWorkDismissal d = new ReviewReplyWorkDismissal();
        d.setOrgId(orgId);
        d.setReviewId(review.getId());
        d.setCommandId(commandId);
        d.setDismissedBy(actor);
        d.setDismissedAt(clock.instant());
        try {
            dismissals.save(d);
        } catch (DataIntegrityViolationException raced) {
            // A concurrent request with the same command id won the unique index — the caller's
            // intent is satisfied either way, so this is a replay, not a failure.
            return new ReviewReplyWorkDismissalResponse(actionRef, true);
        }
        return new ReviewReplyWorkDismissalResponse(actionRef, false);
    }
}
