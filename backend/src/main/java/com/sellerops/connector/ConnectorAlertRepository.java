package com.sellerops.connector;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ConnectorAlertRepository extends JpaRepository<ConnectorAlert, UUID> {

    List<ConnectorAlert> findBySellerAccountIdOrderByCreatedAtDesc(UUID sellerAccountId);

    /** Bounded org-scoped read window for the alert list (open-first ordering is
     *  applied in-service). Mirrors {@code SyncJobRepository.findTop200ByOrgId…}. */
    List<ConnectorAlert> findTop200ByOrgIdOrderByCreatedAtDesc(UUID orgId);

    /** Spam guard: at most one unacknowledged alert of a type per seller account. */
    boolean existsBySellerAccountIdAndTypeAndAcknowledgedAtIsNull(UUID sellerAccountId, String type);
}
