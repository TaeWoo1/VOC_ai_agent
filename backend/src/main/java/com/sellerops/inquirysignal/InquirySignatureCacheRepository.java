package com.sellerops.inquirysignal;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface InquirySignatureCacheRepository extends JpaRepository<InquirySignatureCacheEntry, UUID> {

    Optional<InquirySignatureCacheEntry> findByOrgIdAndContentHash(UUID orgId, String contentHash);

    long countByOrgId(UUID orgId);

    long countByOrgIdAndSignatureKeyIsNotNull(UUID orgId);
}
