package com.sellerops.community;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface Cafe24CommunityArticleRepository extends JpaRepository<Cafe24CommunityArticle, UUID> {

    /** Natural-key lookup driving the hash-guarded upsert. */
    Optional<Cafe24CommunityArticle> findByChannelIdAndSellerAccountIdAndBoardNoAndArticleNo(
            UUID channelId, UUID sellerAccountId, int boardNo, long articleNo);

    List<Cafe24CommunityArticle> findAllByOrgId(UUID orgId);

    List<Cafe24CommunityArticle> findAllByOrgIdAndSellerAccountIdAndBoardNo(
            UUID orgId, UUID sellerAccountId, int boardNo);

    /** Row count scoped to one connected mall — drives the verifier's count-delta report. */
    long countByOrgIdAndSellerAccountId(UUID orgId, UUID sellerAccountId);

    /**
     * Count one source kind posted within a half-open KST window
     * [{@code from}, {@code toExclusive}). Rows whose {@code sourceCreatedAt} is
     * unknown (timezone-less source value left null) fall outside the range — a
     * deliberate, conservative undercount rather than an assumed date.
     */
    @Query("""
            select count(a) from Cafe24CommunityArticle a
            where a.orgId = :orgId and a.sellerAccountId = :accountId
              and a.sourceKind = :sourceKind
              and a.sourceCreatedAt >= :from and a.sourceCreatedAt < :toExclusive
            """)
    long countInWindow(@Param("orgId") UUID orgId, @Param("accountId") UUID accountId,
                       @Param("sourceKind") String sourceKind,
                       @Param("from") Instant from, @Param("toExclusive") Instant toExclusive);

    /** As {@link #countInWindow} but additionally filtered by normalized reply status. */
    @Query("""
            select count(a) from Cafe24CommunityArticle a
            where a.orgId = :orgId and a.sellerAccountId = :accountId
              and a.sourceKind = :sourceKind and a.replyStatus = :replyStatus
              and a.sourceCreatedAt >= :from and a.sourceCreatedAt < :toExclusive
            """)
    long countInWindowByReplyStatus(@Param("orgId") UUID orgId, @Param("accountId") UUID accountId,
                                    @Param("sourceKind") String sourceKind,
                                    @Param("replyStatus") String replyStatus,
                                    @Param("from") Instant from, @Param("toExclusive") Instant toExclusive);

    /** Drill-down list for one source kind, most-recently-collected first (deterministic). */
    Page<Cafe24CommunityArticle> findByOrgIdAndSellerAccountIdAndSourceKindOrderByCollectedAtDesc(
            UUID orgId, UUID sellerAccountId, String sourceKind, Pageable pageable);
}
