package com.sellerops.inquiry;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface InquiryRepository extends JpaRepository<Inquiry, UUID> {
    List<Inquiry> findTop50ByOrgIdOrderByReceivedAtDesc(UUID orgId);

    /** Newest first, caller-sized — the inbox feed's read (product assembly A4). */
    List<Inquiry> findByOrgIdOrderByReceivedAtDesc(UUID orgId, org.springframework.data.domain.Pageable pageable);

    long countByOrgIdAndReceivedAtAfter(UUID orgId, Instant after);

    long countByOrgIdAndStatus(UUID orgId, String status);

    /**
     * Dashboard counts that exclude secret (비밀글) inquiries. A null {@code is_secret}
     * (non-Cafe24 / legacy) is treated as non-secret, so existing behavior is preserved.
     */
    @Query("select count(q) from Inquiry q where q.orgId = :orgId and q.status = :status "
            + "and (q.secret is null or q.secret = false)")
    long countByOrgIdAndStatusExcludingSecret(@Param("orgId") UUID orgId, @Param("status") String status);

    @Query("select count(q) from Inquiry q where q.orgId = :orgId and q.receivedAt > :after "
            + "and (q.secret is null or q.secret = false)")
    long countByOrgIdAndReceivedAtAfterExcludingSecret(@Param("orgId") UUID orgId,
                                                       @Param("after") Instant after);

    /**
     * Inquiries for this org that have no item_analyses row yet (bounded by {@code pageable}).
     * Secret (비밀글) inquiries are excluded from general analysis; a null flag stays included.
     */
    @Query("select q from Inquiry q where q.orgId = :orgId and (q.secret is null or q.secret = false) "
            + "and not exists (select 1 from ItemAnalysis a where a.orgId = q.orgId "
            + "and a.sourceType = 'INQUIRY' and a.sourceId = q.id) order by q.receivedAt desc")
    List<Inquiry> findUnanalyzedByOrgId(@Param("orgId") UUID orgId, Pageable pageable);

    /** Count of non-secret inquiries for this org still missing an item_analyses row. */
    @Query("select count(q) from Inquiry q where q.orgId = :orgId and (q.secret is null or q.secret = false) "
            + "and not exists (select 1 from ItemAnalysis a where a.orgId = q.orgId "
            + "and a.sourceType = 'INQUIRY' and a.sourceId = q.id)")
    long countUnanalyzedByOrgId(@Param("orgId") UUID orgId);

    boolean existsByOrgIdAndChannelIdAndExternalId(UUID orgId, UUID channelId, String externalId);

    boolean existsByOrgIdAndChannelIdAndContentHash(UUID orgId, UUID channelId, String contentHash);

    /** The existing inquiry for an external key, when present — used by import reconciliation. */
    Optional<Inquiry> findByOrgIdAndChannelIdAndExternalId(UUID orgId, UUID channelId, String externalId);
}
