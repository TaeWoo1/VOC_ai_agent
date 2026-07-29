package com.sellerops.credential;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ConnectorCredentialRepository extends JpaRepository<ConnectorCredential, UUID> {

    Optional<ConnectorCredential> findBySellerAccountId(UUID sellerAccountId);

    /** Org-scoped lookup — the only way the vault reads secret-bearing rows. */
    Optional<ConnectorCredential> findByOrgIdAndSellerAccountId(UUID orgId, UUID sellerAccountId);

    boolean existsBySellerAccountId(UUID sellerAccountId);

    /** Row count for one account — lets a caller assert single-row (no duplicate). */
    long countBySellerAccountId(UUID sellerAccountId);
}
