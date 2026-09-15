package com.sellerops.responsibility;

import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ResponsibilityRepository extends JpaRepository<Responsibility, UUID> {

    Optional<Responsibility> findByOrgIdAndTemplateCode(UUID orgId, ResponsibilityTemplate templateCode);

    boolean existsByOrgIdAndTemplateCodeAndStatus(UUID orgId, ResponsibilityTemplate templateCode,
                                                  ResponsibilityStatus status);

    /** Serializes seller actions (activate/pause/resume/stop) with the materializer on the same row. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select r from Responsibility r where r.orgId = :orgId and r.templateCode = :template")
    Optional<Responsibility> findForUpdate(@Param("orgId") UUID orgId,
                                           @Param("template") ResponsibilityTemplate template);

    /**
     * ACTIVE responsibilities whose next window has begun. {@code SKIP LOCKED}: a second scheduler instance
     * skips a row the first is materializing rather than waiting and then materializing it again.
     */
    @Query(value = """
            select * from responsibility
            where status = 'ACTIVE' and next_run_at is not null and next_run_at <= :now
            order by next_run_at asc
            limit :limit
            for update skip locked
            """, nativeQuery = true)
    List<Responsibility> lockDueActive(@Param("now") Instant now, @Param("limit") int limit);
}
