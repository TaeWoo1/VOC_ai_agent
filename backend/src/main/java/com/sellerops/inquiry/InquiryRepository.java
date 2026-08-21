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

    /** Inquiries linked to one product. Org-scoped in the query — {@code product_id} is a bare FK. */
    long countByOrgIdAndProductId(UUID orgId, UUID productId);

    /** Inquiries linked to one product and still in a status (e.g. UNANSWERED). */
    long countByOrgIdAndProductIdAndStatus(UUID orgId, UUID productId, String status);

    /**
     * Inquiries this org holds that carry no product link — the denominator behind
     * {@code UNCERTAIN_PRODUCT_UNLINKED} on the inquiry axis.
     */
    long countByOrgIdAndProductIdIsNull(UUID orgId);

    /**
     * Every inquiry in a stable total order — the paging primitive behind a bounded corpus pass.
     *
     * Twin of {@code ReviewRepository.findForIssueExtraction}, and it carries the same tiebreak for the
     * same reason: without a total order successive pages can revisit rows while others are never
     * reached, and a resumable batch that never converges is worse than no batch — it looks like progress.
     */
    @Query("select q from Inquiry q where q.orgId = :orgId order by q.receivedAt desc, q.id asc")
    List<Inquiry> findForMemoryIndexing(@Param("orgId") UUID orgId, Pageable pageable);

    /** Bounded inquiry ids for one product, newest first. Bounded for the reason the review twin is. */
    @Query("select q.id from Inquiry q where q.orgId = :orgId and q.productId = :productId "
            + "order by q.receivedAt desc, q.id asc")
    List<UUID> findIdsByProduct(@Param("orgId") UUID orgId, @Param("productId") UUID productId,
                                Pageable pageable);

    /** Distinct channels that have product-linked inquiries for one product. */
    @Query("select distinct q.channelId from Inquiry q where q.orgId = :orgId and q.productId = :productId")
    List<UUID> distinctChannelIdsByProduct(@Param("orgId") UUID orgId, @Param("productId") UUID productId);

    /**
     * Which channels a product's inquiries came from, newest first per channel — the inquiry half of the
     * Product Knowledge derivation (the review half is {@code ReviewRepository.channelObservationsForProducts}).
     * Cafe24 and Coupang inquiries carry a channel product number; their reviews often do not, so both
     * corpora have to be asked or a Cafe24-only product would derive no listing at all.
     */
    @Query("""
            select q.channelId, max(q.receivedAt)
            from Inquiry q
            where q.orgId = :orgId and q.productId in :productIds
            group by q.channelId, q.productId
            """)
    List<Object[]> channelObservationsForProducts(@Param("orgId") UUID orgId,
                                                  @Param("productIds") java.util.Collection<UUID> productIds);


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
