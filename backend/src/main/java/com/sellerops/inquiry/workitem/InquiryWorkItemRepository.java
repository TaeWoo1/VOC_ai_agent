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
     * <p>Written as an explicit join rather than left to the {@code realDataOnly} filter, for two
     * reasons. The filter is declared on {@code Inquiry} and this query's root is the work item, and
     * the service's own inquiry load goes through {@code findAllById}, which no Hibernate filter
     * touches. Filtering after the page is fetched would also make {@code totalElements} count rows
     * the caller never receives, and a queue that says 12 while showing 9 is its own defect.
     */
    @Query("select w from InquiryWorkItem w where w.orgId = :orgId and w.phase = :phase "
            + "and exists (select 1 from Inquiry i where i.id = w.inquiryId and i.dataOrigin = 'REAL')")
    Page<InquiryWorkItem> findOperationalByOrgIdAndPhase(@Param("orgId") UUID orgId,
                                                         @Param("phase") InquiryWorkItemPhase phase,
                                                         Pageable pageable);

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
