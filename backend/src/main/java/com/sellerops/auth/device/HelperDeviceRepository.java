package com.sellerops.auth.device;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface HelperDeviceRepository extends JpaRepository<HelperDevice, UUID> {

    Optional<HelperDevice> findByTokenHash(String tokenHash);

    List<HelperDevice> findByOrgIdAndRevokedAtIsNullOrderByCreatedAtDesc(UUID orgId);

    /**
     * Does this org have a helper linked at all? The existence question, asked by surfaces that need to
     * know whether a screen read can happen — never which device, and never the token.
     */
    boolean existsByOrgIdAndRevokedAtIsNull(UUID orgId);

    Optional<HelperDevice> findByIdAndOrgId(UUID id, UUID orgId);

    /**
     * Record use without loading the row into the request's persistence context. Throttled by the caller
     * (once a minute per device) so an upload of many rows is not many writes.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update HelperDevice d set d.lastUsedAt = :now where d.id = :id")
    int touch(@Param("id") UUID id, @Param("now") Instant now);
}
