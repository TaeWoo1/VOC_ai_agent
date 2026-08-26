package com.sellerops.knowledge.style;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * One row per org, found by the org.
 *
 * <p>There is no {@code findAll} caller and no cross-org query anywhere: the id IS the org, so a
 * lookup that forgot to scope cannot compile into one that returns another company's wording.
 */
public interface OrganizationAnswerStyleRepository
        extends JpaRepository<OrganizationAnswerStyle, UUID> {
}
