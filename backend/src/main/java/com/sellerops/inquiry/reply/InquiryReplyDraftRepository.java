package com.sellerops.inquiry.reply;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface InquiryReplyDraftRepository extends JpaRepository<InquiryReplyDraft, UUID> {

    /** The current (highest-version) draft for a work item, if any. */
    Optional<InquiryReplyDraft> findTopByWorkItemIdOrderByVersionDesc(UUID workItemId);

    Optional<InquiryReplyDraft> findByWorkItemIdAndVersion(UUID workItemId, int version);

    long countByWorkItemId(UUID workItemId);
}
