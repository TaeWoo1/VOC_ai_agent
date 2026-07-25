package com.sellerops.reviewimport;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ReviewImportSegmentRepository extends JpaRepository<ReviewImportSegment, UUID> {

    /** Date order is the display order and survives split/merge (ordinal would need renumbering). */
    List<ReviewImportSegment> findByPlanIdOrderBySegmentStartAsc(UUID planId);

    /** The coverage rollup ignores superseded (split-parent) segments. */
    List<ReviewImportSegment> findByPlanIdAndSupersededFalseOrderBySegmentStartAsc(UUID planId);

    Optional<ReviewImportSegment> findByIdAndOrgId(UUID id, UUID orgId);
}
