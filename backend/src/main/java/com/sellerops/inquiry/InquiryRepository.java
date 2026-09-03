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

    /**
     * The rows one seller connection currently shows as work — the exact corpus a bounded source
     * re-read is allowed to ask about.
     *
     * <p>Deliberately narrow: current truth ({@code ACTIVE}), real data, one account, still
     * unanswered. Nothing here selects by article number, by neighbour, or by date range — the
     * reclassification asks the source about the rows the SELLER is being shown, and about nothing
     * else. Ordered by id so a capped run is resumable and a re-run is deterministic.
     */
    @Query("select q from Inquiry q where q.orgId = :orgId and q.sellerAccountId = :sellerAccountId "
            + "and q.status = 'UNANSWERED' and q.dataOrigin = com.sellerops.common.DataOrigin.REAL"
            + ACTIVE + "order by q.id asc")
    List<Inquiry> findActiveUnansweredForAccount(@Param("orgId") UUID orgId,
                                                 @Param("sellerAccountId") UUID sellerAccountId);

    /**
     * The rows one connection has already been PROVEN to be source thread replies — the exact,
     * closed set the Cafe24 reply-actor observation is allowed to ask the source about.
     *
     * <p>Deliberately not a search. It returns what a previous approved READ established and this
     * repository recorded ({@code thread_role = 'REPLY'}, with the parent it named); the observation
     * derives its article numbers from these rows and their parents and asks about nothing else. No
     * date window, no neighbour scan, no discovery. Ordered by id so a capped run is deterministic.
     *
     * <p>{@code EXCLUDED_THREAD_REPLY} rows are the whole point here, so this read cannot carry the
     * {@code ACTIVE} gate — it is a historical/audit read in the sense the class javadoc describes.
     */
    @Query("select q from Inquiry q where q.orgId = :orgId and q.sellerAccountId = :sellerAccountId "
            + "and q.threadRole = 'REPLY' and q.dataOrigin = com.sellerops.common.DataOrigin.REAL "
            + "order by q.id asc")
    List<Inquiry> findProvenThreadRepliesForAccount(@Param("orgId") UUID orgId,
                                                    @Param("sellerAccountId") UUID sellerAccountId);

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

    /**
     * <b>답변이 필요한 문의 — the number that says the seller owes work.</b>
     *
     * <p>ONE definition, read by 홈 and by 문의, so the two screens cannot disagree about how much
     * is waiting. {@link #countByOrgIdAndStatus} is the general status count and stays exactly what
     * it is; this is the operational one, and it is narrower on purpose.
     *
     * <p><b>REAL only, and stated rather than inherited.</b> The {@code realDataOnly} filter is
     * disabled on a demo deployment ({@code sellerops.seed.demo-content}) — deliberately, so a demo
     * shows its demo dashboard — and this org's 6 DEMO_SEED + 2 VERIFY_FIXTURE unanswered rows were
     * therefore counted into a KPI a seller reads as an obligation. A manufactured row may appear in
     * a chart of what the shop did; it may never appear in a number that says work is owed. That is
     * the same rule {@code InquiryQueueService} already applies to the queue this work is done from,
     * and {@code InquiryWorkItemWriter} to the rows it opens.
     */
    @Query("select count(q) from Inquiry q where q.orgId = :orgId and q.status = 'UNANSWERED'"
            + " and q.dataOrigin = com.sellerops.common.DataOrigin.REAL" + ACTIVE)
    long countUnansweredOperational(@Param("orgId") UUID orgId);

    /**
     * The same count, per channel — {@code [channelId, unanswered]}, only channels that have any.
     *
     * <p>The caller supplies the zero for a channel with no row, because "we did not ask about this
     * channel" and "this channel has none" are different facts and only the channel registry can
     * tell them apart.
     */
    @Query("select q.channelId, count(q) from Inquiry q where q.orgId = :orgId"
            + " and q.status = 'UNANSWERED'"
            + " and q.dataOrigin = com.sellerops.common.DataOrigin.REAL" + ACTIVE
            + "group by q.channelId")
    List<Object[]> countUnansweredOperationalByChannel(@Param("orgId") UUID orgId);

    /**
     * Unanswered inquiries per product — what the seller still owes, for the whole catalogue at once.
     *
     * <p>The 상품 screen ranks by this. Per-product it would be one query per row, which for a
     * 308-product catalogue is 308 queries to sort twenty. Synthetic rows are excluded here as
     * everywhere else operational work is counted: ranking a seller's catalogue by manufactured
     * complaints is how a demo screen came to name an invented product as the shop's worst.
     */
    @Query("select q.productId, count(q) from Inquiry q where q.orgId = :orgId"
            + " and q.productId is not null and q.status = 'UNANSWERED'"
            + " and q.dataOrigin = com.sellerops.common.DataOrigin.REAL" + ACTIVE
            + "group by q.productId")
    List<Object[]> countUnansweredOperationalByProduct(@Param("orgId") UUID orgId);

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


    // The two secret-excluding dashboard counts that used to live here are gone (Cafe24 Answer
    // Execution v1). They existed only to feed the home cards, and what they fed those cards was a
    // second, smaller corpus published under the same words — 미답변 문의 — that the overview KPI uses
    // for the whole one. 비밀 여부 decides who may READ an inquiry, not whether answering it is work,
    // so the workload counts no longer subtract it and there is no longer a query here that would.
    // Secret content itself is still fenced by the org boundary and still excluded from general
    // analysis, which is a different question and keeps its own predicate below.

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

    /**
     * Query Accuracy v1 (2026-08-28): the customer's inquiries as ROWS — the org's ACTIVE, REAL inquiries
     * in a receipt window, optionally one channel and one status, in the caller's order. This is the read
     * behind 「최근 문의 3개」 / 「오늘 네이버 문의」 / 「답변 안 한 것만」; it is NOT the work queue
     * ({@code InquiryWorkItem}), which answers 「내가 답해야 할 일」 and lives in {@code InquiryQueueService}.
     * The window bounds are always supplied (the service substitutes the epoch / far future), so the
     * query never depends on a nullable timestamp parameter.
     *
     * <p><b>{@code term} is the seller's own subject word, and it is one bound parameter.</b> The
     * closed topic families ({@code SHIPPING} · {@code EXCHANGE_RETURN} · …) cannot name 현금영수증,
     * 세금계산서, 파손 or any other subject a real seller asks about, so before this axis existed the
     * word was dropped and 「현금영수증 관련 문의 중 가장 최근 것」 was answered with the org's newest
     * inquiry — a different question, answered confidently. The match is a case-insensitive LIKE over
     * the subject line and the body the customer wrote; the caller supplies the wildcards, so this is
     * one predicate with one parameter and never a sentence turned into SQL.
     *
     * <p><b>The subject also matches the BOUND PRODUCT's name</b> (Conversation Contract Correctness
     * v2). The same axis had two implementations that disagreed: the visible-set FILTER lane matched
     * the seller's word against the row's subject line, its snippet AND its product name, while this
     * read matched only the two text columns. So 「실리콘 몰딩 관련 문의 있어?」 answered 「몰딩 관련
     * 문의는 없습니다」 to a seller holding four inquiries about that exact product — none of whose
     * customers happened to type the product's name. A product an inquiry is bound to is what that
     * inquiry is about; one axis, one set of fields, and the subquery is org-scoped like every other
     * predicate here.
     */
    @Query("select q from Inquiry q where q.orgId = :orgId"
            + " and (:channelId is null or q.channelId = :channelId)"
            + " and (:status is null or q.status = :status)"
            + " and (:term is null or lower(q.title) like :term or lower(q.body) like :term"
            + " or exists (select 1 from Product p where p.id = q.productId and p.orgId = q.orgId"
            + " and lower(p.name) like :term))"
            + " and q.receivedAt >= :from and q.receivedAt < :toExclusive"
            + " and q.dataOrigin = com.sellerops.common.DataOrigin.REAL" + ACTIVE)
    List<Inquiry> findRowsInWindow(@Param("orgId") UUID orgId, @Param("channelId") UUID channelId,
                                   @Param("status") String status, @Param("term") String term,
                                   @Param("from") Instant from,
                                   @Param("toExclusive") Instant toExclusive, Pageable pageable);

    /** The count that pairs with {@link #findRowsInWindow} — same predicate, so N건 matches the rows. */
    @Query("select count(q) from Inquiry q where q.orgId = :orgId"
            + " and (:channelId is null or q.channelId = :channelId)"
            + " and (:status is null or q.status = :status)"
            + " and (:term is null or lower(q.title) like :term or lower(q.body) like :term"
            + " or exists (select 1 from Product p where p.id = q.productId and p.orgId = q.orgId"
            + " and lower(p.name) like :term))"
            + " and q.receivedAt >= :from and q.receivedAt < :toExclusive"
            + " and q.dataOrigin = com.sellerops.common.DataOrigin.REAL" + ACTIVE)
    long countRowsInWindow(@Param("orgId") UUID orgId, @Param("channelId") UUID channelId,
                           @Param("status") String status, @Param("term") String term,
                           @Param("from") Instant from, @Param("toExclusive") Instant toExclusive);
}
