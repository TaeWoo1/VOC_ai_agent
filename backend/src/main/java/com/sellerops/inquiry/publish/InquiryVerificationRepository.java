package com.sellerops.inquiry.publish;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface InquiryVerificationRepository extends JpaRepository<InquiryVerification, UUID> {
    long countByExecutionId(UUID executionId);
}
