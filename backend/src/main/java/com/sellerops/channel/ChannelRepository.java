package com.sellerops.channel;

import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ChannelRepository extends JpaRepository<Channel, UUID> {
    List<Channel> findAllByOrderBySortOrderAsc();

    Optional<Channel> findByCode(String code);

    /**
     * Load a channel row under a {@code PESSIMISTIC_WRITE} lock (SELECT … FOR UPDATE). The channel catalog
     * is global, so this row is the natural serialization point for "start a connection on this channel":
     * concurrent {@code registerApiChannel} calls for the same channel take the lock one at a time, so the
     * find-or-create of the single API-mode seller account is atomic and cannot race into duplicate rows.
     * The lock is the correctness guarantee for the normal create path; the defensive
     * {@code findFirst…OrderByCreatedAtAsc} read only bounds damage from any pre-existing legacy duplicate.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c from Channel c where c.id = :id")
    Optional<Channel> findByIdForUpdate(@Param("id") UUID id);
}
