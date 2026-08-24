package com.sellerops.inquiry.draft;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface InquiryDraftEvidenceRepository extends JpaRepository<InquiryDraftEvidence, UUID> {

    List<InquiryDraftEvidence> findAllByWorkItemIdAndDraftVersionOrderByOrdinalAsc(
            UUID workItemId, int draftVersion);
}
