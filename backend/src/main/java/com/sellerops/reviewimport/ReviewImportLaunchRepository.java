package com.sellerops.reviewimport;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ReviewImportLaunchRepository extends JpaRepository<ReviewImportLaunch, UUID> {

    /**
     * Resolve by the opaque ref alone — the runtime presents nothing else. Org scoping is applied by the
     * service AFTER the lookup (a ref that resolves to another org is a refusal, not a miss), so the
     * caller cannot probe which refs exist by varying an org id.
     */
    Optional<ReviewImportLaunch> findByLaunchRef(String launchRef);

    /** The outstanding ticket for a segment, if the seller already has one open (re-click idempotency). */
    Optional<ReviewImportLaunch> findBySegmentIdAndStatus(UUID segmentId, ReviewImportLaunchStatus status);

    /** The outstanding discovery ticket for an account, if any (re-click idempotency). */
    Optional<ReviewImportLaunch> findByOrgIdAndSellerAccountIdAndKindAndStatus(
            UUID orgId, UUID sellerAccountId, ReviewImportLaunchKind kind, ReviewImportLaunchStatus status);
}
