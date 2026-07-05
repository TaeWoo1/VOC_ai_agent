package com.sellerops.inquiry.publish;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface InquiryApprovalRepository extends JpaRepository<InquiryApproval, UUID> {
    Optional<InquiryApproval> findByWorkItemId(UUID workItemId);
}
