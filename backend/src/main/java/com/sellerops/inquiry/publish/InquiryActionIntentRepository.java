package com.sellerops.inquiry.publish;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface InquiryActionIntentRepository extends JpaRepository<InquiryActionIntent, UUID> {
    Optional<InquiryActionIntent> findByWorkItemId(UUID workItemId);
}
