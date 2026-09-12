package com.sellerops.inquiry.workitem;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface InquiryWorkItemRepository extends JpaRepository<InquiryWorkItem, UUID> {

    /** Org-scoped, phase-filtered, paged queue read. */
    Page<InquiryWorkItem> findByOrgIdAndPhase(UUID orgId, InquiryWorkItemPhase phase, Pageable pageable);

    /**
     * The same read, narrowed to work items whose inquiry is the seller's own data.
     *
     * <p><b>The same corpus every count is taken over.</b> The exists-clause carries the {@code ACTIVE}
     * gate for the same reason {@code InquiryRepository.ACTIVE} exists: a queue and a number that read
     * different corpora will disagree, and nobody will be able to say which is right. A spam dismissal
     * already leaves by its phase, so this changes nothing for that case — it is what keeps a row
     * excluded on a ground the phase does not encode (a source-declared thread reply) from sitting in
     * the list while every count around it has stopped counting it.
     *
     * <p>Written as an explicit join rather than left to the {@code realDataOnly} filter, for two
     * reasons. The filter is declared on {@code Inquiry} and this query's root is the work item, and
     * the service's own inquiry load goes through {@code findAllById}, which no Hibernate filter
     * touches. Filtering after the page is fetched would also make {@code totalElements} count rows
     * the caller never receives, and a queue that says 12 while showing 9 is its own defect.
     *
     * <p><b>The answered-elsewhere clause lives here for exactly that reason.</b> It shipped one
     * package ago as a Java filter over the fetched page — correct rows, and a total that still
     * counted the rows it had just dropped. The predicate has not changed: in {@code OPEN} and
     * {@code PROPOSED}, and only there, an inquiry the channel already reports as {@code ANSWERED}
     * is not work. {@code COMPLETED} and {@code EXECUTED} carry answered inquiries by definition, so
     * a clause that ignored the phase would empty exactly the tabs that are supposed to be full.
     * Nothing is written: {@code reconcileConnectorAnswered} still owns closing these on the next
     * collection; this only stops the row being offered, and counted, as a task in the meantime.
     */
    @Query("select w from InquiryWorkItem w where w.orgId = :orgId and w.phase in :phases "
            + "and exists (select 1 from Inquiry i where i.id = w.inquiryId and i.dataOrigin = 'REAL' "
            + "and i.operationalState = com.sellerops.inquiry.InquiryOperationalState.ACTIVE "
            + "and (w.phase not in (com.sellerops.inquiry.workitem.InquiryWorkItemPhase.OPEN, "
            + "com.sellerops.inquiry.workitem.InquiryWorkItemPhase.PROPOSED) "
            + "or i.status <> 'ANSWERED'))")
    Page<InquiryWorkItem> findOperationalByOrgIdAndPhaseIn(
            @Param("orgId") UUID orgId,
            @Param("phases") java.util.Collection<InquiryWorkItemPhase> phases,
            Pageable pageable);

    /**
     * The deterministic candidate gate of the Proactive Operations Agent — work the seller has not
     * started, on a customer question the channel still reports as unanswered.
     *
     * <p><b>Every clause is operational truth, and none of it is a model's opinion.</b> That ordering
     * is the product decision: an LLM never gets to invent "there is work here"; it investigates work
     * this predicate already established. The clauses, and why each is here rather than assumed:
     *
     * <ul>
     *   <li>{@code phase = OPEN} — the seller has not begun. A PROPOSED item is already being worked.
     *   <li>{@code dataOrigin = REAL} — the same door {@code InquiryWorkItemWriter} closes at ingest.
     *       A manufactured row must never reach a surface whose CTA leads to a marketplace send.
     *   <li>{@code operationalState = ACTIVE} — the seller's spam dismissal and the source's own
     *       thread structure are both respected, because both are projected onto this column.
     *   <li>{@code status = 'UNANSWERED'} — the channel's own word, never inferred here.
     *   <li><b>{@code threadRole} is not REPLY</b> — and this is NOT redundant with ACTIVE. It is a
     *       second, independent fence, of the kind the queue already keeps two of for
     *       {@code dataOrigin}. The projector runs at ingest today, so the two agree; if a path ever
     *       stored a reply article without projecting it, this clause is what stops the seller's own
     *       answer from being investigated as a customer's question.
     * </ul>
     *
     * <p><b>{@code observedSince} is the bootstrap fence, and it is not optional.</b> Every clause
     * above is about whether the work is real; none of them is about whether it is <i>today's</i>. On
     * the day this feature is switched on, an org's whole historical backlog satisfies all of them at
     * once — this org's did: 22 items, every one of them received between 2014 and early 2025, all
     * first observed in a single backfill. Preparing those would not be a proactive product, it would
     * be a machine telling a seller that a customer has been waiting since 2014.
     *
     * <p>The fence is the work item's own {@code created_at} — the moment SellerOps FIRST saw this as
     * work, which is an immutable fact about observation. Deliberately not {@code updated_at} or
     * {@code last_seen_at}: routine collection touches those on every sweep (3,266 of this org's 3,334
     * rows carry a touch newer than their insert), so either would call the entire corpus fresh every
     * hour. And deliberately not the source's {@code received_at} alone, which would let a historical
     * backfill run after enable pour the same backlog in through the other door.
     *
     * <p><b>Ordered newest-observed first</b>, which is the other half of the same correction. It used
     * to be oldest-first — reasonable for draining a queue, and exactly wrong here: a capped tick
     * would spend its budget on the least current work in the org.
     */
    @Query("select w from InquiryWorkItem w where w.orgId = :orgId "
            + "and w.phase = com.sellerops.inquiry.workitem.InquiryWorkItemPhase.OPEN "
            + "and w.createdAt >= :observedSince "
            + "and exists (select 1 from Inquiry i where i.id = w.inquiryId "
            + "  and i.dataOrigin = com.sellerops.common.DataOrigin.REAL "
            + "  and i.operationalState = com.sellerops.inquiry.InquiryOperationalState.ACTIVE "
            + "  and i.status = 'UNANSWERED' "
            + "  and (i.threadRole is null or i.threadRole = 'ROOT')) "
            + "order by w.createdAt desc, w.id asc")
    List<InquiryWorkItem> findProactiveCandidates(@Param("orgId") UUID orgId,
                                                  @Param("observedSince") Instant observedSince,
                                                  Pageable pageable);

    boolean existsByInquiryId(UUID inquiryId);

    /** The single work item for an inquiry ({@code inquiry_id} is unique), when present. */
    Optional<InquiryWorkItem> findByInquiryId(UUID inquiryId);

    long countByOrgIdAndPhase(UUID orgId, InquiryWorkItemPhase phase);

    /**
     * <b>Work items waiting on the seller that actually HAVE a draft</b> — Operations Home's 준비된 작업.
     *
     * <p><b>A phase is not a draft.</b> {@code PROPOSED} is written when a proposal is recorded and
     * {@code InquiryProposal} stores no answer body, so a Home that counted the phase would send a
     * seller to read a sentence nobody had written — measured once on this org at 10 PROPOSED against
     * 2 drafts. The existence check is the same fact the queue's {@code hasDraft} reports, asked here
     * as a predicate instead of a per-page lookup.
     *
     * <p>Synthetic rows are excluded the way every other 「일이 기다린다」 number excludes them: seeded
     * content may appear in a chart of what the shop did, never in a count of what the seller owes.
     */
    @Query("select w from InquiryWorkItem w, Inquiry q "
            + "where q.id = w.inquiryId and w.orgId = :orgId "
            + "and w.phase in :phases "
            + "and q.dataOrigin = com.sellerops.common.DataOrigin.REAL "
            + "and exists (select 1 from InquiryReplyDraft d where d.workItemId = w.id) "
            + "order by q.receivedAt asc, w.id asc")
    List<InquiryWorkItem> findAwaitingSellerWithDraft(@Param("orgId") UUID orgId,
                                                      @Param("phases") Collection<InquiryWorkItemPhase> phases,
                                                      Pageable pageable);

    /** The count behind {@link #findAwaitingSellerWithDraft}, same predicate. */
    @Query("select count(w) from InquiryWorkItem w, Inquiry q "
            + "where q.id = w.inquiryId and w.orgId = :orgId "
            + "and w.phase in :phases "
            + "and q.dataOrigin = com.sellerops.common.DataOrigin.REAL "
            + "and exists (select 1 from InquiryReplyDraft d where d.workItemId = w.id)")
    long countAwaitingSellerWithDraft(@Param("orgId") UUID orgId,
                                      @Param("phases") Collection<InquiryWorkItemPhase> phases);

    /** The work items for a bounded set of inquiries — the projection backfill's join. */
    List<InquiryWorkItem> findByInquiryIdIn(Collection<UUID> inquiryIds);

    /**
     * The inquiries an org has dismissed under one disposition — the ledger side of {@code
     * inquiries.operational_state}. Ids only: the projection needs the key, never the row.
     */
    @Query("select w.inquiryId from InquiryWorkItem w where w.orgId = :orgId "
            + "and w.phase = :phase and w.disposition = :disposition")
    List<UUID> findInquiryIdsByOrgIdAndPhaseAndDisposition(@Param("orgId") UUID orgId,
                                                           @Param("phase") InquiryWorkItemPhase phase,
                                                           @Param("disposition") InquiryWorkItemDisposition disposition);
}
