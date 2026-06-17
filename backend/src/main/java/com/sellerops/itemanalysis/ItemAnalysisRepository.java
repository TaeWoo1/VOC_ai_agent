package com.sellerops.itemanalysis;

import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ItemAnalysisRepository extends JpaRepository<ItemAnalysis, UUID> {

    boolean existsByOrgIdAndSourceTypeAndSourceId(UUID orgId, String sourceType, UUID sourceId);

    List<ItemAnalysis> findAllByOrgIdOrderByCreatedAtDesc(UUID orgId);

    /**
     * Scoped read for the inbox: analyses for this org of one source type whose source id is
     * in {@code sourceIds}. Org-scoped (ids from another org return nothing); unknown ids are
     * simply absent; duplicate requested ids collapse in the {@code IN} clause.
     */
    List<ItemAnalysis> findByOrgIdAndSourceTypeAndSourceIdIn(
            UUID orgId, String sourceType, Collection<UUID> sourceIds);
}
