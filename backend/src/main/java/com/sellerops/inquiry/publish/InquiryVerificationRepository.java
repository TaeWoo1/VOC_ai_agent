package com.sellerops.inquiry.publish;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface InquiryVerificationRepository extends JpaRepository<InquiryVerification, UUID> {
    long countByExecutionId(UUID executionId);

    /** The most recent attempt. Verification is append-only, so the last row is the current answer. */
    Optional<InquiryVerification> findTopByExecutionIdOrderByCreatedAtDesc(UUID executionId);
}
