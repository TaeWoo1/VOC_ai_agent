package com.sellerops.attention.reply;

import jakarta.persistence.LockModeType;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ReviewReplyApprovalRepository extends JpaRepository<ReviewReplyApproval, UUID> {

    /**
     * The current approval for one review, org-scoped at the query boundary so a cross-org id
     * reads as absent rather than as a row someone else owns.
     */
    Optional<ReviewReplyApproval> findByOrgIdAndReviewId(UUID orgId, UUID reviewId);

    /**
     * As {@link #findByOrgIdAndReviewId}, but takes a {@code PESSIMISTIC_WRITE} row lock — the
     * write path's read, used only inside {@link ReviewReplyApprovalWriter}'s transaction.
     *
     * <p>The lock is the only thing that makes the audit trail's {@code state_from} truthful
     * under concurrency: without it two callers both read the same predecessor and both record
     * having transitioned from it, which is an impossible history. Nothing collides in that
     * case (their command ids differ), so no constraint and no retry can detect it — it has to
     * be prevented, not recovered from. Same arrangement, same reason, as
     * {@code ReviewTriageRepository.lockByOrgIdAndReviewId}.
     *
     * <p>MUST be called inside a transaction; a pessimistic lock outside one is meaningless.
     * It is separate from the unlocked finder rather than replacing it, because the read path
     * displays an approval without wanting to write-lock it.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select a from ReviewReplyApproval a where a.orgId = :orgId and a.reviewId = :reviewId")
    Optional<ReviewReplyApproval> lockByOrgIdAndReviewId(@Param("orgId") UUID orgId,
                                                         @Param("reviewId") UUID reviewId);

    /**
     * Which of these reviews carry any approval row — ONE batch query per drill-down page.
     * See {@link ReviewReplyDraftRepository#findReviewIdsWithDraft} for why ids and not rows.
     *
     * <p>Any approval, including a WITHDRAWN one: a withdrawn approval is still the operator's
     * work, and the row it belongs to still has a draft they may want to read.
     *
     * <p>NOT redundant with the draft query, even though an approval can only be created for a
     * review that already had a draft (the facade requires one) and drafts are append-only, so
     * the draft set should always contain this one. "Should" is doing real work in that
     * sentence: it holds because of a rule in a service, not because of anything the schema
     * enforces, and the cost of not relying on it is one indexed lookup on a set that is
     * already bounded by the page size. Deriving one from the other would make a query answer
     * correctly only for as long as an unrelated invariant elsewhere stays true.
     */
    @Query("select a.reviewId from ReviewReplyApproval a "
            + "where a.orgId = :orgId and a.reviewId in :reviewIds")
    List<UUID> findReviewIdsWithApproval(@Param("orgId") UUID orgId,
                                         @Param("reviewIds") Collection<UUID> reviewIds);

    /**
     * Which of these reviews carry an approval that STANDS right now — {@code APPROVED} only.
     *
     * <p>Deliberately NOT the same question as {@link #findReviewIdsWithApproval}, which counts any
     * approval row including a withdrawn one because that row is still the operator's work. This one
     * answers a different question, and the difference is the whole point: a seller asking "무엇이
     * 승인을 기다리나" must not be handed a review they approved and then withdrew, and must not be
     * told a review still waits when it has already been approved. One predicate cannot be both.
     *
     * <p>One indexed batch query per page, on the same bounded id set as its neighbour.
     */
    @Query("select a.reviewId from ReviewReplyApproval a "
            + "where a.orgId = :orgId and a.reviewId in :reviewIds "
            + "and a.state = com.sellerops.attention.reply.ReviewReplyApprovalState.APPROVED")
    List<UUID> findReviewIdsWithStandingApproval(@Param("orgId") UUID orgId,
                                                 @Param("reviewIds") Collection<UUID> reviewIds);

    /**
     * <b>Every standing approval in the org, newest decision first</b> — Operations Home's 준비된 작업.
     *
     * <p>Its neighbours above take a bounded id set because their caller already has the page of
     * reviews it is describing. The Home has no such page: its question is «what did I approve that is
     * still waiting», which is asked OF the org rather than of a list, so the approvals lead and the
     * reviews are looked up from them.
     *
     * <p>{@code APPROVED} only, for the reason stated above — a withdrawn approval is the operator's
     * work but not a thing waiting to be sent.
     */
    @Query("select a from ReviewReplyApproval a "
            + "where a.orgId = :orgId "
            + "and a.state = com.sellerops.attention.reply.ReviewReplyApprovalState.APPROVED "
            + "order by a.decidedAt desc, a.reviewId asc")
    List<ReviewReplyApproval> findStandingByOrgId(@Param("orgId") UUID orgId, Pageable pageable);

    /** The count behind {@link #findStandingByOrgId}, same predicate. */
    @Query("select count(a) from ReviewReplyApproval a "
            + "where a.orgId = :orgId "
            + "and a.state = com.sellerops.attention.reply.ReviewReplyApprovalState.APPROVED")
    long countStandingByOrgId(@Param("orgId") UUID orgId);
}
