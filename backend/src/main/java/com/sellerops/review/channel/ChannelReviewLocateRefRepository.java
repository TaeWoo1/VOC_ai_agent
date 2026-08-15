package com.sellerops.review.channel;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Reads a locate binding by its opaque token.
 *
 * <p>The lookup is deliberately by ref ALONE, then org-checked in the service against the resolving
 * agent's own JWT. Querying by {@code (ref, orgId)} would make a token belonging to another tenant
 * indistinguishable from one that never existed, and the two want different answers: the first is a
 * tenant boundary being tested and the second is an expired press.
 */
public interface ChannelReviewLocateRefRepository extends JpaRepository<ChannelReviewLocateRef, UUID> {

    Optional<ChannelReviewLocateRef> findByLocateRef(String locateRef);

    /**
     * Spend the binding, and let the DATABASE decide whether it was still spendable.
     *
     * <p>Reading the row, checking {@code consumed_at is null} in Java, and writing it back is not
     * single-use: two concurrent resolves both read NULL, both issue {@code UPDATE … WHERE id = ?}, and
     * under READ COMMITTED both succeed — the token is spent twice. Every condition therefore lives in the
     * UPDATE's own WHERE clause, so exactly one caller can ever see a row count of 1.
     *
     * <p>The same reasoning the reply path uses, arrived at differently: there, exactly-once is a UNIQUE
     * constraint on the outcome row; here it is a conditional update on the binding itself.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update ChannelReviewLocateRef r set r.consumedAt = :now "
            + "where r.locateRef = :locateRef and r.orgId = :orgId "
            + "and r.consumedAt is null and r.expiresAt > :now")
    int spend(@Param("locateRef") String locateRef, @Param("orgId") UUID orgId, @Param("now") Instant now);
}
