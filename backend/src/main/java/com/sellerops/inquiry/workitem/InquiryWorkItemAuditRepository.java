package com.sellerops.inquiry.workitem;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface InquiryWorkItemAuditRepository extends JpaRepository<InquiryWorkItemAudit, UUID> {

    List<InquiryWorkItemAudit> findByWorkItemIdOrderByCreatedAtAsc(UUID workItemId);

    long countByWorkItemId(UUID workItemId);
}
