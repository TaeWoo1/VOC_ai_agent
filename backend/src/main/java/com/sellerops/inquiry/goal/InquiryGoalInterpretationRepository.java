package com.sellerops.inquiry.goal;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * Reads of stored interpretations. Every declaration takes an org: a reading belongs to the organisation whose
 * customer wrote the sentence, and there is no query here that could answer about another one.
 */
public interface InquiryGoalInterpretationRepository extends JpaRepository<InquiryGoalInterpretation, UUID> {

    /** The one reading of this exact message under this exact contract, if it has been made. */
    Optional<InquiryGoalInterpretation> findByOrgIdAndInquiryIdAndSourceFingerprintAndPromptVersion(
            UUID orgId, UUID inquiryId, String sourceFingerprint, String promptVersion);
}
