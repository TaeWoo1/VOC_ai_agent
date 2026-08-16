package com.sellerops.review.triage.feedback;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CorrectionDispositionRepository extends JpaRepository<CorrectionDisposition, UUID> {

    Optional<CorrectionDisposition> findByCorrectionId(UUID correctionId);

    /**
     * The corrections eligible for the next snapshot: classifier errors not yet folded into one.
     *
     * <p>Deliberately not "all classifier errors" — a snapshot that silently re-included rows
     * already counted in an earlier one would double-weight them, and the metric would improve for
     * no reason anyone could name.
     */
    List<CorrectionDisposition> findByOrgIdAndDispositionAndSnapshotVersionIsNull(
            UUID orgId, CorrectionDispositionKind disposition);
}
