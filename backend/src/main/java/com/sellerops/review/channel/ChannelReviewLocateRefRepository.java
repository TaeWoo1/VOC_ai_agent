package com.sellerops.review.channel;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

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
}
