package com.sellerops.connector;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ConnectorAlertRepository extends JpaRepository<ConnectorAlert, UUID> {

    List<ConnectorAlert> findBySellerAccountIdOrderByCreatedAtDesc(UUID sellerAccountId);

    /** Bounded org-scoped read window for the alert list (open-first ordering is
     *  applied in-service). Mirrors {@code SyncJobRepository.findTop200ByOrgId…}. */
    List<ConnectorAlert> findTop200ByOrgIdOrderByCreatedAtDesc(UUID orgId);

    /** Org-scoped single-row lookup for the acknowledge mutation: a cross-org id
     *  resolves to empty (404), never another org's row. Mirrors
     *  {@code SyncJobRepository.findByIdAndOrgId}. */
    Optional<ConnectorAlert> findByIdAndOrgId(UUID id, UUID orgId);

    /** Spam guard: at most one unacknowledged alert of a type per seller account. */
    boolean existsBySellerAccountIdAndTypeAndAcknowledgedAtIsNull(UUID sellerAccountId, String type);

    /** Durable dedup: whether ANY alert of a type exists (acked or not) — so acknowledging one silences it
     *  until it is explicitly cleared (used by the credential-expiry alerts, cleared on renewal). */
    boolean existsBySellerAccountIdAndType(UUID sellerAccountId, String type);

    /** Clear (delete) an account's alerts of the given types — e.g. stale expiry alerts after a renewal. */
    List<ConnectorAlert> findBySellerAccountIdAndTypeIn(UUID sellerAccountId, java.util.Collection<String> types);
}
