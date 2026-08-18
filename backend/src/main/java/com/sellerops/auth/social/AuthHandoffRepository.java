package com.sellerops.auth.social;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface AuthHandoffRepository extends JpaRepository<AuthHandoff, UUID> {

    Optional<AuthHandoff> findByCodeHash(String codeHash);

    /**
     * Spend a handoff atomically: exactly one caller can turn a live, unconsumed row into a consumed one.
     * Returns 1 when this call did it, 0 when the code is unknown, expired, or already used.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update AuthHandoff h set h.consumedAt = :now, h.updatedAt = :now "
            + "where h.codeHash = :codeHash and h.purpose = :purpose and h.consumedAt is null and h.expiresAt > :now")
    int consume(@Param("codeHash") String codeHash, @Param("purpose") AuthHandoff.Purpose purpose,
                @Param("now") Instant now);

    @Modifying
    @Query("delete from AuthHandoff h where h.expiresAt < :cutoff")
    int deleteExpiredBefore(@Param("cutoff") Instant cutoff);
}
