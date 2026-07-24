package com.sellerops.attention.reply;

import com.sellerops.attention.VocItemRef;
import com.sellerops.attention.reply.dto.ReviewReplyWorkRestoreResponse;
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
 * "복원" — the operator brings a review they had set aside (작업에서 제외) BACK onto their 내 답변 작업
 * to-do. The mirror of {@link ReviewReplyWorkDismissalService}.
 *
 * <p>This writes ONE thing — an append-only {@link ReviewReplyWorkRestore} — and touches nothing else:
 * no draft is deleted or mutated, no triage disposition is changed, no reported outcome is written, no
 * completion is implied. It does not delete the dismissal it reverses; that row stays as history and
 * this one simply OUTRANKS it by the shared {@link ReplyWorkEventSequence} position, so the read
 * treats the review as active again.
 *
 * <p>Org/account scoped exactly like dismissal: the account must exist in the org and host the
 * review's channel, or the ref is unaddressable. Idempotent on {@code (orgId, commandId)}: a repeat is
 * a no-op that reports {@code replayed}. Non-{@code @Transactional} for the same reason dismissal is —
 * the unique-violation on a concurrent duplicate must commit and surface to the catch as a replay
 * rather than be swallowed by an ambient transaction.
 */
@Service
public class ReviewReplyWorkRestoreService {

    private final ReviewReplyWorkRestoreRepository restores;
    private final ReviewRepository reviews;
    private final SellerAccountRepository sellerAccounts;
    private final ReplyWorkEventSequence eventSeq;
    private final Clock clock;

    @Autowired
    public ReviewReplyWorkRestoreService(ReviewReplyWorkRestoreRepository restores,
                                         ReviewRepository reviews,
                                         SellerAccountRepository sellerAccounts,
                                         ReplyWorkEventSequence eventSeq) {
        this(restores, reviews, sellerAccounts, eventSeq, Clock.systemUTC());
    }

    /** Test seam: an explicit {@link Clock} pins {@code restored_at}. */
    ReviewReplyWorkRestoreService(ReviewReplyWorkRestoreRepository restores,
                                  ReviewRepository reviews,
                                  SellerAccountRepository sellerAccounts,
                                  ReplyWorkEventSequence eventSeq, Clock clock) {
        this.restores = restores;
        this.reviews = reviews;
        this.sellerAccounts = sellerAccounts;
        this.eventSeq = eventSeq;
        this.clock = clock;
    }

    // Not @Transactional — see the class note and ReviewReplyWorkDismissalService.authorize.
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
     * Bring the review back onto the reply to-do. Idempotent on {@code (orgId, commandId)}: a replay
     * writes nothing and reports {@code replayed = true}. Never deletes a dismissal, never mutates a
     * draft or disposition, never records an outcome, never claims completion.
     */
    public ReviewReplyWorkRestoreResponse restore(UUID orgId, UUID accountId, String actionRef,
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
        if (restores.findByOrgIdAndCommandId(orgId, commandId).isPresent()) {
            return new ReviewReplyWorkRestoreResponse(actionRef, true);
        }
        ReviewReplyWorkRestore rec = new ReviewReplyWorkRestore();
        rec.setOrgId(orgId);
        rec.setReviewId(review.getId());
        rec.setCommandId(commandId);
        rec.setRestoredBy(actor);
        rec.setRestoredAt(clock.instant());
        // The shared reply-work position — allocated only past the fast-path so a replay never burns a
        // position, and greater than every dismissal handed out before it, so this restore outranks the
        // dismissal it reverses.
        rec.setSeq(eventSeq.next());
        try {
            restores.save(rec);
        } catch (DataIntegrityViolationException raced) {
            // A concurrent request with the same command id won the unique index — the caller's intent
            // is satisfied either way, so this is a replay, not a failure.
            return new ReviewReplyWorkRestoreResponse(actionRef, true);
        }
        return new ReviewReplyWorkRestoreResponse(actionRef, false);
    }
}
