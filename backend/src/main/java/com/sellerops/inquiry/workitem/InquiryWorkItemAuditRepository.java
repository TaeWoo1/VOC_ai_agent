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
     * All audit rows for a work item whose {@code command_id} starts with the given
     * prefix. Used by the guided-handoff outcome path to detect a command id replayed
     * with a <em>different</em> outcome (a conflict) versus an exact replay, without a
     * dedicated outcome column.
     */
    List<InquiryWorkItemAudit> findByWorkItemIdAndCommandIdStartingWith(UUID workItemId, String commandIdPrefix);
}
