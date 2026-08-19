package com.sellerops.auth.password;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface PasswordResetTokenRepository extends JpaRepository<PasswordResetToken, UUID> {

    Optional<PasswordResetToken> findByTokenHash(String tokenHash);

    /** Spend atomically: 1 when this call turned a live, unconsumed token into a consumed one; 0 otherwise. */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update PasswordResetToken t set t.consumedAt = :now, t.updatedAt = :now "
            + "where t.tokenHash = :tokenHash and t.consumedAt is null and t.expiresAt > :now")
    int consume(@Param("tokenHash") String tokenHash, @Param("now") Instant now);

    /** A new request retires every older live link of the same user — only the newest mail works. */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update PasswordResetToken t set t.consumedAt = :now, t.updatedAt = :now "
            + "where t.userId = :userId and t.consumedAt is null and t.expiresAt > :now")
    int consumeAllLiveForUser(@Param("userId") UUID userId, @Param("now") Instant now);

    @Modifying
    @Query("delete from PasswordResetToken t where t.expiresAt < :cutoff")
    int deleteExpiredBefore(@Param("cutoff") Instant cutoff);
}
