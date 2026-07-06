package com.sellerops.inquiry.workitem.dismissal;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface InquiryWorkItemDismissalBatchRepository
        extends JpaRepository<InquiryWorkItemDismissalBatch, UUID> {

    /** The single batch for this command in this org, if any (idempotency key). */
    Optional<InquiryWorkItemDismissalBatch> findByOrgIdAndCommandId(UUID orgId, String commandId);
}
