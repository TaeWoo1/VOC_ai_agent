package com.sellerops.inquiry.workitem;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

public interface InquiryWorkItemRepository extends JpaRepository<InquiryWorkItem, UUID> {

    /** Org-scoped, phase-filtered, paged queue read. */
    Page<InquiryWorkItem> findByOrgIdAndPhase(UUID orgId, InquiryWorkItemPhase phase, Pageable pageable);

    boolean existsByInquiryId(UUID inquiryId);

    /** The single work item for an inquiry ({@code inquiry_id} is unique), when present. */
    Optional<InquiryWorkItem> findByInquiryId(UUID inquiryId);

    long countByOrgIdAndPhase(UUID orgId, InquiryWorkItemPhase phase);
}
