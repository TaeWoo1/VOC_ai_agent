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
