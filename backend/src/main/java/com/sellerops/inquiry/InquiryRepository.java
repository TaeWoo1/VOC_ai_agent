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

    /**
     * The predicate every <b>current operational truth</b> read carries.
     *
     * <p>An inquiry the seller dismissed as spam is not work, so it is not counted as work — not on 홈,
     * not in the Today Inbox, not in a product's signals, not in repeat analysis, not in item analysis,
     * and not in an Operator finding. The decision itself lives on the work item; this is the
     * projection of it ({@link InquiryOperationalState}).
     *
     * <p><b>Three kinds of read deliberately do NOT carry it.</b> Dedup keys
     * ({@code existsByOrgIdAndChannelId…}, {@code findByOrgIdAndChannelIdAndExternalId}) must see every
     * stored row or a re-collected spam post would insert a second copy of itself on every sweep.
     * Id-driven reads ({@code findAllById}) are given their ids by a caller that has already decided
     * what it is asking about. And historical/audit reads keep the whole corpus by design — exclusion
     * is a state, never a delete.
     */
    String ACTIVE = " and q.operationalState = com.sellerops.inquiry.InquiryOperationalState.ACTIVE ";

    /** Newest first, caller-sized — the item-analysis sweep's read. Current truth only. */
    @Query("select q from Inquiry q where q.orgId = :orgId" + ACTIVE + "order by q.receivedAt desc, q.id asc")
    List<Inquiry> findRecentActive(@Param("orgId") UUID orgId, Pageable pageable);

    /**
     * The 50 newest active inquiries. Kept as a name rather than a Pageable at every call site because
     * the 50 is the analyzer's per-pass budget, not the caller's choice.
     */
    default List<Inquiry> findTop50ByOrgIdOrderByReceivedAtDesc(UUID orgId) {
        return findRecentActive(orgId, org.springframework.data.domain.PageRequest.of(0, 50));
    }

    /** Newest first, caller-sized — the inbox feed's read (product assembly A4). Current truth only. */
    @Query("select q from Inquiry q where q.orgId = :orgId" + ACTIVE + "order by q.receivedAt desc, q.id asc")
    List<Inquiry> findByOrgIdOrderByReceivedAtDesc(@Param("orgId") UUID orgId, Pageable pageable);

    @Query("select count(q) from Inquiry q where q.orgId = :orgId and q.receivedAt > :after" + ACTIVE)
    long countByOrgIdAndReceivedAtAfter(@Param("orgId") UUID orgId, @Param("after") Instant after);

    @Query("select count(q) from Inquiry q where q.orgId = :orgId and q.status = :status" + ACTIVE)
    long countByOrgIdAndStatus(@Param("orgId") UUID orgId, @Param("status") String status);

    /** Inquiries linked to one product. Org-scoped in the query — {@code product_id} is a bare FK. */
    @Query("select count(q) from Inquiry q where q.orgId = :orgId and q.productId = :productId" + ACTIVE)
    long countByOrgIdAndProductId(@Param("orgId") UUID orgId, @Param("productId") UUID productId);

    /** Inquiries linked to one product and still in a status (e.g. UNANSWERED). */
    @Query("select count(q) from Inquiry q where q.orgId = :orgId and q.productId = :productId "
            + "and q.status = :status" + ACTIVE)
    long countByOrgIdAndProductIdAndStatus(@Param("orgId") UUID orgId, @Param("productId") UUID productId,
                                           @Param("status") String status);

    /**
     * Inquiries this org holds that carry no product link — the denominator behind
     * {@code UNCERTAIN_PRODUCT_UNLINKED} on the inquiry axis.
     */
    @Query("select count(q) from Inquiry q where q.orgId = :orgId and q.productId is null" + ACTIVE)
    long countByOrgIdAndProductIdIsNull(@Param("orgId") UUID orgId);

    /**
     * Per-channel counts of this org's ACTIVE inquiries — {@code [channelId, total, unanswered]}.
     *
     * <b>One read, not one per channel.</b> The caller needs every channel the org actually holds rows
     * on, including the ones with zero, and a loop of counts would make "we did not ask about this
     * channel" and "this channel has none" the same absent row. Grouping here returns exactly the
     * channels that HAVE rows; the caller supplies the zero for the rest from the channel registry, so
     * the two cases stay distinguishable at the only place that can tell them apart.
     *
     * <b>Carries {@link #ACTIVE}</b> — a channel breakdown of "답변이 필요한 문의" must be the same
     * corpus as the org total beside it, or the parts will not sum to the whole on screen.
     */
    @Query("select q.channelId, count(q), sum(case when q.status = 'UNANSWERED' then 1 else 0 end) "
            + "from Inquiry q where q.orgId = :orgId" + ACTIVE + "group by q.channelId")
    List<Object[]> countActiveByChannel(@Param("orgId") UUID orgId);

    /** Newest inquiry receipt time per channel — {@code [channelId, max(receivedAt)]}. */
    @Query("select q.channelId, max(q.receivedAt) from Inquiry q where q.orgId = :orgId"
            + ACTIVE + "group by q.channelId")
    List<Object[]> newestReceivedAtByChannel(@Param("orgId") UUID orgId);

    /** Ids in one operational state — the projection backfill's reversal candidates. */
    @Query("select q.id from Inquiry q where q.orgId = :orgId and q.operationalState = :state")
    List<UUID> findIdsByOrgIdAndOperationalState(@Param("orgId") UUID orgId,
                                                 @Param("state") InquiryOperationalState state);

    /**
     * Every inquiry in a stable total order — the paging primitive behind a bounded corpus pass.
     *
     * Twin of {@code ReviewRepository.findForIssueExtraction}, and it carries the same tiebreak for the
     * same reason: without a total order successive pages can revisit rows while others are never
     * reached, and a resumable batch that never converges is worse than no batch — it looks like progress.
     */
    @Query("select q from Inquiry q where q.orgId = :orgId" + ACTIVE + "order by q.receivedAt desc, q.id asc")
    List<Inquiry> findForMemoryIndexing(@Param("orgId") UUID orgId, Pageable pageable);

    /** Bounded inquiry ids for one product, newest first. Bounded for the reason the review twin is. */
    @Query("select q.id from Inquiry q where q.orgId = :orgId and q.productId = :productId" + ACTIVE
            + "order by q.receivedAt desc, q.id asc")
    List<UUID> findIdsByProduct(@Param("orgId") UUID orgId, @Param("productId") UUID productId,
                                Pageable pageable);

    /** Distinct channels that have product-linked inquiries for one product. */
    @Query("select distinct q.channelId from Inquiry q where q.orgId = :orgId and q.productId = :productId" + ACTIVE)
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
              and q.operationalState = com.sellerops.inquiry.InquiryOperationalState.ACTIVE
            group by q.channelId, q.productId
            """)
    List<Object[]> channelObservationsForProducts(@Param("orgId") UUID orgId,
                                                  @Param("productIds") java.util.Collection<UUID> productIds);


    /**
     * Dashboard counts that exclude secret (비밀글) inquiries. A null {@code is_secret}
     * (non-Cafe24 / legacy) is treated as non-secret, so existing behavior is preserved.
     */
    @Query("select count(q) from Inquiry q where q.orgId = :orgId and q.status = :status "
            + "and (q.secret is null or q.secret = false)" + ACTIVE)
    long countByOrgIdAndStatusExcludingSecret(@Param("orgId") UUID orgId, @Param("status") String status);

    @Query("select count(q) from Inquiry q where q.orgId = :orgId and q.receivedAt > :after "
            + "and (q.secret is null or q.secret = false)" + ACTIVE)
    long countByOrgIdAndReceivedAtAfterExcludingSecret(@Param("orgId") UUID orgId,
                                                       @Param("after") Instant after);

    /**
     * Inquiries for this org that have no item_analyses row yet (bounded by {@code pageable}).
     * Secret (비밀글) inquiries are excluded from general analysis; a null flag stays included.
     */
    @Query("select q from Inquiry q where q.orgId = :orgId and (q.secret is null or q.secret = false)" + ACTIVE
            + "and not exists (select 1 from ItemAnalysis a where a.orgId = q.orgId "
            + "and a.sourceType = 'INQUIRY' and a.sourceId = q.id) order by q.receivedAt desc")
    List<Inquiry> findUnanalyzedByOrgId(@Param("orgId") UUID orgId, Pageable pageable);

    /** Count of non-secret inquiries for this org still missing an item_analyses row. */
    @Query("select count(q) from Inquiry q where q.orgId = :orgId and (q.secret is null or q.secret = false)" + ACTIVE
            + "and not exists (select 1 from ItemAnalysis a where a.orgId = q.orgId "
            + "and a.sourceType = 'INQUIRY' and a.sourceId = q.id)")
    long countUnanalyzedByOrgId(@Param("orgId") UUID orgId);

    /**
     * Inquiries the CHANNEL says the seller has already answered, with the answer text.
     *
     * <p>The corpus behind Answer Memory's imported lane. Bounded by construction: only rows that
     * carry an answer body, which is only the sources that publish one. Ordered so a re-import walks
     * them the same way twice.
     */
    @Query("select q from Inquiry q where q.orgId = :orgId and q.status = 'ANSWERED'"
            + " and q.answerBody is not null and q.dataOrigin = com.sellerops.common.DataOrigin.REAL"
            + " order by q.receivedAt asc, q.id asc")
    List<Inquiry> findAnsweredWithAnswerBody(@Param("orgId") UUID orgId);

    /**
     * The org's REAL, operator-visible, still-unanswered inquiries on one channel.
     *
     * <p>The corpus the knowledge-coverage audit measures. Excludes what the seller has dismissed as
     * spam ({@code operational_state}) and everything synthetic, because a coverage number computed
     * over seeded rows measures the seed.
     */
    @Query("select q from Inquiry q where q.orgId = :orgId and q.channelId = :channelId"
            + " and q.status = 'UNANSWERED'"
            + " and q.operationalState = com.sellerops.inquiry.InquiryOperationalState.ACTIVE"
            + " and q.dataOrigin = com.sellerops.common.DataOrigin.REAL"
            + " order by q.receivedAt asc, q.id asc")
    List<Inquiry> findRealUnansweredForCoverage(@Param("orgId") UUID orgId,
                                                @Param("channelId") UUID channelId);

    boolean existsByOrgIdAndChannelIdAndExternalId(UUID orgId, UUID channelId, String externalId);

    boolean existsByOrgIdAndChannelIdAndContentHash(UUID orgId, UUID channelId, String contentHash);

    /** The existing inquiry for an external key, when present — used by import reconciliation. */
    Optional<Inquiry> findByOrgIdAndChannelIdAndExternalId(UUID orgId, UUID channelId, String externalId);
}
