package com.sellerops.inquiry.binding;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface InquiryProductBindingEventRepository
        extends JpaRepository<InquiryProductBindingEvent, UUID> {

    List<InquiryProductBindingEvent> findAllByInquiryIdOrderByCreatedAtDesc(UUID inquiryId);
}
