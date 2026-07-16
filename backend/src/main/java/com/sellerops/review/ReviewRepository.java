package com.sellerops.review;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ReviewRepository extends JpaRepository<Review, UUID> {
    List<Review> findTop50ByOrgIdOrderByReceivedAtDesc(UUID orgId);

    /**
     * One review, org-scoped at the query boundary — a cross-org id reads as absent rather
     * than as a row the caller may not have. Used where an id arrives from a client (the
     * attention surface's {@code actionRef}), so the org filter is authorization, not
     * tidiness: {@code findById} alone would resolve any org's review.
     */
    Optional<Review> findByIdAndOrgId(UUID id, UUID orgId);

    long countByOrgIdAndReceivedAtAfter(UUID orgId, Instant after);

    long countByOrgIdAndNegativeTrue(UUID orgId);

    List<Review> findAllByOrgId(UUID orgId);

    /** Reviews for this org that have no item_analyses row yet (bounded by {@code pageable}). */
    @Query("select r from Review r where r.orgId = :orgId and not exists "
            + "(select 1 from ItemAnalysis a where a.orgId = r.orgId "
            + "and a.sourceType = 'REVIEW' and a.sourceId = r.id) order by r.receivedAt desc")
    List<Review> findUnanalyzedByOrgId(@Param("orgId") UUID orgId, Pageable pageable);

    /** Count of reviews for this org still missing an item_analyses row. */
    @Query("select count(r) from Review r where r.orgId = :orgId and not exists "
            + "(select 1 from ItemAnalysis a where a.orgId = r.orgId "
            + "and a.sourceType = 'REVIEW' and a.sourceId = r.id)")
    long countUnanalyzedByOrgId(@Param("orgId") UUID orgId);

    boolean existsByOrgIdAndChannelIdAndExternalId(UUID orgId, UUID channelId, String externalId);

    boolean existsByOrgIdAndChannelIdAndContentHash(UUID orgId, UUID channelId, String contentHash);

    /**
     * Window-scoped count for the operator attention surface. Scoped by CHANNEL, not by
     * seller account: {@code reviews} carries no {@code seller_account_id} (a file
     * upload resolves no account), so channel is the finest identity this store has.
     * Half-open [{@code from}, {@code toExclusive}) over {@code receivedAt}, matching
     * the community-article source's window semantics so the two read alike.
     */
    @Query("""
            select count(r) from Review r
            where r.orgId = :orgId and r.channelId = :channelId
              and r.receivedAt >= :from and r.receivedAt < :toExclusive
            """)
    long countInWindowByChannel(@Param("orgId") UUID orgId, @Param("channelId") UUID channelId,
                                @Param("from") Instant from, @Param("toExclusive") Instant toExclusive);

    /**
     * As {@link #countInWindowByChannel} but restricted to an inclusive rating bucket
     * [{@code minRating}, {@code maxRating}]. Rows with a null rating are excluded — a
     * null comparison is unknown in JPQL — so an unrated review never lands in a
     * low/mid-rating attention signal.
     */
    @Query("""
            select count(r) from Review r
            where r.orgId = :orgId and r.channelId = :channelId
              and r.rating >= :minRating and r.rating <= :maxRating
              and r.receivedAt >= :from and r.receivedAt < :toExclusive
            """)
    long countInWindowByChannelAndRatingBetween(@Param("orgId") UUID orgId, @Param("channelId") UUID channelId,
                                                @Param("minRating") int minRating,
                                                @Param("maxRating") int maxRating,
                                                @Param("from") Instant from,
                                                @Param("toExclusive") Instant toExclusive);

    /**
     * Attention drill-down: one page of reviews inside the same half-open window the
     * counts use, so a signal's count and its drilled rows stay consistent. Null
     * {@code minRating}/{@code maxRating} collapse to "no constraint". {@code id} is an
     * internal pagination tiebreaker only (never surfaced) and makes the order total.
     */
    @Query("""
            select r from Review r
            where r.orgId = :orgId and r.channelId = :channelId
              and (:minRating is null or r.rating >= :minRating)
              and (:maxRating is null or r.rating <= :maxRating)
              and r.receivedAt >= :from and r.receivedAt < :toExclusive
            order by r.receivedAt desc, r.id desc
            """)
    Page<Review> findInWindowByChannelFiltered(@Param("orgId") UUID orgId, @Param("channelId") UUID channelId,
                                               @Param("minRating") Integer minRating,
                                               @Param("maxRating") Integer maxRating,
                                               @Param("from") Instant from,
                                               @Param("toExclusive") Instant toExclusive,
                                               Pageable pageable);
}
