package com.sellerops.review;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ReviewRepository extends JpaRepository<Review, UUID> {
    List<Review> findTop50ByOrgIdOrderByReceivedAtDesc(UUID orgId);

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
}
