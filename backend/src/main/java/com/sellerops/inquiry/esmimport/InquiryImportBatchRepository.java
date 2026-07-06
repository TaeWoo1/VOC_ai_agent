package com.sellerops.inquiry.esmimport;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface InquiryImportBatchRepository extends JpaRepository<InquiryImportBatch, UUID> {

    Optional<InquiryImportBatch> findByOrgIdAndSellerAccountIdAndMarketplaceAndFileHash(
            UUID orgId, UUID sellerAccountId, EsmMarketplace marketplace, String fileHash);
}
