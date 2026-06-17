package com.sellerops.inquiry;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface InquiryRepository extends JpaRepository<Inquiry, UUID> {
    List<Inquiry> findTop50ByOrgIdOrderByReceivedAtDesc(UUID orgId);

    long countByOrgIdAndReceivedAtAfter(UUID orgId, Instant after);

    long countByOrgIdAndStatus(UUID orgId, String status);

    /** Inquiries for this org that have no item_analyses row yet (bounded by {@code pageable}). */
    @Query("select q from Inquiry q where q.orgId = :orgId and not exists "
            + "(select 1 from ItemAnalysis a where a.orgId = q.orgId "
            + "and a.sourceType = 'INQUIRY' and a.sourceId = q.id) order by q.receivedAt desc")
    List<Inquiry> findUnanalyzedByOrgId(@Param("orgId") UUID orgId, Pageable pageable);

    /** Count of inquiries for this org still missing an item_analyses row. */
    @Query("select count(q) from Inquiry q where q.orgId = :orgId and not exists "
            + "(select 1 from ItemAnalysis a where a.orgId = q.orgId "
            + "and a.sourceType = 'INQUIRY' and a.sourceId = q.id)")
    long countUnanalyzedByOrgId(@Param("orgId") UUID orgId);

    boolean existsByOrgIdAndChannelIdAndExternalId(UUID orgId, UUID channelId, String externalId);

    boolean existsByOrgIdAndChannelIdAndContentHash(UUID orgId, UUID channelId, String contentHash);
}
