package com.sellerops.inquiry.esmimport;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface InquiryImportProvenanceRepository extends JpaRepository<InquiryImportProvenance, UUID> {

    List<InquiryImportProvenance> findByImportBatchId(UUID importBatchId);

    long countByImportBatchId(UUID importBatchId);
}
