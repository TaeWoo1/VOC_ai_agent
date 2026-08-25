package com.sellerops.inquiry.workitem;

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
     */
    @Query("select w from InquiryWorkItem w where w.orgId = :orgId and w.phase = :phase "
            + "and exists (select 1 from Inquiry i where i.id = w.inquiryId and i.dataOrigin = 'REAL' "
            + "and i.operationalState = com.sellerops.inquiry.InquiryOperationalState.ACTIVE)")
    Page<InquiryWorkItem> findOperationalByOrgIdAndPhase(@Param("orgId") UUID orgId,
                                                         @Param("phase") InquiryWorkItemPhase phase,
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
     * <p>Ordered oldest-first so a bounded tick works through a backlog instead of re-reading its
     * newest rows forever, and totally ordered so a capped run is resumable.
     */
    @Query("select w from InquiryWorkItem w where w.orgId = :orgId "
            + "and w.phase = com.sellerops.inquiry.workitem.InquiryWorkItemPhase.OPEN "
            + "and exists (select 1 from Inquiry i where i.id = w.inquiryId "
            + "  and i.dataOrigin = com.sellerops.common.DataOrigin.REAL "
            + "  and i.operationalState = com.sellerops.inquiry.InquiryOperationalState.ACTIVE "
            + "  and i.status = 'UNANSWERED' "
            + "  and (i.threadRole is null or i.threadRole = 'ROOT')) "
            + "order by w.createdAt asc, w.id asc")
    List<InquiryWorkItem> findProactiveCandidates(@Param("orgId") UUID orgId, Pageable pageable);

    boolean existsByInquiryId(UUID inquiryId);

    /** The single work item for an inquiry ({@code inquiry_id} is unique), when present. */
    Optional<InquiryWorkItem> findByInquiryId(UUID inquiryId);

    long countByOrgIdAndPhase(UUID orgId, InquiryWorkItemPhase phase);

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
