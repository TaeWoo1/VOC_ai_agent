package com.sellerops.itemanalysis;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ItemAnalysisRepository extends JpaRepository<ItemAnalysis, UUID> {

    boolean existsByOrgIdAndSourceTypeAndSourceId(UUID orgId, String sourceType, UUID sourceId);

    List<ItemAnalysis> findAllByOrgIdOrderByCreatedAtDesc(UUID orgId);
}
