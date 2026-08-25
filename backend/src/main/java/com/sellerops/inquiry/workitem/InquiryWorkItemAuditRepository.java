package com.sellerops.inquiry.workitem;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface InquiryWorkItemAuditRepository extends JpaRepository<InquiryWorkItemAudit, UUID> {

    List<InquiryWorkItemAudit> findByWorkItemIdOrderByCreatedAtAsc(UUID workItemId);

    long countByWorkItemId(UUID workItemId);

    /** Idempotency probe for a command-scoped audit (e.g. import reconciliation). */
    boolean existsByWorkItemIdAndCommandId(UUID workItemId, String commandId);

    /**
     * How many times this work item has been re-armed after a corrected request — which is also how
     * the attempt an execution audit belongs to is derived. The command id is unique per work item,
     * so an attempt that reused attempt 1's id could not record itself at all.
     */
    long countByWorkItemIdAndEventType(UUID workItemId, InquiryWorkItemEvent eventType);
}
