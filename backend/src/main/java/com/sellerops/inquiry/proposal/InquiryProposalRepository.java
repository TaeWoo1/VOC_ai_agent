package com.sellerops.inquiry.proposal;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface InquiryProposalRepository extends JpaRepository<InquiryProposal, UUID> {

    Optional<InquiryProposal> findByWorkItemId(UUID workItemId);
}
