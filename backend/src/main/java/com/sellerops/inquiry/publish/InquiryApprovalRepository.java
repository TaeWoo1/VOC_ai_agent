package com.sellerops.inquiry.publish;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface InquiryApprovalRepository extends JpaRepository<InquiryApproval, UUID> {
    Optional<InquiryApproval> findByWorkItemId(UUID workItemId);

    /**
     * The replies this seller has explicitly approved on one product, newest first. Org-scoped on both sides of
     * the join: an approval names a customer's thread, and a read that crossed organisations would put one
     * seller's decisions into another seller's evidence.
     */
    @Query("""
            select a from InquiryApproval a, InquiryWorkItem w, Inquiry i
            where a.workItemId = w.id and w.inquiryId = i.id
              and a.orgId = :orgId and i.orgId = :orgId and i.productId = :productId
            order by a.createdAt desc
            """)
    List<InquiryApproval> approvedOnProduct(@Param("orgId") UUID orgId, @Param("productId") UUID productId,
                                            Pageable page);
}
