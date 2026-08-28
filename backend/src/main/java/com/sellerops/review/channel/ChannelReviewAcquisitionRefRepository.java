package com.sellerops.review.channel;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Reads an acquisition binding by its opaque token — same shape and reasoning as the locate ref. */
public interface ChannelReviewAcquisitionRefRepository extends JpaRepository<ChannelReviewAcquisitionRef, UUID> {

    Optional<ChannelReviewAcquisitionRef> findByAcquisitionRef(String acquisitionRef);

    /**
     * Spend the binding, and let the DATABASE decide whether it was still spendable — every condition in
     * the UPDATE's own WHERE clause, so exactly one caller can ever see a row count of 1.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update ChannelReviewAcquisitionRef r set r.consumedAt = :now "
            + "where r.acquisitionRef = :ref and r.orgId = :orgId "
            + "and r.consumedAt is null and r.expiresAt > :now")
    int spend(@Param("ref") String ref, @Param("orgId") UUID orgId, @Param("now") Instant now);
}
