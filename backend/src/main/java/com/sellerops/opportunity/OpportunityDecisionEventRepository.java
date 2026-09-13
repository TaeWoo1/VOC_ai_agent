package com.sellerops.opportunity;

import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * Reads of the decision trail. There is no update and no delete here on purpose — an append-only
 * table whose repository offers a way to rewrite it is append-only by convention only.
 */
public interface OpportunityDecisionEventRepository extends JpaRepository<OpportunityDecisionEvent, UUID> {

    /** The trail for a set of opportunities, oldest first — one query for a whole list read. */
    List<OpportunityDecisionEvent> findByOrgIdAndOpportunityIdInOrderByDecidedAtAsc(
            UUID orgId, Collection<UUID> opportunityIds);
}
